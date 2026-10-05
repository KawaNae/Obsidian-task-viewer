import { describe, it, expect, afterEach, vi } from 'vitest';
import { TaskApi } from '../../../src/api/TaskApi';
import { TaskReadService } from '../../../src/services/data/TaskReadService';
import { createEmptyFilterState, type FilterState } from '../../../src/services/filter/FilterTypes';
import { daysWindow, dayStart, type TimeWindow } from '../../../src/utils/DayWindow';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';

/**
 * The API's windows are the views' window (stage 11e): the same FilterState
 * and the same days give the same tasks from `list` (`date`, `from`/`to`),
 * `today`, `tasksForDateRange` and a view's `tasksInWindow`. startHour 5;
 * D is 2026-10-04, a Sunday (the week from Monday 09-28).
 */

let live: VaultSession | null = null;

afterEach(() => {
    live?.dispose();
    live = null;
    vi.useRealTimers();
});

const D = '2026-10-04';
const NOTES = {
    'w.md': [
        '- [ ] d @2026-10-04',
        '- [ ] d10 #work @2026-10-04T10:00',
        '- [ ] next-03 @2026-10-05T03:00',
        '- [ ] to-boundary @2026-10-04T22:00>2026-10-05T05:00',
        '- [ ] point @2026-10-04T05:00>05:00',
        '- [ ] due-only #work @>>2026-10-04',
        '- [ ] due-17 @>>2026-10-04T17:00',
        '- [ ] prev @2026-10-03',
        '- [ ] next @2026-10-05',
        '- [ ] monday #work @2026-09-28',
        '- [ ] undated #work',
        '- [ ] rule4 @2026-10-04>2026-10-04T02:00',
        '- [ ] parent #work @2026-10-04',
        '    - [ ] child @2026-10-05',
        '',
    ],
};

const FILTERS: [string, FilterState][] = [
    ['no condition', createEmptyFilterState()],
    ['tag includes work', { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: ['work'] }] }],
    ['an or-group', { logic: 'and', filters: [{ logic: 'or', filters: [
        { property: 'tag', operator: 'includes', value: ['work'] },
        { property: 'content', operator: 'contains', value: 'next' },
    ] }] }],
    ['period within thisWeek', { logic: 'and', filters: [{ property: 'period', operator: 'within', value: { preset: 'thisWeek' } }] }],
    ['due equals today', { logic: 'and', filters: [{ property: 'due', operator: 'equals', value: { preset: 'today' } }] }],
];

const WINDOWS: [string, string][] = [
    [D, D],
    ['2026-10-05', '2026-10-05'],
    ['2026-10-03', '2026-10-05'],
];

async function open(startHour = 5, files: Record<string, string> = {}) {
    // Now is noon of D: today and the presets count from it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 4, 12, 0));
    const { session } = await openLiveVault(NOTES, s => { live = s; });
    const read = new TaskReadService(session.index, () => ({ startHour, weekStartDay: 1 }));
    const app = Object.assign(session.app, {
        vault: Object.assign(session.app.vault, {
            adapter: { exists: async (path: string) => path in files, read: async (path: string) => files[path] },
        }),
    });
    const api = new TaskApi({
        app,
        settings: { startHour, weekStartDay: 1 },
        getTaskReadService: () => read,
        getIndex: () => session.index,
        getOperations: () => session.ops,
    } as never);
    return { read, api };
}

/** The first word of each task's content: its name in NOTES. */
const names = (tasks: { content: string }[]) => tasks.map(t => t.content.split(' ')[0]).sort();

function inWindow(read: TaskReadService, window: TimeWindow, filter: FilterState, includeInvalid = true): string[] {
    return names(read.tasksInWindow(window, filter, includeInvalid ? { includeInvalid } : undefined));
}

describe.each(FILTERS)('%s', (_title, filter) => {
    it.each(WINDOWS)('list, tasksForDateRange and tasksInWindow agree on %s to %s', async (from, to) => {
        const { read, api } = await open();
        const expected = inWindow(read, daysWindow(from, to, 5), filter);
        expect(names((await api.list({ from, to, filter, limit: Infinity })).tasks)).toEqual(expected);
        expect(names((await api.tasksForDateRange({ from, to, filter, limit: Infinity })).tasks)).toEqual(expected);
        if (from === to) {
            expect(names((await api.list({ date: from, filter, limit: Infinity })).tasks)).toEqual(expected);
        }
    });

    it('today is the window of D', async () => {
        const { read, api } = await open();
        expect(names((await api.today({ filter, limit: Infinity })).tasks)).toEqual(inWindow(read, daysWindow(D, D, 5), filter));
    });

    it('an open range is the window from D on', async () => {
        const { read, api } = await open();
        const window = { startMs: dayStart(D, 5), endMs: Infinity };
        expect(names((await api.list({ from: D, filter, limit: Infinity })).tasks)).toEqual(inWindow(read, window, filter));
    });

    // A filter file with no condition is refused as it is read (FilterFileLoader).
    it.skipIf(filter.filters.length === 0)('a filter file is the window without the invalid tasks', async () => {
        const { read, api } = await open(5, { 'f.json': JSON.stringify(filter) });
        expect(names((await api.list({ filterFile: 'f.json', date: D, limit: Infinity })).tasks))
            .toEqual(inWindow(read, daysWindow(D, D, 5), filter, false));
    });
});

describe('a query\'s startHour', () => {
    it.each(FILTERS)('list with startHour 0 is the view of a vault set to 0 (%s)', async (_title, filter) => {
        const { api } = await open(5);
        const listed = names((await api.list({ date: D, startHour: 0, filter, limit: Infinity })).tasks);
        live?.dispose();
        const { read: atZero } = await open(0);
        expect(listed).toEqual(inWindow(atZero, daysWindow(D, D, 0), filter));
    });
});

describe('the parity reaches the cases the window used to answer otherwise', () => {
    it('a point right at the window\'s start is in list date=D, as in the view', async () => {
        const { api } = await open();
        expect(names((await api.list({ date: D })).tasks)).toEqual(
            ['d', 'd10', 'due-17', 'due-only', 'next-03', 'parent', 'point', 'rule4', 'to-boundary']);
    });

    it('a task ending right at the boundary is not on the next day', async () => {
        const { api } = await open();
        expect(names((await api.list({ date: '2026-10-05' })).tasks)).not.toContain('to-boundary');
    });
});
