/**
 * The note in a CM6 editor, read as list items and code blocks
 * (`Outline.read`), cached per document for every editor extension.
 *
 * Every extension that asks where a task's subtree ends, what a line's
 * parent is, or whether a line is code asks this one reading, which is the
 * parser's reading of the same lines: an extension with a walk of its own
 * would decorate a command or a task the index does not have. Cached on the
 * CM6 `Text` object's identity: a pure viewport/scroll update keeps the same
 * `Text`, so repeated calls across a scroll reuse the reading instead of
 * reading the whole document again.
 */
import type { Text } from '@codemirror/state';
import { Outline, type OutlineReading } from '../services/parsing/utils/Outline';

let cache: { doc: Text; outline: OutlineReading } | null = null;

/** The document read as list items and code blocks (`Outline.read`). */
export function outlineFor(doc: Text): OutlineReading {
    if (cache?.doc === doc) return cache.outline;

    const lines: string[] = [];
    for (let n = 1; n <= doc.lines; n++) lines.push(doc.line(n).text);

    const outline = Outline.read(lines);
    cache = { doc, outline };
    return outline;
}
