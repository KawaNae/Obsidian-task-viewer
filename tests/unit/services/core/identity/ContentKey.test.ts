import { describe, it, expect } from 'vitest';
import { contentKeyOf } from '../../../../../src/services/core/identity/ContentKey';
import { splitLines, joinLines } from '../../../../../src/utils/FileLines';

describe('contentKeyOf', () => {
    it('gives the same content the same key', () => {
        expect(contentKeyOf(['- [ ] a', 'b'])).toBe(contentKeyOf(['- [ ] a', 'b']));
    });

    it('tells apart contents that differ only in a line no task sits on', () => {
        expect(contentKeyOf(['- [ ] a', 'note'])).not.toBe(contentKeyOf(['- [ ] a', 'note!']));
    });

    it('tells apart the same lines in another order', () => {
        expect(contentKeyOf(['a', 'b'])).not.toBe(contentKeyOf(['b', 'a']));
    });

    it('tells apart a trailing empty line (a final terminator) from none', () => {
        expect(contentKeyOf(['a'])).not.toBe(contentKeyOf(['a', '']));
    });

    it('agrees between what a write spliced and what the scan reads back, CRLF included', () => {
        const written = ['---', 'tv-color: red', '---', '- [ ] a', ''];
        const read = splitLines(joinLines(written, '\r\n')).lines;
        expect(contentKeyOf(read)).toBe(contentKeyOf(written));
    });

    it('does not agree when a written element holds a line break the scan will split', () => {
        // Rows are placed by element, so on the split file every row below
        // that element sits a line lower than the array says. The joined text
        // is the same; the key must not be.
        const written = ['note\n- [ ] pasted', '- [ ] a'];
        const read = splitLines(joinLines(written, '\n')).lines;
        expect(read).toHaveLength(3);
        expect(contentKeyOf(read)).not.toBe(contentKeyOf(written));
    });

    it('carries the line count and the length next to the hash', () => {
        expect(contentKeyOf(['ab', 'c'])).toMatch(/^2:4:[0-9a-f]{16}$/);
    });
});
