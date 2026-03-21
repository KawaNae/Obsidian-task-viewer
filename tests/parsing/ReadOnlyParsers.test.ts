import { describe, it, expect } from 'vitest';
import { DayPlannerParser } from '../../src/services/parsing/inline/DayPlannerParser';
import { TasksPluginParser } from '../../src/services/parsing/inline/TasksPluginParser';
import type { TasksPluginMapping } from '../../src/types';

const defaultMapping: TasksPluginMapping = {
    start: 'startDate',
    scheduled: 'startDate',
    due: 'due',
};

describe('DayPlannerParser', () => {
    const parser = new DayPlannerParser();

    it('parses time range task', () => {
        const task = parser.parse('- [ ] 08:00 - 09:00 Morning standup meeting', 'daily.md', 3);
        expect(task).not.toBeNull();
        expect(task!.parserId).toBe('day-planner');
        expect(task!.startTime).toBe('08:00');
        expect(task!.endTime).toBe('09:00');
        expect(task!.content).toBe('Morning standup meeting');
        expect(task!.isReadOnly).toBe(true);
    });

    it('parses start-time-only task', () => {
        const task = parser.parse('- [ ] 13:00 Lunch with client', 'daily.md', 5);
        expect(task).not.toBeNull();
        expect(task!.startTime).toBe('13:00');
        expect(task!.endTime).toBeUndefined();
        expect(task!.content).toBe('Lunch with client');
    });

    it('parses completed task', () => {
        const task = parser.parse('- [x] 14:00 - 15:30 Sprint planning', 'daily.md', 6);
        expect(task).not.toBeNull();
        expect(task!.statusChar).toBe('x');
        expect(task!.startTime).toBe('14:00');
        expect(task!.endTime).toBe('15:30');
    });

    it('extracts block ID', () => {
        const task = parser.parse('- [ ] 08:00 Task ^abc123', 'daily.md', 0);
        expect(task).not.toBeNull();
        expect(task!.blockId).toBe('abc123');
        expect(task!.content).toBe('Task');
    });

    it('rejects non-checkbox line', () => {
        expect(parser.parse('08:00 - 09:00 Meeting', 'daily.md', 0)).toBeNull();
    });

    it('rejects line without time at start', () => {
        expect(parser.parse('- [ ] Task without time', 'daily.md', 0)).toBeNull();
    });

    it('has no startDate or endDate', () => {
        const task = parser.parse('- [ ] 09:00 - 10:00 Test', 'daily.md', 0);
        expect(task!.startDate).toBeUndefined();
        expect(task!.endDate).toBeUndefined();
    });

    it('format returns originalText', () => {
        const task = parser.parse('- [ ] 09:00 Test', 'daily.md', 0)!;
        expect(parser.format(task)).toBe('- [ ] 09:00 Test');
    });

    it('isTriggerableStatus returns false', () => {
        const task = parser.parse('- [x] 09:00 Done', 'daily.md', 0)!;
        expect(parser.isTriggerableStatus(task)).toBe(false);
    });
});

describe('TasksPluginParser', () => {
    const parser = new TasksPluginParser(defaultMapping);

    it('parses due date', () => {
        const task = parser.parse('- [ ] Buy groceries 📅 2026-03-21', 'test.md', 0);
        expect(task).not.toBeNull();
        expect(task!.parserId).toBe('tasks-plugin');
        expect(task!.due).toBe('2026-03-21');
        expect(task!.content).toBe('Buy groceries');
        expect(task!.isReadOnly).toBe(true);
    });

    it('parses start date', () => {
        const task = parser.parse('- [ ] Project planning 🛫 2026-03-21', 'test.md', 0);
        expect(task).not.toBeNull();
        expect(task!.startDate).toBe('2026-03-21');
    });

    it('parses scheduled as startDate fallback', () => {
        const task = parser.parse('- [ ] Review PR ⏳ 2026-03-21', 'test.md', 0);
        expect(task).not.toBeNull();
        expect(task!.startDate).toBe('2026-03-21');
    });

    it('start wins over scheduled for startDate', () => {
        const task = parser.parse('- [ ] Meeting 🛫 2026-03-21 ⏳ 2026-03-22', 'test.md', 0);
        expect(task).not.toBeNull();
        expect(task!.startDate).toBe('2026-03-21');
    });

    it('parses multiple fields', () => {
        const task = parser.parse('- [ ] Big project 🛫 2026-03-21 📅 2026-03-28', 'test.md', 0);
        expect(task).not.toBeNull();
        expect(task!.startDate).toBe('2026-03-21');
        expect(task!.due).toBe('2026-03-28');
    });

    it('parses completed task', () => {
        const task = parser.parse('- [x] Done ✅ 2026-03-20 📅 2026-03-20', 'test.md', 0);
        expect(task).not.toBeNull();
        expect(task!.statusChar).toBe('x');
        expect(task!.due).toBe('2026-03-20');
    });

    it('rejects plain checkbox without emoji dates', () => {
        expect(parser.parse('- [ ] Plain checkbox without dates', 'test.md', 0)).toBeNull();
    });

    it('rejects emoji without date', () => {
        expect(parser.parse('- [ ] Task with emoji but no date ⏫', 'test.md', 0)).toBeNull();
    });

    it('rejects non-checkbox line', () => {
        expect(parser.parse('Not a checkbox 📅 2026-03-21', 'test.md', 0)).toBeNull();
    });

    it('strips emoji fields from content', () => {
        const task = parser.parse('- [ ] Buy groceries 📅 2026-03-21 🛫 2026-03-20', 'test.md', 0);
        expect(task!.content).toBe('Buy groceries');
    });

    it('respects custom mapping', () => {
        const customParser = new TasksPluginParser({
            start: 'startDate',
            scheduled: 'endDate',
            due: 'due',
        });
        const task = customParser.parse('- [ ] Task 🛫 2026-03-21 ⏳ 2026-03-25 📅 2026-03-28', 'test.md', 0);
        expect(task).not.toBeNull();
        expect(task!.startDate).toBe('2026-03-21');
        expect(task!.endDate).toBe('2026-03-25');
        expect(task!.due).toBe('2026-03-28');
    });

    it('ignores emoji when mapping is ignore', () => {
        const customParser = new TasksPluginParser({
            start: 'startDate',
            scheduled: 'ignore',
            due: 'due',
        });
        const task = customParser.parse('- [ ] Task ⏳ 2026-03-21 📅 2026-03-28', 'test.md', 0);
        expect(task).not.toBeNull();
        expect(task!.startDate).toBeUndefined();
        expect(task!.due).toBe('2026-03-28');
    });

    it('format returns originalText', () => {
        const task = parser.parse('- [ ] Task 📅 2026-03-21', 'test.md', 0)!;
        expect(parser.format(task)).toBe('- [ ] Task 📅 2026-03-21');
    });

    it('isTriggerableStatus returns false', () => {
        const task = parser.parse('- [x] Done 📅 2026-03-21', 'test.md', 0)!;
        expect(parser.isTriggerableStatus(task)).toBe(false);
    });
});
