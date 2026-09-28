import { describe, it, expect } from 'vitest';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { ListNumber } from '../../../src/services/persistence/utils/ListNumber';
import type { Spot } from '../../../src/services/persistence/utils/Placement';

/**
 * The number an ordered item takes where a write puts it: on from the ordered
 * sibling straight above it, with its delimiter, else 1 — the one number that
 * interrupts a paragraph (CommonMark).
 */

const top = (at: number): Spot => ({ at, parent: null, indent: '' });
const at = (lines: string[], spot: Spot, head: string, leaving?: { from: number; to: number }) =>
    ListNumber.at(Outline.read(lines), spot, head, leaving);

describe('ListNumber.at', () => {
    it('goes on from the ordered sibling straight above, with its delimiter', () => {
        expect(at(['## H', '1. [x] a', '2. [x] b'], top(3), '7. [x] T')).toEqual({ text: '3. [x] T', shift: 0 });
        expect(at(['## H', '4) [x] a'], top(2), '1) [x] T')).toEqual({ text: '5) [x] T', shift: 0 });
    });

    it('opens a list of its own at 1 anywhere else: under a heading, past a paragraph, past a bullet, past another delimiter', () => {
        expect(at(['## H', '- [x] a'], top(1), '3. [x] T').text).toBe('1. [x] T');
        expect(at(['## H', 'words'], top(2), '3. [x] T').text).toBe('1. [x] T');
        expect(at(['## H', '- [x] a'], top(2), '3. [x] T').text).toBe('1. [x] T');
        expect(at(['## H', '2) [x] a'], top(2), '3. [x] T').text).toBe('1. [x] T');
        // A blank line between: the item above ends before it.
        expect(at(['## H', '2. [x] a', ''], top(3), '3. [x] T').text).toBe('1. [x] T');
    });

    it('goes on past the ordered sibling\'s own subtree', () => {
        expect(at(['## H', '1. [x] a', '   - [ ] child', '   text'], top(4), '9. [x] T').text).toBe('2. [x] T');
    });

    it('writes a bullet as it is', () => {
        expect(at(['## H', '1. [x] a'], top(2), '- [x] T')).toEqual({ text: '- [x] T', shift: 0 });
    });

    it('keeps the indentation and the gap it is written with', () => {
        expect(at(['## H', '1. [x] a'], top(2), '\t3.  [x] T').text).toBe('\t2.  [x] T');
    });

    it('says how far the content moved right when the number takes more digits, and nothing when fewer', () => {
        expect(at(['## H', '9. [x] a'], top(2), '1. [x] T')).toEqual({ text: '10. [x] T', shift: 1 });
        expect(at(['## H'], top(1), '12. [x] T')).toEqual({ text: '1. [x] T', shift: 0 });
    });

    it('looks past the lines the write takes away: the item carried is not the one above', () => {
        const lines = ['## H', '1. [x] a', '2. [ ] T', '   - [ ] c'];
        // Carried to just past its own subtree, it lands below `1.`.
        expect(at(lines, top(4), '2. [x] T', { from: 2, to: 4 }).text).toBe('2. [x] T');
        expect(at(lines, top(4), '2. [x] T').text).toBe('3. [x] T');
    });
});

describe('ListNumber.first', () => {
    it('numbers an ordered head 1, and leaves a bullet as it is', () => {
        expect(ListNumber.first('\t12) [x] T')).toBe('\t1) [x] T');
        expect(ListNumber.first('- [x] T')).toBe('- [x] T');
    });
});
