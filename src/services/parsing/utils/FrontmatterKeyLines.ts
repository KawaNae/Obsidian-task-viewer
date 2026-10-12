import { PropertyKey } from './PropertyKey';

/**
 * Where the frontmatter writes the top-level key `key`, its case aside
 * (`PropertyKey`): the range [start, end) of the key's line and the lines
 * that go on with its value (a list's items, a block scalar), up to the
 * next key's line. `fmEnd` is the line of the closing `---`. Null when no
 * line writes the key; the first such line when more than one does.
 *
 * The one answer to which lines say a frontmatter key: the resolution
 * records the key's line as the source of the value it gives
 * (`ValueSource`), and a write edits the same lines
 * (`FrontmatterLineEditor.findKeyRange`).
 */
export function frontmatterKeyRange(lines: readonly string[], fmEnd: number, key: string): [number, number] | null {
    for (let i = 1; i < fmEnd; i++) {
        const keyMatch = lines[i].match(KEY_LINE);
        if (keyMatch && PropertyKey.same(keyMatch[1], key)) {
            let end = i + 1;
            while (end < fmEnd && !KEY_LINE.test(lines[end])) end++;
            return [i, end];
        }
    }
    return null;
}

const KEY_LINE = /^([^:\s]+)\s*:/;
