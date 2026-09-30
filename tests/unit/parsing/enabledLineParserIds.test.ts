import { describe, it, expect } from 'vitest';
import { enabledLineParserIds, lineParsers, lineParsersFingerprint } from '../../../src/services/parsing/TaskParser';
import { DEFAULT_SETTINGS } from '../../../src/types';
import type { TaskViewerSettings } from '../../../src/types';

/**
 * Which line parsers the settings turn on, and in what order.
 *
 * The order is the chain's precedence, not a presentation choice: an external
 * notation parser claims only lines matching its own syntax, so it has to be
 * offered the line before `tv-inline`, which accepts any checkbox at all. Put
 * `tv-inline` first and the other two never see anything.
 *
 * The list had a second, looser copy in main.ts, which derived the same answer
 * from the same settings to name the active parsers in the diagnostics report.
 * Both now read this.
 */

function settingsWith(over: Partial<TaskViewerSettings>): TaskViewerSettings {
    return { ...DEFAULT_SETTINGS, ...over };
}

describe('enabledLineParserIds', () => {
    it('is just the catch-all when no external notation is enabled', () => {
        expect(enabledLineParserIds(settingsWith({
            enableDayPlanner: false, enableTasksPlugin: false,
        }))).toEqual(['tv-inline']);
    });

    it('offers each enabled external parser the line before the catch-all', () => {
        // Mutation: push 'tv-inline' first and every day-planner line is
        // claimed by the catch-all before its own parser is asked.
        expect(enabledLineParserIds(settingsWith({
            enableDayPlanner: true, enableTasksPlugin: false,
        }))).toEqual(['day-planner', 'tv-inline']);

        expect(enabledLineParserIds(settingsWith({
            enableDayPlanner: false, enableTasksPlugin: true,
        }))).toEqual(['tasks-plugin', 'tv-inline']);
    });

    it('keeps day-planner ahead of tasks-plugin when both are on', () => {
        expect(enabledLineParserIds(settingsWith({
            enableDayPlanner: true, enableTasksPlugin: true,
        }))).toEqual(['day-planner', 'tasks-plugin', 'tv-inline']);
    });

    it('names each parser once, and only parsers the chain can build', () => {
        const ids = enabledLineParserIds(settingsWith({
            enableDayPlanner: true, enableTasksPlugin: true,
        }));
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.every(id => ['tv-inline', 'tasks-plugin', 'day-planner'].includes(id))).toBe(true);
    });
});

describe('the chain built from that list', () => {
    it('holds one parser per id, in the same order', () => {
        const settings = settingsWith({ enableDayPlanner: true, enableTasksPlugin: true });
        const chain = lineParsers(settings) as unknown as { parsers: { id: string }[] };
        // Mutation: build the chain from its own settings checks again and
        // the two answers can drift — which is the whole reason the list
        // is derived once.
        expect(chain.parsers.map(p => p.id)).toEqual(enabledLineParserIds(settings));
    });

    it('is built from the settings it is handed, and from nothing else', () => {
        const line = '- [ ] 09:00 - 10:00 standup';
        expect(lineParsers(settingsWith({ enableDayPlanner: true })).parse(line, 'n.md', 0)!.parserId).toBe('day-planner');
        // Mutation: keep a chain between calls and this reads day-planner too.
        expect(lineParsers(settingsWith({ enableDayPlanner: false })).parse(line, 'n.md', 0)!.parserId).toBe('tv-inline');
    });
});

describe('lineParsersFingerprint', () => {
    it('changes with what the chain reads, and only with that', () => {
        const base = lineParsersFingerprint(DEFAULT_SETTINGS);
        expect(lineParsersFingerprint(settingsWith({ enableDayPlanner: true }))).not.toBe(base);
        expect(lineParsersFingerprint(settingsWith({ enableTasksPlugin: true }))).not.toBe(base);
        expect(lineParsersFingerprint(settingsWith({
            tasksPluginMapping: { ...DEFAULT_SETTINGS.tasksPluginMapping, start: 'due' as const },
        }))).not.toBe(base);
        expect(lineParsersFingerprint(settingsWith({ startHour: DEFAULT_SETTINGS.startHour + 1 }))).toBe(base);
    });
});
