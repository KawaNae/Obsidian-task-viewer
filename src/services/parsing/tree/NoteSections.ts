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
     * The sections of the note `outline` reads, as a tree under its root.
     * The root is the section of the whole body, a heading of level 0: it
     * is always there, an empty body's or one that opens on a heading too,
     * and its own lines are those above the first heading (the whole body
     * when there is none). A heading's section runs from its line to the
     * next heading of its level or above, and is nested in the nearest one
     * above it of a lower level, the root for a heading no other is above.
     * Each holds its own property lines (`properties`,
     * `PropertyLines.ofSection`), and where its head is (`head`); the
     * values they resolve to are `SectionPropertyResolver`'s to set.
     */
    static read(outline: OutlineReading): SectionNode {
        const { bodyStart } = outline;
        const end = outline.lines.length;
        const headings = outline.headings.filter(h => h.line >= bodyStart);

        const root = section(null, bodyStart, end);
        const open: SectionNode[] = [root];
        headings.forEach((heading, i) => {
            const node = section(heading, heading.line, headings[i + 1]?.line ?? end);
            while (levelOf(open[open.length - 1]) >= heading.level) open.pop();
            open[open.length - 1].children.push(node);
            open.push(node);
        });
        stretchOverChildren(root);

        for (const node of this.all(root)) readProperties(node, outline);
        return root;
    }

    /** Every section of the tree under `root`, in the order the note writes them: each before its nested ones. */
    static all(root: SectionNode): SectionNode[] {
        const out: SectionNode[] = [];
        const walk = (node: SectionNode) => {
            out.push(node);
            for (const child of node.children) walk(child);
        };
        walk(root);
        return out;
    }

    /** The innermost section under `root` whose lines hold `line`: one for every line of the body, undefined for a line above it. */
    static at(root: SectionNode, line: number): SectionNode | undefined {
        if (line < root.startLine || line >= root.endLine) return undefined;
        for (const child of root.children) {
            const inner = this.at(child, line);
            if (inner) return inner;
        }
        return root;
    }
}

/** A section's level: its heading's, 0 for the root. */
function levelOf(node: SectionNode): number {
    return node.heading?.level ?? 0;
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
function stretchOverChildren(node: SectionNode): void {
    for (const child of node.children) stretchOverChildren(child);
    const last = node.children[node.children.length - 1];
    if (last) node.endLine = Math.max(node.endLine, last.endLine);
}

/**
 * A section's own property lines (`PropertyLines.ofSection`) over its own
 * lines: below its heading (from the body's first line, for the root), up
 * to its first nested section, which a section runs to the next heading of
 * its level or above, so ends the one around it too.
 *
 * Its head (`SectionNode.head`) is past the subtree of the last of them
 * written above its first task, or just below its heading (the body's
 * first line, for the root) when none is: a line put at the head of the
 * section goes there (`Placement.into`, `Placement.rootHead`), below
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
