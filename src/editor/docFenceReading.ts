import type { Text } from '@codemirror/state';
import { CodeFenceTracker, type FenceScan } from '../utils/CodeFenceTracker';

/**
 * What a decoration must know about fences, read once per document.
 *
 * A fenced line is an example, not a task: the scanner never turns one into a
 * task or a flow segment, so an editor decoration drawn on it claims something
 * the file does not have. Every extension that decorates task-shaped lines
 * therefore has to ask the same question, and it has to ask it of the whole
 * document — a fence can open far above the viewport.
 *
 * `mask` OR's the two readings DocumentTreeBuilder OR's: the plain one
 * (CommonMark measures the ≤3-space allowance from column 0) and the dedented
 * one (a fence nested under a task carries the list item's indentation). The
 * extractor scopes its dedented reading to one subtree while this runs over
 * the whole document; the two diverge only for a fence that is never closed,
 * and there Obsidian's own renderer also treats the remainder as code.
 *
 * Cached on the document object, which CodeMirror replaces on every change, so
 * the entry is never stale and never has to be invalidated. A WeakMap rather
 * than a single slot: several panes hold several documents at once, and a
 * one-entry cache would miss on every alternation between them.
 */
export interface DocFenceReading {
    /** The plain scan, including the delimiters each fence opened. */
    scan: FenceScan;
    /** Per-line membership under both readings, 0-indexed by (line number - 1). */
    mask: boolean[];
}

const cache = new WeakMap<Text, DocFenceReading>();

export function docFenceReading(doc: Text): DocFenceReading {
    const hit = cache.get(doc);
    if (hit) return hit;

    const lines: string[] = [];
    for (let n = 1; n <= doc.lines; n++) lines.push(doc.line(n).text);

    const scan = CodeFenceTracker.scan(lines);
    const dedented = CodeFenceTracker.subtreeMask(lines);
    const reading: DocFenceReading = {
        scan,
        mask: lines.map((_, i) => scan.fenced[i] || dedented[i]),
    };
    cache.set(doc, reading);
    return reading;
}
