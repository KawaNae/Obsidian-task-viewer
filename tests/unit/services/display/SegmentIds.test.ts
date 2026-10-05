import { describe, it, expect } from 'vitest';
import { makeSegmentId, mapRow, parseSegmentId } from '../../../../src/services/display/SegmentIds';

describe('SegmentIds', () => {
    it('creates segment ID', () => {
        expect(makeSegmentId('base-id', '2026-03-11')).toBe('base-id##seg:2026-03-11');
    });

    it('parses segment ID', () => {
        expect(parseSegmentId('base-id##seg:2026-03-11')).toEqual({ baseId: 'base-id', segmentDate: '2026-03-11' });
    });

    it('returns null for non-segment ID', () => {
        expect(parseSegmentId('not-a-segment')).toBeNull();
    });

    it('round-trips', () => {
        expect(parseSegmentId(makeSegmentId('my-id', '2026-01-01'))).toEqual({ baseId: 'my-id', segmentDate: '2026-01-01' });
    });

    it('maps the row of a segment and keeps its suffix', () => {
        expect(mapRow('a##seg:2026-01-01', row => row.toUpperCase())).toBe('A##seg:2026-01-01');
        expect(mapRow('a', row => row.toUpperCase())).toBe('A');
        expect(mapRow('a##seg:2026-01-01', () => undefined)).toBeUndefined();
    });
});
