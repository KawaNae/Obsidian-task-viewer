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

    describe('legacy anchors', () => {
        // Timers persisted by earlier versions carry these; the restore guard
        // drops any task ID parse rejects.
        it.each(['ln:3', 'blk:abc', 'tid:tv-t-1', 'seq:7'])('still parses %s', anchor => {
            expect(TaskIdGenerator.parse(`tv-inline:a.md:${anchor}`)?.anchor).toBe(anchor);
        });
    });

    describe('parse', () => {
        it('parses valid ID', () => {
            const result = TaskIdGenerator.parse('tv-inline:notes/daily.md:blk:abc123');
            expect(result).toEqual({ parserId: 'tv-inline', filePath: 'notes/daily.md', anchor: 'blk:abc123' });
        });

        it('parses a legacy fm-root anchor (read only)', () => {
            const result = TaskIdGenerator.parse('tv-file:project.md:fm-root');
            expect(result).toEqual({ parserId: 'tv-file', filePath: 'project.md', anchor: 'fm-root' });
        });

        it('parses ln: anchor', () => {
            const result = TaskIdGenerator.parse('tv-inline:file.md:ln:5');
            expect(result).toEqual({ parserId: 'tv-inline', filePath: 'file.md', anchor: 'ln:5' });
        });

        it('returns null for invalid format', () => {
            expect(TaskIdGenerator.parse('invalid')).toBeNull();
        });
    });

    describe('generate → parse round-trip', () => {
        it('round-trips correctly', () => {
            const id = TaskIdGenerator.generate('tv-inline', 'path/to/file.md', 'blk:xyz');
            const parsed = TaskIdGenerator.parse(id);
            expect(parsed).toEqual({ parserId: 'tv-inline', filePath: 'path/to/file.md', anchor: 'blk:xyz' });
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
        const KEY = '3:12:0123456789abcdef';

        it('is the path, the line and the key of the content read', () => {
            expect(TaskIdGenerator.nameOf('tv-inline', 'a/b.md', 4, KEY)).toBe(`tv-inline:a/b.md:n:4:${KEY}`);
        });

        it('reads back what it says, a path holding a colon too', () => {
            const name = TaskIdGenerator.nameOf('tv-inline', 'a:b.md', 4, KEY);
            expect(TaskIdGenerator.readName(name)).toEqual({ parserId: 'tv-inline', filePath: 'a:b.md', line: 4, content: KEY });
            expect(TaskIdGenerator.parse(name)?.filePath).toBe('a:b.md');
        });

        it('reads nothing of an ID of another shape', () => {
            expect(TaskIdGenerator.readName('tv-inline:a.md:seq:7')).toBeNull();
            expect(TaskIdGenerator.readName('not-an-id')).toBeNull();
        });
    });
});
