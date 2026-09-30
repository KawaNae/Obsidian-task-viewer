import { describe, it, expect } from 'vitest';
import { TaskIdGenerator } from '../../../src/services/display/TaskIdGenerator';

describe('TaskIdGenerator', () => {
    describe('generate', () => {
        it('creates parserId:filePath:anchor format', () => {
            expect(TaskIdGenerator.generate('tv-inline', 'notes/daily.md', 'blk:abc123')).toBe('tv-inline:notes/daily.md:blk:abc123');
        });
    });

    describe('provisionalId', () => {
        it('is line-based, whatever block ID the line carries', () => {
            expect(TaskIdGenerator.provisionalId('tv-inline', 'a.md', 5)).toBe('tv-inline:a.md:prov:5');
        });

        it('never parses', () => {
            const id = TaskIdGenerator.provisionalId('tasks-plugin', 'a.md', 0);
            expect(TaskIdGenerator.parse(id)).toBeNull();
        });
    });

    describe('anchors that are no longer minted', () => {
        // `seq:`, `blk:`, `tid:`, `ln:` and `fm-root` came before names; no ID
        // of those shapes is minted or persisted any more.
        it.each(['ln:3', 'blk:abc', 'tid:tv-t-1', 'seq:7', 'fm-root'])('does not parse %s', anchor => {
            expect(TaskIdGenerator.parse(`tv-inline:a.md:${anchor}`)).toBeNull();
        });
    });

    describe('parse', () => {
        it('parses a name', () => {
            const result = TaskIdGenerator.parse('tv-inline:notes/daily.md:n:k1.2:5');
            expect(result).toEqual({ parserId: 'tv-inline', filePath: 'notes/daily.md', anchor: 'n:k1.2:5' });
        });

        it('returns null for invalid format', () => {
            expect(TaskIdGenerator.parse('invalid')).toBeNull();
        });
    });

    describe('nameOf → parse round-trip', () => {
        it('round-trips correctly', () => {
            const id = TaskIdGenerator.nameOf('tv-inline', 'path/to/file.md', 7, 'k1.2');
            const parsed = TaskIdGenerator.parse(id);
            expect(parsed).toEqual({ parserId: 'tv-inline', filePath: 'path/to/file.md', anchor: 'n:k1.2:7' });
        });
    });

    describe('makeSegmentId / parseSegmentId', () => {
        it('creates segment ID', () => {
            const seg = TaskIdGenerator.makeSegmentId('base-id', '2026-03-11');
            expect(seg).toBe('base-id##seg:2026-03-11');
        });

        it('parses segment ID', () => {
            const result = TaskIdGenerator.parseSegmentId('base-id##seg:2026-03-11');
            expect(result).toEqual({ baseId: 'base-id', segmentDate: '2026-03-11' });
        });

        it('returns null for non-segment ID', () => {
            expect(TaskIdGenerator.parseSegmentId('not-a-segment')).toBeNull();
        });

        it('round-trips', () => {
            const seg = TaskIdGenerator.makeSegmentId('my-id', '2026-01-01');
            const parsed = TaskIdGenerator.parseSegmentId(seg);
            expect(parsed).toEqual({ baseId: 'my-id', segmentDate: '2026-01-01' });
        });
    });

    describe('names (nameOf / readName)', () => {
        const READING = 'mugdzal02.3';

        it('is the path, the reading and the line', () => {
            expect(TaskIdGenerator.nameOf('tv-inline', 'a/b.md', 4, READING)).toBe(`tv-inline:a/b.md:n:${READING}:4`);
        });

        it('reads back what it says, a path holding a colon too', () => {
            const name = TaskIdGenerator.nameOf('tv-inline', 'a:b.md', 4, READING);
            expect(TaskIdGenerator.readName(name)).toEqual({ parserId: 'tv-inline', filePath: 'a:b.md', reading: READING, line: 4 });
            expect(TaskIdGenerator.parse(name)?.filePath).toBe('a:b.md');
        });

        it('reads nothing of an ID of another shape', () => {
            expect(TaskIdGenerator.readName('tv-inline:a.md:seq:7')).toBeNull();
            expect(TaskIdGenerator.readName('not-an-id')).toBeNull();
        });
    });
});
