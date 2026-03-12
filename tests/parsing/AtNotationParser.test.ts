import { describe, it, expect } from 'vitest';
import { AtNotationParser } from '../../src/services/parsing/inline/AtNotationParser';
import type { Task } from '../../src/types';

const parser = new AtNotationParser();

/** Helper to build a minimal Task for format() testing. */
function makeTask(overrides: Partial<Task>): Task {
    return {
        id: 'test:file.md:ln:1',
        file: 'file.md',
        line: 0,
        content: 'task',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        tags: [],
        originalText: '- [ ] task @2026-01-01',
        parserId: 'at-notation',
        ...overrides,
    };
}

describe('AtNotationParser', () => {
    describe('parse', () => {
        it('parses basic date-only task', () => {
            const result = parser.parse('- [ ] hello @2026-01-15', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.content).toBe('hello');
            expect(result!.statusChar).toBe(' ');
            expect(result!.startDate).toBe('2026-01-15');
            expect(result!.startTime).toBeUndefined();
            expect(result!.endDate).toBeUndefined();
            expect(result!.endTime).toBeUndefined();
            expect(result!.due).toBeUndefined();
        });

        it('parses date with time', () => {
            const result = parser.parse('- [ ] meeting @2026-01-15T09:00', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.startDate).toBe('2026-01-15');
            expect(result!.startTime).toBe('09:00');
        });

        it('parses start>end range', () => {
            const result = parser.parse('- [ ] event @2026-01-15T09:00>2026-01-15T17:00', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.startDate).toBe('2026-01-15');
            expect(result!.startTime).toBe('09:00');
            expect(result!.endDate).toBe('2026-01-15');
            expect(result!.endTime).toBe('17:00');
        });

        it('parses start>end>due', () => {
            const result = parser.parse('- [ ] task @2026-01-15>2026-01-16>2026-01-20', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.startDate).toBe('2026-01-15');
            expect(result!.endDate).toBe('2026-01-16');
            expect(result!.due).toBe('2026-01-20');
        });

        it('parses time-only start', () => {
            const result = parser.parse('- [ ] task @T09:00', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.startDate).toBe('');
            expect(result!.startTime).toBe('09:00');
        });

        it('parses same-day end time', () => {
            const result = parser.parse('- [ ] task @2026-01-15T09:00>17:00', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.startTime).toBe('09:00');
            expect(result!.endTime).toBe('17:00');
            expect(result!.endDate).toBeUndefined();
        });

        it('parses completed status', () => {
            const result = parser.parse('- [x] done @2026-01-15', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.statusChar).toBe('x');
        });

        it('parses flow commands', () => {
            const result = parser.parse('- [ ] task @2026-01-15 ==> move(target)', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.commands).toHaveLength(1);
            expect(result!.commands![0].name).toBe('move');
            expect(result!.commands![0].args).toEqual(['target']);
        });

        it('parses flow command with modifiers', () => {
            const result = parser.parse('- [ ] task @2026-01-15 ==> cmd(a).mod(b)', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.commands![0].modifiers).toHaveLength(1);
            expect(result!.commands![0].modifiers[0].name).toBe('mod');
        });

        it('parses block id', () => {
            const result = parser.parse('- [ ] task @2026-01-15 ^abc123', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.blockId).toBe('abc123');
        });

        it('extracts tags from content', () => {
            const result = parser.parse('- [ ] task #important #urgent @2026-01-15', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.tags).toContain('important');
            expect(result!.tags).toContain('urgent');
        });

        it('returns null for non-task line', () => {
            expect(parser.parse('just text', 'test.md', 0)).toBeNull();
            expect(parser.parse('- plain list', 'test.md', 0)).toBeNull();
            expect(parser.parse('', 'test.md', 0)).toBeNull();
        });

        it('returns null for checkbox without date/command', () => {
            expect(parser.parse('- [ ] no date here', 'test.md', 0)).toBeNull();
        });

        it('parses with asterisk marker', () => {
            const result = parser.parse('* [ ] star task @2026-03-01', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.content).toBe('star task');
            expect(result!.startDate).toBe('2026-03-01');
        });

        it('parses with plus marker', () => {
            const result = parser.parse('+ [ ] plus task @2026-03-01', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.content).toBe('plus task');
        });

        it('parses with numbered marker', () => {
            const result = parser.parse('1. [ ] numbered task @2026-03-01', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.content).toBe('numbered task');
        });

        it('parses flow-command-only task (no date)', () => {
            const result = parser.parse('- [ ] task ==> cmd(arg)', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.commands).toHaveLength(1);
            expect(result!.startDate).toBe('');
        });

        it('parses empty end segment (@start>>due)', () => {
            const result = parser.parse('- [ ] task @2026-01-15>>2026-02-01', 'test.md', 0);
            expect(result).not.toBeNull();
            expect(result!.startDate).toBe('2026-01-15');
            expect(result!.endDate).toBeUndefined();
            expect(result!.due).toBe('2026-02-01');
        });
    });

    describe('format', () => {
        it('formats basic task', () => {
            const task = makeTask({
                content: 'hello',
                startDate: '2026-01-15',
            });
            expect(parser.format(task)).toBe('- [ ] hello @2026-01-15');
        });

        it('formats task with time', () => {
            const task = makeTask({
                content: 'meeting',
                startDate: '2026-01-15',
                startTime: '09:00',
            });
            expect(parser.format(task)).toBe('- [ ] meeting @2026-01-15T09:00');
        });

        it('formats task with end date/time', () => {
            const task = makeTask({
                content: 'event',
                startDate: '2026-01-15',
                startTime: '09:00',
                endDate: '2026-01-15',
                endTime: '17:00',
            });
            expect(parser.format(task)).toBe('- [ ] event @2026-01-15T09:00>17:00');
        });

        it('formats task with due', () => {
            const task = makeTask({
                content: 'task',
                startDate: '2026-01-15',
                due: '2026-01-20',
            });
            expect(parser.format(task)).toBe('- [ ] task @2026-01-15>>2026-01-20');
        });

        it('formats task with different end date', () => {
            const task = makeTask({
                content: 'multi-day',
                startDate: '2026-01-15',
                endDate: '2026-01-17',
            });
            expect(parser.format(task)).toBe('- [ ] multi-day @2026-01-15>2026-01-17');
        });

        it('formats task with flow commands', () => {
            const task = makeTask({
                content: 'task',
                startDate: '2026-01-15',
                commands: [{ name: 'move', args: ['target'], modifiers: [] }],
            });
            expect(parser.format(task)).toBe('- [ ] task @2026-01-15 ==> move(target)');
        });

        it('formats task with block id', () => {
            const task = makeTask({
                content: 'task',
                startDate: '2026-01-15',
                blockId: 'abc123',
            });
            expect(parser.format(task)).toBe('- [ ] task @2026-01-15 ^abc123');
        });

        it('preserves asterisk marker', () => {
            const task = makeTask({
                content: 'star task',
                startDate: '2026-03-01',
                originalText: '* [ ] star task @2026-03-01',
            });
            expect(parser.format(task)).toBe('* [ ] star task @2026-03-01');
        });

        it('preserves plus marker', () => {
            const task = makeTask({
                content: 'plus task',
                startDate: '2026-03-01',
                originalText: '+ [ ] plus task @2026-03-01',
            });
            expect(parser.format(task)).toBe('+ [ ] plus task @2026-03-01');
        });

        it('preserves numbered marker', () => {
            const task = makeTask({
                content: 'num task',
                startDate: '2026-03-01',
                originalText: '1. [ ] num task @2026-03-01',
            });
            expect(parser.format(task)).toBe('1. [ ] num task @2026-03-01');
        });

        it('formats completed status', () => {
            const task = makeTask({
                content: 'done',
                statusChar: 'x',
                startDate: '2026-01-15',
            });
            expect(parser.format(task)).toBe('- [x] done @2026-01-15');
        });
    });

    describe('parse → format round-trip', () => {
        const roundTrip = (line: string) => {
            const task = parser.parse(line, 'test.md', 0);
            expect(task).not.toBeNull();
            return parser.format(task!);
        };

        it('round-trips basic task', () => {
            expect(roundTrip('- [ ] hello @2026-01-15')).toBe('- [ ] hello @2026-01-15');
        });

        it('round-trips timed task', () => {
            expect(roundTrip('- [ ] meeting @2026-01-15T09:00')).toBe('- [ ] meeting @2026-01-15T09:00');
        });

        it('round-trips same-day range', () => {
            expect(roundTrip('- [ ] event @2026-01-15T09:00>17:00')).toBe('- [ ] event @2026-01-15T09:00>17:00');
        });

        it('round-trips multi-day range', () => {
            expect(roundTrip('- [ ] trip @2026-01-15>2026-01-17')).toBe('- [ ] trip @2026-01-15>2026-01-17');
        });

        it('round-trips with due', () => {
            expect(roundTrip('- [ ] task @2026-01-15>>2026-01-20')).toBe('- [ ] task @2026-01-15>>2026-01-20');
        });

        it('round-trips asterisk marker', () => {
            expect(roundTrip('* [ ] star @2026-01-15')).toBe('* [ ] star @2026-01-15');
        });

        it('round-trips plus marker', () => {
            expect(roundTrip('+ [ ] plus @2026-01-15')).toBe('+ [ ] plus @2026-01-15');
        });

        it('round-trips numbered marker', () => {
            expect(roundTrip('1. [ ] num @2026-01-15')).toBe('1. [ ] num @2026-01-15');
        });
    });
});
