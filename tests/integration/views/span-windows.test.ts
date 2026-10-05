/**
 * A task's span and the visual days that answer for it (段11b), in the
 * running Dev vault: a task holds its time as moments `[start, end)`, `@D`
 * being `[D startHour, D+1 startHour)`, and the CLI's windows, a pinned
 * list's date filter and sort, Timeline's overdue mark in its heading and
 * the hub's faint values all read that span. A task with only a due is
 * read as `@>due` (段11c): the views, the CLI and the hub draw it on the
 * due's day, the timed one the hour before its due.
 *
 * The days are counted from today's visual day (a day starts at the vault's
 * startHour), so what is asserted does not move with the hour the suite is
 * run at. The tasks are in a note of the test's own, removed at the end.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/span-windows.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    cliCategorizedTasksForDateRange, cliGet, cliList, cliTasksForDateRange, cliToday, isObsidianRunning, obsidianEval,
} from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import {
    PRELUDE, addDays, closeViews, ev, openView, readSettings, tr, visualDay,
} from '../helpers/view-helper';

const FILE = 'test-int-span-windows.md';

let startHour: number;
let D: string;
const day = (n: number) => addDays(D, n);
const at = (n: number, h: number) => `${day(n)}T${String(h).padStart(2, '0')}:00`;

/** The rows, by a name each starts with. Written once today's visual day is known. */
function note(): string {
    return [
        `- [ ] sw-yesterday @${day(-1)}`,
        `- [ ] sw-today #tvswpl @${day(0)}`,
        `- [ ] sw-today-10 #tvswpl @${at(0, 10)}`,
        // Before startHour on today's date: yesterday's visual day.
        `- [ ] sw-early #tvswpl @${at(0, startHour - 1)}`,
        // After midnight, before startHour, on tomorrow's date: today's visual day.
        `- [ ] sw-tomorrow-02 #tvswpl @${day(1)}T02:00`,
        `- [ ] sw-late-night @${at(0, 22)}>${at(1, startHour)}`,
        `- [ ] sw-next #tvswpl @${day(1)}`,
        `- [ ] sw-overdue #tvswtl @${day(-2)}`,
        // Only a due: drawn as @>due, on the due's day, the timed one the hour before it.
        `- [ ] sw-due #tvswdue @>>${day(2)}`,
        `- [ ] sw-due-17 #tvswdue @>>${day(2)}T17:00`,
        // Rule 4: an end time with no start time. Far from today, out of the windows above.
        `- [ ] sw-rule4 @${day(10)}>${day(10)}T02:00`,
        '',
    ].join('\n');
}

/** The names of the rows of the note among `tasks` (by their content). */
function names(tasks: Record<string, unknown>[]): string[] {
    return tasks
        .filter(t => t.file === FILE)
        .map(t => String(t.content).split(' ')[0])
        .sort();
}

function idOf(name: string): string {
    const r = cliList({ file: FILE, 'output-fields': 'id,content', limit: 'all' });
    const t = r.tasks.find(t => String(t.content).startsWith(name + ' ') || t.content === name);
    if (!t) throw new Error('no row ' + name);
    return t.id as string;
}

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    startHour = readSettings(['startHour']).startHour as number;
    D = visualDay(startHour);
    expect(await writeIndexedTestFile(FILE, note())).toBe(true);
});

afterAll(async () => {
    obsidianEval(`(async () => {
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        return JSON.stringify(true);
    })()`);
    await closeViews();
    deleteTestFile(FILE);
    await waitForFileDeindexed(FILE);
});

describe('the CLI answers by visual days', () => {
    const FIELDS = { 'output-fields': 'id,content,file', limit: 'all' };

    it("today: the tasks in today's window, not yesterday's @D nor a start before startHour today", () => {
        const got = names(cliToday(FIELDS).tasks);
        expect(got).toContain('sw-today');
        expect(got).toContain('sw-tomorrow-02');
        expect(got).toContain('sw-late-night');
        expect(got).not.toContain('sw-yesterday');
        expect(got).not.toContain('sw-early');
        expect(got).not.toContain('sw-next');
    });

    it("list date=tomorrow leaves out today's @D, which ends at tomorrow's startHour", () => {
        const got = names(cliList({ ...FIELDS, file: FILE, date: day(1) }).tasks);
        expect(got).toEqual(['sw-next']);
        const today = names(cliList({ ...FIELDS, file: FILE, date: day(0) }).tasks);
        expect(today).toEqual(['sw-late-night', 'sw-today', 'sw-today-10', 'sw-tomorrow-02']);
    });

    it("tasks-for-date-range from=to=tomorrow leaves out a task that ends at tomorrow's startHour", () => {
        const got = names(cliTasksForDateRange({ ...FIELDS, file: FILE, from: day(1), to: day(1) }).tasks);
        expect(got).not.toContain('sw-late-night');
        expect(got).not.toContain('sw-today');
        expect(got).toContain('sw-next');
    });

    it("get: @today ends at tomorrow's startHour and lasts 1440 minutes", () => {
        const t = cliGet(idOf('sw-today'), { 'output-fields': 'effectiveStartDate,effectiveStartTime,effectiveEndDate,effectiveEndTime,durationMinutes' });
        const hh = `${String(startHour).padStart(2, '0')}:00`;
        expect(t).toMatchObject({
            effectiveStartDate: day(0),
            effectiveStartTime: hh,
            effectiveEndDate: day(1),
            effectiveEndTime: hh,
            durationMinutes: 1440,
        });
    });
});

describe('a task with only a due is drawn with the span read from its due', () => {
    const FIELDS = { 'output-fields': 'id,content,file', limit: 'all' };
    const DUE = () => day(2);

    it('list date=<due> and tasks-for-date-range take @>>due', () => {
        const listed = names(cliList({ ...FIELDS, file: FILE, date: DUE() }).tasks);
        expect(listed).toEqual(['sw-due', 'sw-due-17']);
        const ranged = names(cliTasksForDateRange({ ...FIELDS, file: FILE, from: DUE(), to: DUE() }).tasks);
        expect(ranged).toEqual(['sw-due', 'sw-due-17']);
    });

    it('categorized-tasks-for-date-range puts @>>due in allDay and @>>dueT17:00 in timed, with no due-only bucket', () => {
        const r = cliCategorizedTasksForDateRange(DUE(), DUE());
        const d = r[DUE()];
        expect(Object.keys(d).sort()).toEqual(['allDay', 'timed']);
        expect(names(d.allDay)).toContain('sw-due');
        expect(names(d.timed)).toContain('sw-due-17');
        expect(names(d.allDay)).not.toContain('sw-due-17');
    });

    it("Timeline draws @>>due in the all-day row on its day and @>>dueT17:00 from 16:00 to 17:00", () => {
        // The window's first column is the day before the due.
        const past = readSettings(['pastDaysToShow']).pastDaysToShow as number;
        const r = openView('sw-due-tl', 'timeline-view', {
            date: addDays(day(1), past),
            daysToShow: 3,
            showSidebar: false,
            filterState: { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: ['tvswdue'] }] },
        });
        expect(r.dates).toEqual([day(1), DUE(), day(3)]);
        const drawn = ev<{ allDay: { col: number; span: number }[]; timed: { date: string | null; start: number; duration: number }[] }>(`(async () => {
            ${PRELUDE}
            const el = V('sw-due-tl').contentEl;
            const named = (c, n) => ((c.querySelector('.task-card__content')?.textContent ?? c.textContent).match(/sw-[a-z0-9-]+/) ?? [])[0] === n;
            return JSON.stringify({
                allDay: [...el.querySelectorAll('.allday-section .task-card')].filter(c => named(c, 'sw-due'))
                    .map(c => ({ col: Number(c.dataset.colStart), span: Number(c.dataset.span) })),
                timed: [...el.querySelectorAll('.timeline-scroll-area__day-column .task-card')].filter(c => named(c, 'sw-due-17'))
                    .map(c => ({
                        date: c.closest('.timeline-scroll-area__day-column')?.dataset.date ?? null,
                        start: Number(c.style.getPropertyValue('--start-minutes')),
                        duration: Number(c.style.getPropertyValue('--duration-minutes')),
                    })),
            });
        })()`);
        expect(drawn.allDay).toEqual([{ col: 2, span: 1 }]);
        expect(drawn.timed).toEqual([{ date: DUE(), start: (16 - startHour) * 60, duration: 60 }]);
    });

    it('Schedule draws them in its all-day row and its grid, with no section of dues', () => {
        openView('sw-due-sc', 'schedule-view', {
            date: DUE(),
            filterState: { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: ['tvswdue'] }] },
        });
        const drawn = ev<{ allDay: string[]; grid: string[]; sections: number }>(`(async () => {
            ${PRELUDE}
            const el = V('sw-due-sc').contentEl;
            const name = c => ((c.querySelector('.task-card__content')?.textContent ?? c.textContent).match(/sw-[a-z0-9-]+/) ?? ['?'])[0];
            return JSON.stringify({
                allDay: [...el.querySelectorAll('.allday-section .task-card')].map(name),
                grid: [...el.querySelectorAll('.schedule-tasks .task-card')].map(name),
                sections: el.querySelectorAll('.schedule-section, .schedule-section__header').length,
            });
        })()`);
        expect(drawn.allDay).toEqual(['sw-due']);
        expect(drawn.grid).toEqual(['sw-due-17']);
        expect(drawn.sections).toBe(0);
    });
});

describe("a pinned list's date filter and sort", () => {
    it("startDate equals today takes a start after midnight on tomorrow's date, and an end sort puts @today after @todayT10:00", () => {
        const list = {
            id: 'sw-list',
            name: 'SW',
            filterState: {
                logic: 'and',
                filters: [
                    { property: 'tag', operator: 'includes', value: ['tvswpl'] },
                    { property: 'startDate', operator: 'equals', value: { preset: 'today' } },
                ],
            },
            sortState: { rules: [{ property: 'endDate', direction: 'asc' }] },
            applyViewFilter: false,
        };
        openView('sw-pl', 'timeline-view', { showSidebar: true, pinnedLists: [list] });
        const shown = ev<string[]>(`(async () => {
            ${PRELUDE}
            await wait(300);
            const sec = V('sw-pl').contentEl.querySelector('.pinned-list');
            if (!sec) throw new Error('no pinned list');
            return JSON.stringify([...sec.querySelectorAll('.pinned-list__body > .task-card')]
                .map(c => ((c.querySelector('.task-card__content')?.textContent ?? c.textContent).match(/sw-[a-z0-9-]+/) ?? ['?'])[0]));
        })()`);
        expect([...shown].sort()).toEqual(['sw-today', 'sw-today-10', 'sw-tomorrow-02']);
        expect(shown.indexOf('sw-today')).toBeGreaterThan(shown.indexOf('sw-today-10'));
        // The ends as moments: today 11:00, tomorrow 03:00, tomorrow startHour.
        expect(shown).toEqual(['sw-today-10', 'sw-tomorrow-02', 'sw-today']);
    });
});

describe("Timeline's heading", () => {
    it('marks an undone @D overdue on its own day, not on the day after it', () => {
        // Viewed from yesterday, the window starts pastDaysToShow days before it.
        const past = readSettings(['pastDaysToShow']).pastDaysToShow as number;
        const viewed = addDays(day(-2), past);
        openView('sw-tl', 'timeline-view', {
            date: viewed,
            filterState: { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: ['tvswtl'] }] },
        });
        const heads = ev<{ dates: string[]; overdue: string[] }>(`(async () => {
            ${PRELUDE}
            const cells = [...V('sw-tl').contentEl.querySelectorAll('.date-header .date-header__cell')].filter(c => c.dataset.date);
            return JSON.stringify({
                dates: cells.map(c => c.dataset.date),
                overdue: cells.filter(c => c.classList.contains('has-overdue')).map(c => c.dataset.date),
            });
        })()`);
        expect(heads.dates).toContain(day(-2));
        expect(heads.dates).toContain(day(-1));
        expect(heads.overdue).toEqual([day(-2)]);
    });
});

describe("the hub's faint values", () => {
    /** The placeholders of the `label` row's date and time fields in the hub opened on `name`. */
    function placeholders(name: string, label = 'modal.end'): { date: string; time: string } {
        const r = obsidianEval(`(async () => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const plugin = app.plugins.plugins['obsidian-task-viewer'];
            const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
            const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
            const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(FILE)} && t.content.startsWith(${JSON.stringify(name + ' ')}));
            if (!task) throw new Error('no row ' + ${JSON.stringify(name)});
            plugin.openTaskHub(task.id);
            await until(() => hub() && hub().querySelector('.tv-form__row'));
            await sleep(200);
            const row = [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === ${JSON.stringify(tr(label))});
            const input = which => row.querySelector('.tv-form__field--' + which + ' input.tv-ctrl__text-input');
            const out = { date: input('date').placeholder, time: input('time').placeholder };
            document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
            await until(() => !hub());
            return JSON.stringify(out);
        })()`);
        if (r && typeof r === 'object' && 'error' in (r as object)) throw new Error(String((r as { error: string }).error));
        return r as { date: string; time: string };
    }

    it("@today's end: no faint time, and today's date for the date", () => {
        expect(placeholders('sw-today')).toEqual({ date: day(0), time: 'HH:mm' });
    });

    it("@todayT10:00's end: 11:00 for the time", () => {
        expect(placeholders('sw-today-10').time).toBe('11:00');
    });

    it("@>>due's start and end: the due's date, faint, and no faint time", () => {
        expect(placeholders('sw-due', 'modal.start')).toEqual({ date: day(2), time: 'HH:mm' });
        expect(placeholders('sw-due', 'modal.end')).toEqual({ date: day(2), time: 'HH:mm' });
    });

    it("@D>DT02:00's end says rule 4's reason and how to write the line with a start time as the hub opens", () => {
        // Nothing is typed: the row's issue is said from the start, the end's time marked.
        const said = obsidianEval(`(async () => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const plugin = app.plugins.plugins['obsidian-task-viewer'];
            const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
            const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
            const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(FILE)} && t.content.startsWith('sw-rule4'));
            if (!task) throw new Error('no row sw-rule4');
            plugin.openTaskHub(task.id);
            await until(() => hub() && hub().querySelector('.tv-form__row'));
            const row = [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === ${JSON.stringify(tr('modal.end'))});
            const input = row.querySelector('.tv-form__field--time input.tv-ctrl__text-input');
            const out = { says: [...row.nextElementSibling.children].map(c => c.textContent), invalid: input.getAttribute('aria-invalid'), value: input.value };
            document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
            await until(() => !hub());
            out.closed = !hub();
            return JSON.stringify(out);
        })()`) as { says: string[]; invalid: string | null; value: string; closed: boolean };
        const D10 = day(10);
        expect(said.value).toBe('02:00');
        expect(said.invalid).toBe('true');
        // Nothing typed, a close asks nothing.
        expect(said.closed).toBe(true);
        expect(said.says).toEqual([
            tr('validation.endTimeWithoutStart') + '\n' + tr('validationHint.endTimeWithoutStartExample', {
                time: '02:00',
                endDate: day(11),
                sameDay: `@${D10}T01:00>02:00`,
                otherDay: `@${D10}T09:00>${day(11)}T02:00`,
            }),
        ]);
    });
});
