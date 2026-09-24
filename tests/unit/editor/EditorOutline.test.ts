import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Text } from '@codemirror/state';
import { outlineFor } from '../../../src/editor/EditorOutline';
import { Outline } from '../../../src/services/parsing/utils/Outline';

/** Minimal CM6 Text stand-in: only `.lines` and `.line(n).text` are read. */
function fakeText(lines: string[]): Text {
    return {
        lines: lines.length,
        line: (n: number) => ({ text: lines[n - 1] }),
    } as unknown as Text;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('outlineFor', () => {
    it('reads a plain document-level fence as code', () => {
        const doc = fakeText(['prose', '```', 'code', '```', 'prose']);
        expect(outlineFor(doc).codeMask()).toEqual([false, true, true, true, false]);
    });

    it('reads a fence nested under a task as code', () => {
        const doc = fakeText([
            '- [ ] task',
            '    ```',
            '    - [ ] fenced checkbox, not a real task',
            '    ```',
        ]);
        expect(outlineFor(doc).codeMask()).toEqual([false, true, true, true]);
    });

    it('is the reading the parser makes of the same lines', () => {
        const lines = ['- [ ] a', '\t- [ ] b', '', '\t\tmemo', '- [ ] c', '  ```', 'x', '  ```'];
        const editor = outlineFor(fakeText(lines));
        const parser = Outline.read(lines);
        expect(editor.codeMask()).toEqual(parser.codeMask());
        expect(lines.map((_, i) => editor.item(i))).toEqual(lines.map((_, i) => parser.item(i)));
        expect(editor.fences).toEqual(parser.fences);
    });

    it('caches per Text identity: a second call with the same doc does not read again', () => {
        const readSpy = vi.spyOn(Outline, 'read');
        const doc = fakeText(['```', 'code', '```']);

        const first = outlineFor(doc);
        expect(readSpy).toHaveBeenCalledTimes(1);
        expect(outlineFor(doc)).toBe(first);
        expect(readSpy).toHaveBeenCalledTimes(1);
    });

    it('reads again for a different Text object (not globally sticky)', () => {
        const docA = fakeText(['```', 'code', '```']);
        const docB = fakeText(['prose', 'more prose']);
        expect(outlineFor(docA).codeMask()).toEqual([true, true, true]);
        expect(outlineFor(docB).codeMask()).toEqual([false, false]);
    });

    it('gives the opening delimiter\'s info string with each fence', () => {
        const doc = fakeText(['prose', '```tv-gen js', 'code', '```', 'prose']);
        expect(outlineFor(doc).fences).toEqual([
            expect.objectContaining({ line: 1, close: 3, info: 'tv-gen js' }),
        ]);
    });
});
