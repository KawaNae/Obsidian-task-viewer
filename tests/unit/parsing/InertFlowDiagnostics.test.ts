import { describe, it, expect } from 'vitest';
import {
    inertFlowDiagnostic,
    inertNotationOf,
} from '../../../src/services/parsing/tv-inline/InertFlowDiagnostics';
import { lineParsers } from '../../../src/services/parsing/TaskParser';
import { DEFAULT_SETTINGS } from '../../../src/types';

const withDayPlanner = lineParsers({ ...DEFAULT_SETTINGS, enableDayPlanner: true });
const withTasksPlugin = lineParsers({ ...DEFAULT_SETTINGS, enableTasksPlugin: true });
const withDefaults = lineParsers(DEFAULT_SETTINGS);

describe('inertNotationOf', () => {
    it('reports day-planner for a time-range line', () => {
        expect(inertNotationOf('- [ ] 09:00 - 10:00 朝会 ==> every 1d', withDayPlanner)).toBe('day-planner');
    });

    it('reports tasks-plugin for an emoji-date line', () => {
        expect(inertNotationOf('- [ ] 買い物 📅 2026-08-20 ==> every 1w', withTasksPlugin)).toBe('tasks-plugin');
    });

    it('reports nothing for a tv-inline line — its command does fire', () => {
        expect(inertNotationOf('- [ ] 朝会 @2026-08-14 ==> every 1d', withDayPlanner)).toBeNull();
    });

    it('follows the settings: the same line fires once day-planner is off', () => {
        const line = '- [ ] 09:00 - 10:00 朝会 ==> every 1d';
        expect(inertNotationOf(line, withDayPlanner)).toBe('day-planner');
        expect(inertNotationOf(line, withDefaults)).toBeNull();
    });

    it('reports the notation even without a marker (a `- ==>` child is inert too)', () => {
        expect(inertNotationOf('- [ ] 09:00 - 10:00 朝会', withDayPlanner)).toBe('day-planner');
    });

    it('reports nothing for a non-task line', () => {
        expect(inertNotationOf('09:00 - 10:00 朝会 ==> every 1d', withDayPlanner)).toBeNull();
        expect(inertNotationOf('- ==> every 1d', withDayPlanner)).toBeNull();
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
