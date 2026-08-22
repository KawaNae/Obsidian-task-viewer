import { describe, it, expect } from 'vitest';
import { enabledLineParserIds, TaskParser } from '../../../src/services/parsing/TaskParser';
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

    it('never names tv-file — a tv-file task is frontmatter, not a line', () => {
        const ids = enabledLineParserIds(settingsWith({
            enableDayPlanner: true, enableTasksPlugin: true,
        }));
        expect(ids).not.toContain('tv-file');
    });
});

describe('the chain built from that list', () => {
    it('holds one parser per id, in the same order', () => {
        const settings = settingsWith({ enableDayPlanner: true, enableTasksPlugin: true });

        TaskParser.withChain(settings, () => {
            const chain = TaskParser.getStrategy() as unknown as { parsers: { id: string }[] };
            // Mutation: build the chain from its own settings checks again and
            // the two answers can drift — which is the whole reason the list
            // is derived once.
            expect(chain.parsers.map(p => p.id)).toEqual(enabledLineParserIds(settings));
        });
    });

    it('is restored after withChain, list and all', () => {
        const before = TaskParser.getStrategy();
        TaskParser.withChain(settingsWith({ enableDayPlanner: true }), () => { /* swapped */ });
        expect(TaskParser.getStrategy()).toBe(before);
    });
});
