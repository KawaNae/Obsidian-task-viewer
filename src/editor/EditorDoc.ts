import type { Text } from '@codemirror/state';
import { contentKeyOf, type ContentKey } from '../services/core/ContentKey';

/** A document's lines, as a write holds them. */
export function linesOf(doc: Text): string[] {
    const lines: string[] = [];
    for (let n = 1; n <= doc.lines; n++) lines.push(doc.line(n).text);
    return lines;
}

/**
 * The key of a document's content: the content a line the editor points at
 * is a coordinate in (`EditorLine.key`). The same key as the file's when the
 * file reads the same lines, whatever its terminators (`contentKeyOf`).
 */
export function keyOf(doc: Text): ContentKey {
    return contentKeyOf(linesOf(doc));
}
