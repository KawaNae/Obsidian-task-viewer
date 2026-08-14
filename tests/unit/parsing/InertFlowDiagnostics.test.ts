import { describe, it, expect } from 'vitest';
import {
    inertFlowDiagnostic,
    inertNotationOf,
} from '../../../src/services/parsing/tv-inline/InertFlowDiagnostics';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import { DEFAULT_SETTINGS } from '../../../src/types';

const withDayPlanner = { ...DEFAULT_SETTINGS, enableDayPlanner: true };
const withTasksPlugin = { ...DEFAULT_SETTINGS, enableTasksPlugin: true };

describe('inertNotationOf', () => {
    it('reports day-planner for a time-range line', () => {
        TaskParser.withChain(withDayPlanner, () => {
            expect(inertNotationOf('- [ ] 09:00 - 10:00 朝会 ==> every 1d')).toBe('day-planner');
        });
    });

    it('reports tasks-plugin for an emoji-date line', () => {
        TaskParser.withChain(withTasksPlugin, () => {
            expect(inertNotationOf('- [ ] 買い物 📅 2026-08-20 ==> every 1w')).toBe('tasks-plugin');
        });
    });

    it('reports nothing for a tv-inline line — its command does fire', () => {
        TaskParser.withChain(withDayPlanner, () => {
            expect(inertNotationOf('- [ ] 朝会 @2026-08-14 ==> every 1d')).toBeNull();
        });
    });

    it('follows the settings: the same line fires once day-planner is off', () => {
        const line = '- [ ] 09:00 - 10:00 朝会 ==> every 1d';
        TaskParser.withChain(withDayPlanner, () => {
            expect(inertNotationOf(line)).toBe('day-planner');
        });
        TaskParser.withChain(DEFAULT_SETTINGS, () => {
            expect(inertNotationOf(line)).toBeNull();
        });
    });

    it('reports the notation even without a marker (a `- ==>` child is inert too)', () => {
        TaskParser.withChain(withDayPlanner, () => {
            expect(inertNotationOf('- [ ] 09:00 - 10:00 朝会')).toBe('day-planner');
        });
    });

    it('reports nothing for a non-task line', () => {
        TaskParser.withChain(withDayPlanner, () => {
            expect(inertNotationOf('09:00 - 10:00 朝会 ==> every 1d')).toBeNull();
            expect(inertNotationOf('- ==> every 1d')).toBeNull();
        });
    });
});

describe('inertFlowDiagnostic', () => {
    it('is a warning carrying the notation label', () => {
        const d = inertFlowDiagnostic('day-planner', { start: 3, end: 20 });
        expect(d.severity).toBe('warning');
        expect(d.code).toBe('flow.inert-notation');
        expect(d.params).toEqual({ notation: 'Day Planner' });
        expect(d.span).toEqual({ start: 3, end: 20 });
    });

    it('labels the Tasks plugin', () => {
        expect(inertFlowDiagnostic('tasks-plugin', { start: 0, end: 0 }).params)
            .toEqual({ notation: 'Tasks' });
    });
});
