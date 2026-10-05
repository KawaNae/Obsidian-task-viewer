/**
 * The entry's shorthand and a query's start hour (段11e), in the running Dev
 * vault: the CLI's and the API's params are conditions of one FilterState,
 * taken together (date, from and to as period overlaps, the simple flags,
 * filter-file and the API's filter), so list, today, the two range commands
 * and Timeline answer the same window; today is list date=today; a query's
 * start-hour moves the visual day of that call alone.
 *
 * The days are a week W far from today (the week of today + 21 days), and
 * today's visual day D only for today. The tasks are in a note of the
 * test's own, removed at the end.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/query-shorthand.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    cliCategorizedTasksForDateRange, cliGet, cliList, cliTasksForDateRange, cliToday, isObsidianRunning, obsidianEval,
} from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile, writeTestFile } from '../helpers/test-file-manager';
import { PRELUDE, addDays, closeViews, ev, openView, readSettings, visualDay, weekStart } from '../helpers/view-helper';

const FILE = 'test-int-query-shorthand.md';
const FILTER_FILE = 'test-int-query-shorthand.json';
const TAG = 'tvqs';
const WORK = 'tvqswork';

/** W's first day, and the day n days from it. */
let W: string;
const w = (n: number) => addDays(W, n);
/** Today's visual day. */
let D: string;

function note(): string {
    return [
        `- [ ] qs-w #${TAG} @${w(0)}`,
        `- [ ] qs-w-10 #${TAG} @${w(0)}T10:00>11:00`,
        `- [ ] qs-w-9 #${TAG} @${w(0)}T09:00>10:00`,
        // After midnight on W+1: W's visual day at startHour 5, W+1's at 0.
        `- [ ] qs-w-03 #${TAG} @${w(1)}T03:00`,
        // A point right at W's start at startHour 5.
        `- [ ] qs-w-point #${TAG} @${w(0)}T05:00>05:00`,
        `- [ ] qs-w2 #${TAG} #${WORK} @${w(1)}`,
        `- [ ] qs-d #${TAG} @${D}`,
        `- [ ] qs-d-work #${TAG} #${WORK} @${D}`,
        `- [ ] qs-undated #${TAG}`,
        '',
    ].join('\n');
}

const FIELDS = { 'output-fields': 'id,content,file', limit: 'all' };

/** The names of the rows of the note among `tasks` (by their content's first word). */
function names(tasks: Record<string, unknown>[]): string[] {
    return tasks
        .filter(t => t.file === FILE)
        .map(t => String(t.content).split(' ')[0])
        .sort();
}

function errorOf(result: unknown): string {
    return String((result as { error?: string }).error);
}

function idOf(name: string): string {
    const r = cliList({ file: FILE, 'output-fields': 'id,content', limit: 'all' });
    const t = r.tasks.find(t => String(t.content).startsWith(name + ' '));
    if (!t) throw new Error('no row ' + name);
    return t.id as string;
}

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    const { startHour, weekStartDay } = readSettings(['startHour', 'weekStartDay']) as { startHour: number; weekStartDay: number };
    D = visualDay(startHour);
    W = weekStart(addDays(D, 21), weekStartDay);
    expect(await writeIndexedTestFile(FILE, note())).toBe(true);
});

afterAll(async () => {
    await closeViews();
    deleteTestFile(FILE);
    deleteTestFile(FILTER_FILE);
    await waitForFileDeindexed(FILE);
});

describe('one window for list, the range commands and Timeline', () => {
    it('list from/to, tasks-for-date-range and the days of categorized-tasks-for-date-range give the rows Timeline draws', () => {
        const listed = names(cliList({ ...FIELDS, file: FILE, from: w(0), to: w(2) }).tasks);
        const ranged = names(cliTasksForDateRange({ ...FIELDS, file: FILE, from: w(0), to: w(2) }).tasks);
        const days = cliCategorizedTasksForDateRange(w(0), w(2), { file: FILE });
        expect(Object.keys(days)).toEqual([w(0), w(1), w(2)]);
        const categorized = [...new Set(Object.values(days).flatMap(d => names([...d.allDay, ...d.timed])))].sort();

        const past = readSettings(['pastDaysToShow']).pastDaysToShow as number;
        const r = openView('qs-tl', 'timeline-view', {
            date: addDays(w(0), past),
            daysToShow: 3,
            showSidebar: false,
            filterState: { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: [TAG] }] },
        });
        expect(r.dates).toEqual([w(0), w(1), w(2)]);
        const drawn = ev<string[]>(`(async () => {
            ${PRELUDE}
            const el = V('qs-tl').contentEl;
            const name = c => ((c.querySelector('.task-card__content')?.textContent ?? c.textContent).match(/qs-[a-z0-9-]+/) ?? ['?'])[0];
            return JSON.stringify([...new Set([...el.querySelectorAll('.task-card')].map(name))].sort());
        })()`);

        expect(listed).toEqual(['qs-w', 'qs-w-03', 'qs-w-10', 'qs-w-9', 'qs-w-point', 'qs-w2']);
        expect(ranged).toEqual(listed);
        expect(categorized).toEqual(listed);
        expect(drawn).toEqual(listed);
    });
});

describe('today is list date=today', () => {
    it('takes the flags of list: file, and a tag beside it', () => {
        expect(names(cliToday({ ...FIELDS, file: FILE }).tasks)).toEqual(['qs-d', 'qs-d-work']);
        expect(names(cliToday({ ...FIELDS, file: FILE, tag: WORK }).tasks)).toEqual(['qs-d-work']);
    });

    it('refuses a window of its own beside today, saying why', () => {
        expect(errorOf(cliToday({ date: w(0) }))).toBe(`Cannot use 'date' with today, which is date=today; use list date=${w(0)}`);
    });
});

describe('a filter and the shorthand are taken together', () => {
    it('filter-file with date, and the API\'s filter with date, keep the rows that pass both', () => {
        const filter = { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: [WORK] }] };
        writeTestFile(FILTER_FILE, JSON.stringify(filter));
        expect(names(cliList({ ...FIELDS, 'filter-file': FILTER_FILE }).tasks)).toEqual(['qs-d-work', 'qs-w2']);
        expect(names(cliList({ ...FIELDS, 'filter-file': FILTER_FILE, date: w(1) }).tasks)).toEqual(['qs-w2']);

        const viaApi = obsidianEval(`(async () => {
            const api = app.plugins.plugins['obsidian-task-viewer'].api;
            const r = await api.list({ filter: ${JSON.stringify(filter)}, date: ${JSON.stringify(w(1))}, limit: Infinity });
            return JSON.stringify(r.tasks);
        })()`) as Record<string, unknown>[];
        expect(names(viaApi)).toEqual(['qs-w2']);
    });
});

describe('the window is period overlaps', () => {
    it('a date and a time is the moment: a task ending at it is not in it', () => {
        const got = names(cliList({ ...FIELDS, file: FILE, date: `${w(0)} 10:00` }).tasks);
        expect(got).toContain('qs-w-10');
        expect(got).toContain('qs-w');
        expect(got).not.toContain('qs-w-9');
    });

    it('a from after its to is refused', () => {
        expect(errorOf(cliList({ from: w(2), to: w(0) }))).toBe(`from ${w(2)} is after to ${w(0)}`);
    });
});

describe('start-hour moves the visual day of one query', () => {
    it('at 5 W holds the point at its start and the night after it; at 0 the night is W+1\'s', () => {
        const at5 = names(cliList({ ...FIELDS, file: FILE, date: w(0), 'start-hour': '5' }).tasks);
        expect(at5).toContain('qs-w-point');
        expect(at5).toContain('qs-w-03');
        const at0 = names(cliList({ ...FIELDS, file: FILE, date: w(0), 'start-hour': '0' }).tasks);
        expect(at0).not.toContain('qs-w-03');
        expect(names(cliList({ ...FIELDS, file: FILE, date: w(1), 'start-hour': '0' }).tasks)).toContain('qs-w-03');
    });

    it('get gives the effective times of that start hour', () => {
        const t = cliGet(idOf('qs-w'), { 'start-hour': '0', 'output-fields': 'effectiveStartTime,effectiveEndDate,effectiveEndTime' });
        expect(t).toMatchObject({ effectiveStartTime: '00:00', effectiveEndDate: w(1), effectiveEndTime: '00:00' });
    });

    it.each([
        ['24', 'start-hour must be from 0 to 23, got: "24"'],
        ['abc', 'start-hour must be a whole number, got: "abc"'],
    ])('start-hour=%s is refused alike by list, today and get', (value, message) => {
        expect(errorOf(cliList({ 'start-hour': value }))).toBe(message);
        expect(errorOf(cliToday({ 'start-hour': value }))).toBe(message);
        expect(errorOf(cliGet(idOf('qs-w'), { 'start-hour': value }))).toBe(message);
    });
});
