import { describe, it, expect } from 'vitest';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import { DEFAULT_SETTINGS } from '../../../src/types';

describe('plain <-> at-notation promotion via re-parse', () => {
    // ParserChain with default settings has [AtNotationParser, PlainTaskParser]
    TaskParser.rebuildChain(DEFAULT_SETTINGS);

    it('plain line parses as parserId=plain', () => {
        const task = TaskParser.parse('- [ ] やりたい', 'inbox.md', 0);
        expect(task).not.toBeNull();
        expect(task!.parserId).toBe('plain');
    });

    it('at-notation line parses as parserId=at-notation', () => {
        const task = TaskParser.parse('- [ ] foo @2026-04-25', 'inbox.md', 0);
        expect(task).not.toBeNull();
        expect(task!.parserId).toBe('at-notation');
        expect(task!.startDate).toBe('2026-04-25');
    });

    it('promotion: plain content edited with @date re-parses as at-notation', () => {
        const plain = TaskParser.parse('- [ ] やりたい', 'inbox.md', 0)!;
        // Simulate user editing: append ` @2026-04-25` to content, re-format, re-parse
        const updated = { ...plain, content: plain.content + ' @2026-04-25' };
        const reformatted = TaskParser.format(updated);
        const reparsed = TaskParser.parse(reformatted, 'inbox.md', 0);
        expect(reparsed).not.toBeNull();
        expect(reparsed!.parserId).toBe('at-notation');
        expect(reparsed!.startDate).toBe('2026-04-25');
    });

    it('demotion: at-notation with @ block stripped re-parses as plain', () => {
        const scheduled = TaskParser.parse('- [ ] foo @2026-04-25', 'inbox.md', 0)!;
        // Simulate: strip scheduling fields on the task and re-format with plain parserId
        const stripped = {
            ...scheduled,
            parserId: 'plain',
            startDate: undefined,
            startTime: undefined,
            endDate: undefined,
            endTime: undefined,
            due: undefined,
        };
        const reformatted = TaskParser.format(stripped);
        const reparsed = TaskParser.parse(reformatted, 'inbox.md', 0);
        expect(reparsed).not.toBeNull();
        expect(reparsed!.parserId).toBe('plain');
        expect(reparsed!.startDate).toBeUndefined();
    });

    it('format dispatches on parserId — plain task emits bare line', () => {
        const plain = TaskParser.parse('- [ ] foo', 'inbox.md', 0)!;
        expect(TaskParser.format(plain)).toBe('- [ ] foo');
    });

    it('format dispatches on parserId — at-notation task emits date block', () => {
        const scheduled = TaskParser.parse('- [ ] foo @2026-04-25', 'inbox.md', 0)!;
        const out = TaskParser.format(scheduled);
        expect(out).toContain('@2026-04-25');
    });

    it('roundtrip preserves blockId for plain tasks', () => {
        const plain = TaskParser.parse('- [ ] foo ^abc123', 'inbox.md', 0)!;
        expect(plain.blockId).toBe('abc123');
        const reformatted = TaskParser.format(plain);
        expect(reformatted).toBe('- [ ] foo ^abc123');
    });
});
