import { NO_SOURCES, type PropertyBlock, type PropertyBlockEntry, type SectionNode } from './Sections';
import { ChildLineClassifier } from '../utils/ChildLineClassifier';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';
import { INDENT_SOURCE, Outline, type OutlineHeading, type OutlineReading } from '../utils/Outline';
import { SPACE_OR_TAB_SOURCE } from '../utils/ListMarker';

const PROPERTY_GROUP_HEADER = new RegExp(`^${INDENT_SOURCE}-${SPACE_OR_TAB_SOURCE}+properties::\\s*$`);

/**
 * The sections of a note and the property lines each one gives the rows in
 * it: the part of the property cascade the note's body writes. Read off the
 * note's one reading (`Outline.read`): a section opens on a heading the
 * outline reads (`OutlineReading.headings`) — never in a fence, where a
 * `# comment` is code, nor in an item, where it is a line of the item — so
 * no task's subtree runs past its section.
 */
export class NoteSections {
    /**
     * The sections of the note `outline` reads, top-level first, each with
     * its nested ones: one for the lines above the first heading when there
     * are any (or for the whole body, with no heading), then one per heading
     * from its line to the next heading of its level or above. Each holds
     * its own property lines (`propertyBlock`); the values they resolve to
     * are `SectionPropertyResolver`'s to set.
     */
    static read(outline: OutlineReading): SectionNode[] {
        const { bodyStart } = outline;
        const end = outline.lines.length;
        const headings = outline.headings.filter(h => h.line >= bodyStart);

        const top: SectionNode[] = [];
        if (headings.length === 0 || headings[0].line > bodyStart) {
            top.push(section(null, bodyStart, headings[0]?.line ?? end));
        }

        // A heading's section runs to the next heading of its level or above;
        // one of a deeper level below it is nested in it.
        const open: SectionNode[] = [];
        headings.forEach((heading, i) => {
            const node = section(heading, heading.line, headings[i + 1]?.line ?? end);
            while (open.length > 0 && open[open.length - 1].heading!.level >= heading.level) open.pop();
            (open.length > 0 ? open[open.length - 1].children : top).push(node);
            open.push(node);
        });
        stretchOverChildren(top);

        for (const node of this.all(top)) node.propertyBlock = propertyBlockOf(node, outline);
        return top;
    }

    /** Every section, in the order the note writes them: each before its nested ones. */
    static all(sections: readonly SectionNode[]): SectionNode[] {
        const out: SectionNode[] = [];
        const walk = (nodes: readonly SectionNode[]) => {
            for (const node of nodes) {
                out.push(node);
                walk(node.children);
            }
        };
        walk(sections);
        return out;
    }

    /** The innermost section whose lines hold `line`; undefined for a line above the body. */
    static at(sections: readonly SectionNode[], line: number): SectionNode | undefined {
        for (const node of sections) {
            if (line < node.startLine || line >= node.endLine) continue;
            return this.at(node.children, line) ?? node;
        }
        return undefined;
    }
}

function section(heading: OutlineHeading | null, startLine: number, endLine: number): SectionNode {
    return {
        heading,
        propertyBlock: null,
        resolvedProperties: {},
        resolvedSources: NO_SOURCES,
        children: [],
        startLine,
        endLine,
    };
}

/** A section's lines take in its nested sections' (bottom-up). */
function stretchOverChildren(sections: readonly SectionNode[]): void {
    for (const node of sections) {
        stretchOverChildren(node.children);
        const last = node.children[node.children.length - 1];
        if (last) node.endLine = Math.max(node.endLine, last.endLine);
    }
}

/**
 * A section's own property lines: the lead area's `- key:: value` lines at
 * indent 0, and the entries of a `- properties::` group there. The lead area
 * is the section's own lines (its nested sections' left out) from its
 * heading to the first line that opens a task. Text, links, blank lines and
 * indented items may stand between property lines; code is never one.
 *
 * Cut at the first task so that a note written below a task does not reach
 * back to the task above it, and the root section's end does not run on.
 * Indent 0 only: the frontmatter's top level is its peer, and a
 * `- key:: value` under a wikilink bullet does not look like a section's.
 */
function propertyBlockOf(node: SectionNode, outline: OutlineReading): PropertyBlock | null {
    const lines = outline.lines;
    // A section's own lines end where its first nested section begins: a
    // nested section runs to the next heading of its level or above, which
    // ends the section around it too.
    const ownEnd = node.children[0]?.startLine ?? node.endLine;
    const from = node.heading ? node.heading.line + 1 : node.startLine;

    const entries: PropertyBlockEntry[] = [];
    const take = (line: number) => {
        if (outline.inCode(line)) return;
        const match = lines[line].match(ChildLineClassifier.PROPERTY_LINE);
        if (match) entries.push({ key: match[1].trim(), value: match[2].trim(), line });
    };

    for (let line = from; line < ownEnd; line++) {
        if (TaskLineClassifier.opensTask(outline, line)) break;
        const text = lines[line];
        if (outline.inCode(line) || Outline.isBlank(text) || Outline.depthOf(text) !== 0) continue;

        // The group form: every entry in the `- properties::` item's subtree.
        if (PROPERTY_GROUP_HEADER.test(text) && outline.item(line)) {
            const end = Math.min(outline.subtreeEnd(line), ownEnd);
            for (let entry = line + 1; entry < end; entry++) {
                if (TaskLineClassifier.opensTask(outline, entry)) return result(entries);
                take(entry);
            }
            line = end - 1;
            continue;
        }
        take(line);
    }
    return result(entries);
}

function result(entries: PropertyBlockEntry[]): PropertyBlock | null {
    return entries.length > 0 ? { entries } : null;
}
