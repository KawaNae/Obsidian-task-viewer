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

        it('is never runtime-shaped and never parses', () => {
            const id = TaskIdGenerator.provisionalId('tasks-plugin', 'a.md', 0);
            expect(TaskIdGenerator.isRuntimeId(id)).toBe(false);
            expect(TaskIdGenerator.parse(id)).toBeNull();
        });
    });

    describe('legacy anchors', () => {
        // Timers persisted before the ledger carry these; the restore guard
        // drops any task ID parse rejects.
        it.each(['ln:3', 'blk:abc', 'tid:tv-t-1'])('still parses %s', anchor => {
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

    describe('renameFile', () => {
        it('renames matching file path in ID', () => {
            const id = 'tv-inline:old/path.md:blk:abc';
            const result = TaskIdGenerator.renameFile(id, 'old/path.md', 'new/path.md');
            expect(result).toBe('tv-inline:new/path.md:blk:abc');
        });

        it('preserves non-matching ID', () => {
            const id = 'tv-inline:other.md:blk:abc';
            const result = TaskIdGenerator.renameFile(id, 'old/path.md', 'new/path.md');
            expect(result).toBe(id);
        });

        it('renames segment ID base', () => {
            const id = 'tv-inline:old.md:blk:abc##seg:2026-03-11';
            const result = TaskIdGenerator.renameFile(id, 'old.md', 'new.md');
            expect(result).toBe('tv-inline:new.md:blk:abc##seg:2026-03-11');
        });

        it('renames a runtime seq ID, keeping its number', () => {
            const result = TaskIdGenerator.renameFile('tv-inline:old.md:seq:12', 'old.md', 'new.md');
            expect(result).toBe('tv-inline:new.md:seq:12');
        });
    });

    describe('runtime IDs (seq:)', () => {
        it('parses a seq anchor', () => {
            expect(TaskIdGenerator.parse('tv-inline:a/b.md:seq:7'))
                .toEqual({ parserId: 'tv-inline', filePath: 'a/b.md', anchor: 'seq:7' });
        });

        it('mints parserId:file:seq:n from the counter', () => {
            let n = 0;
            const next = () => ++n;
            const task = { id: 'tv-inline:a.md:ln:3', parserId: 'tv-inline' as const, file: 'a.md' };
            expect(TaskIdGenerator.mintRuntimeId(task, next)).toBe('tv-inline:a.md:seq:1');
            expect(TaskIdGenerator.mintRuntimeId(task, next)).toBe('tv-inline:a.md:seq:2');
        });

        it('accepts only seq as runtime-shaped', () => {
            expect(TaskIdGenerator.isRuntimeId('tv-inline:a.md:seq:1')).toBe(true);
            // Persisted by earlier versions: still parses, never committed.
            expect(TaskIdGenerator.isRuntimeId('tv-file:a.md:fm-root')).toBe(false);
            expect(TaskIdGenerator.isRuntimeId('tv-inline:a.md:ln:1')).toBe(false);
            expect(TaskIdGenerator.isRuntimeId('tv-inline:a.md:blk:abc')).toBe(false);
            expect(TaskIdGenerator.isRuntimeId('tv-inline:a.md:tid:xyz')).toBe(false);
            expect(TaskIdGenerator.isRuntimeId('not-an-id')).toBe(false);
        });
    });
});
