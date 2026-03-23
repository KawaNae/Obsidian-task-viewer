import { describe, it, expect } from 'vitest';
import { TaskIdGenerator } from '../../../src/services/display/TaskIdGenerator';

describe('TaskIdGenerator', () => {
    describe('generate', () => {
        it('creates parserId:filePath:anchor format', () => {
            expect(TaskIdGenerator.generate('at-notation', 'notes/daily.md', 'blk:abc123')).toBe('at-notation:notes/daily.md:blk:abc123');
        });
    });

    describe('resolveAnchor', () => {
        it('prioritizes blockId', () => {
            expect(TaskIdGenerator.resolveAnchor({ blockId: 'abc', timerTargetId: 'tid1', line: 5, parserId: 'at-notation' })).toBe('blk:abc');
        });

        it('uses timerTargetId when no blockId', () => {
            expect(TaskIdGenerator.resolveAnchor({ timerTargetId: 'tid1', line: 5, parserId: 'at-notation' })).toBe('tid:tid1');
        });

        it('uses fm-root for frontmatter parser', () => {
            expect(TaskIdGenerator.resolveAnchor({ parserId: 'frontmatter' })).toBe('fm-root');
        });

        it('uses line number (1-based) when no other anchor', () => {
            expect(TaskIdGenerator.resolveAnchor({ line: 5, parserId: 'at-notation' })).toBe('ln:6');
        });

        it('falls back to ln:0', () => {
            expect(TaskIdGenerator.resolveAnchor({ parserId: 'at-notation' })).toBe('ln:0');
        });
    });

    describe('parse', () => {
        it('parses valid ID', () => {
            const result = TaskIdGenerator.parse('at-notation:notes/daily.md:blk:abc123');
            expect(result).toEqual({ parserId: 'at-notation', filePath: 'notes/daily.md', anchor: 'blk:abc123' });
        });

        it('parses fm-root anchor', () => {
            const result = TaskIdGenerator.parse('frontmatter:project.md:fm-root');
            expect(result).toEqual({ parserId: 'frontmatter', filePath: 'project.md', anchor: 'fm-root' });
        });

        it('parses ln: anchor', () => {
            const result = TaskIdGenerator.parse('at-notation:file.md:ln:5');
            expect(result).toEqual({ parserId: 'at-notation', filePath: 'file.md', anchor: 'ln:5' });
        });

        it('returns null for invalid format', () => {
            expect(TaskIdGenerator.parse('invalid')).toBeNull();
        });
    });

    describe('generate → parse round-trip', () => {
        it('round-trips correctly', () => {
            const id = TaskIdGenerator.generate('at-notation', 'path/to/file.md', 'blk:xyz');
            const parsed = TaskIdGenerator.parse(id);
            expect(parsed).toEqual({ parserId: 'at-notation', filePath: 'path/to/file.md', anchor: 'blk:xyz' });
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
            const id = 'at-notation:old/path.md:blk:abc';
            const result = TaskIdGenerator.renameFile(id, 'old/path.md', 'new/path.md');
            expect(result).toBe('at-notation:new/path.md:blk:abc');
        });

        it('preserves non-matching ID', () => {
            const id = 'at-notation:other.md:blk:abc';
            const result = TaskIdGenerator.renameFile(id, 'old/path.md', 'new/path.md');
            expect(result).toBe(id);
        });

        it('renames segment ID base', () => {
            const id = 'at-notation:old.md:blk:abc##seg:2026-03-11';
            const result = TaskIdGenerator.renameFile(id, 'old.md', 'new.md');
            expect(result).toBe('at-notation:new.md:blk:abc##seg:2026-03-11');
        });
    });
});
