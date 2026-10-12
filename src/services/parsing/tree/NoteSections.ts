import { NO_SOURCES, type SectionNode } from './Sections';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';
import { type OutlineHeading, type OutlineReading } from '../utils/Outline';
import { PropertyLines } from '../utils/PropertyLines';

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
     * its own property lines (`properties`, `PropertyLines.ofSection`) and
     * where its head is (`head`); the values they resolve to are
     * `SectionPropertyResolver`'s to set.
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

        for (const node of this.all(top)) readProperties(node, outline);
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
        properties: { owner: { kind: 'section', heading: heading?.line ?? null }, lines: [] },
        head: heading?.end ?? startLine,
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
 * A section's own property lines (`PropertyLines.ofSection`) over its own
 * lines: below its heading, up to its first nested section, which a
 * section runs to the next heading of its level or above, so ends the one
 * around it too.
 *
 * Its head (`SectionNode.head`) is past the subtree of the last of them
 * written above its first task, or just below its heading when none is: a
 * line put at the head of the section goes there (`Placement.into`), below
 * the property lines a note writes at the top of a section. The rest of
 * them, below a task, do not move it: a line put at the head does not go
 * down past a task.
 */
function readProperties(node: SectionNode, outline: OutlineReading): void {
    const ownEnd = node.children[0]?.startLine ?? node.endLine;
    const from = node.heading ? node.heading.end : node.startLine;
    node.properties = PropertyLines.ofSection(outline, node.heading?.line ?? null, from, ownEnd);

    let firstTask = from;
    while (firstTask < ownEnd && !TaskLineClassifier.opensTask(outline, firstTask)) firstTask++;
    const atHead = node.properties.lines.filter(line => line.line < firstTask);
    node.head = atHead.length > 0 ? atHead[atHead.length - 1].end : from;
}
