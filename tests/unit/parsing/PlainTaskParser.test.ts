import { describe, it, expect } from 'vitest';
import { PlainTaskParser } from '../../../src/services/parsing/inline/PlainTaskParser';

describe('PlainTaskParser', () => {
    const parser = new PlainTaskParser();

    it('parses a plain checkbox line without scheduling', () => {
        const task = parser.parse('- [ ] やりたいこと', 'inbox.md', 3);
        expect(task).not.toBeNull();
        expect(task!.parserId).toBe('plain');
        expect(task!.content).toBe('やりたいこと');
        expect(task!.statusChar).toBe(' ');
        expect(task!.startDate).toBeUndefined();
        expect(task!.endDate).toBeUndefined();
        expect(task!.due).toBeUndefined();
        expect(task!.commands).toEqual([]);
    });

    it('captures status char', () => {
        const task = parser.parse('- [x] done', 'inbox.md', 0);
        expect(task!.statusChar).toBe('x');
    });

    it('extracts tags from content', () => {
        const task = parser.parse('- [ ] #errand 買い物 #urgent', 'inbox.md', 0);
        expect(task!.tags).toContain('errand');
        expect(task!.tags).toContain('urgent');
    });

    it('extracts trailing block id', () => {
        const task = parser.parse('- [ ] foo ^abc123', 'inbox.md', 0);
        expect(task!.blockId).toBe('abc123');
        expect(task!.content).toBe('foo');
    });

    it('returns null for non-checkbox lines', () => {
        expect(parser.parse('just text', 'inbox.md', 0)).toBeNull();
        expect(parser.parse('- plain bullet', 'inbox.md', 0)).toBeNull();
        expect(parser.parse('', 'inbox.md', 0)).toBeNull();
    });

    it('accepts checkboxes that other parsers would reject for missing scheduling', () => {
        const task = parser.parse('- [ ] scheduleless', 'inbox.md', 0);
        expect(task).not.toBeNull();
    });

    it('format() round-trips a plain task line', () => {
        const task = parser.parse('- [ ] foo', 'inbox.md', 0)!;
        expect(parser.format(task)).toBe('- [ ] foo');
    });

    it('format() preserves status char and block id', () => {
        const task = parser.parse('- [x] foo ^id1', 'inbox.md', 0)!;
        expect(parser.format(task)).toBe('- [x] foo ^id1');
    });

    it('format() preserves bullet marker (*)', () => {
        const task = parser.parse('* [ ] foo', 'inbox.md', 0)!;
        expect(parser.format(task)).toBe('* [ ] foo');
    });

    it('isTriggerableStatus returns true for non-space status chars', () => {
        expect(parser.isTriggerableStatus({ statusChar: 'x' } as any)).toBe(true);
        expect(parser.isTriggerableStatus({ statusChar: ' ' } as any)).toBe(false);
    });
});
