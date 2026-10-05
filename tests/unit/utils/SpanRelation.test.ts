import { describe, it, expect } from 'vitest';
import { endIn, overlaps, startIn, within } from '../../../src/utils/SpanRelation';

const w = { startMs: 100, endMs: 200 };

describe('SpanRelation', () => {
    it('overlaps: a span that ends at the window start, or starts at its end, does not', () => {
        expect(overlaps({ startMs: 50, endMs: 100 }, w)).toBe(false);
        expect(overlaps({ startMs: 200, endMs: 250 }, w)).toBe(false);
        expect(overlaps({ startMs: 50, endMs: 101 }, w)).toBe(true);
        expect(overlaps({ startMs: 199, endMs: 250 }, w)).toBe(true);
    });

    it('overlaps: a point is in the window from its start up to its end', () => {
        expect(overlaps({ startMs: 100, endMs: 100 }, w)).toBe(true);
        expect(overlaps({ startMs: 200, endMs: 200 }, w)).toBe(false);
    });

    it('overlaps: a window that is a moment M is overlapped by a span it falls in, start <= M < end, and a point at M', () => {
        const m = { startMs: 1000, endMs: 1000 };
        expect(overlaps({ startMs: 1000, endMs: 1100 }, m)).toBe(true);
        expect(overlaps({ startMs: 1000, endMs: 1000 }, m)).toBe(true);
        expect(overlaps({ startMs: 900, endMs: 1000 }, m)).toBe(false);
        expect(overlaps({ startMs: 900, endMs: 1001 }, m)).toBe(true);
        expect(overlaps({ startMs: 999, endMs: 999 }, m)).toBe(false);
    });

    it('overlaps and within take an open window', () => {
        expect(overlaps({ startMs: 50, endMs: 60 }, { startMs: -Infinity, endMs: 100 })).toBe(true);
        expect(within({ startMs: 150, endMs: 1e15 }, { startMs: 100, endMs: Infinity })).toBe(true);
    });

    it('within: both ends in the window, the ends included', () => {
        expect(within({ startMs: 100, endMs: 200 }, w)).toBe(true);
        expect(within({ startMs: 99, endMs: 200 }, w)).toBe(false);
        expect(within({ startMs: 100, endMs: 201 }, w)).toBe(false);
    });

    it('startIn takes the window start, endIn its end', () => {
        expect(startIn(100, w)).toBe(true);
        expect(startIn(200, w)).toBe(false);
        expect(endIn(100, w)).toBe(false);
        expect(endIn(200, w)).toBe(true);
    });
});
