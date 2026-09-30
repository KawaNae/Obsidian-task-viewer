/**
 * Shifting the start of a running count-up (`TimerLifecycle.offsetStart`),
 * in the running Dev vault, through the widget: the elapsed time pressed,
 * an item of the menu it opens chosen. A self start shifted back to the
 * start it overwrote records from that start; a child's running line has
 * its start rewritten when the shift is chosen; after ⏸ and ▶ the menu no
 * longer offers the remembered start, nor one outside today. "Set the
 * shift..." opens a dialog that warns of what it cannot read under the field
 * and foresees where the start goes. And a real press of the mouse on the
 * elapsed time: without moving it opens the menu, moving it drags the
 * widget. The note's bytes are read back from the disk.
 *
 * The menu is asked to draw itself in the page rather than as the OS's
 * native menu, whose items a test cannot reach.
 *
 * What the tests look at does not hang on the hour they run at: the remembered
 * start is offered only within today, so `startHour` is set, for the test and
 * in memory only, half a day away from now; the time field is read against a
 * now the dialog is given, at noon.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with a build that shifts the start of a running timer
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/timer/offset.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';

const FILE = 'test-int-timer-offset.md';

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

function dateOf(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeOf(ms: number): string {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Whole minutes: the `HH:MM` a line carries. */
function minuteFloor(ms: number): number {
    return Math.floor(ms / 60_000) * 60_000;
}

function evalOrThrow<T>(code: string): T {
    const result = obsidianEval(code);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/**
 * Set `startHour`, in memory only, half a day away from now, so that now and
 * the 20 minutes before it fall in the same day whenever the test runs. Answer
 * the hour it had, for {@link restoreStartHour}.
 */
function startHourAwayFromNow(): number {
    const away = (new Date().getHours() + 12) % 24;
    return evalOrThrow<number>(`(() => {
        const settings = app.plugins.plugins['obsidian-task-viewer'].settings;
        const had = settings.startHour;
        settings.startHour = ${away};
        return JSON.stringify(had);
    })()`);
}

function restoreStartHour(hour: number): void {
    obsidianEval(`(() => {
        app.plugins.plugins['obsidian-task-viewer'].settings.startHour = ${hour};
        return JSON.stringify(true);
    })()`);
}

/** Today at `hours`:`minutes`, local. */
function todayAt(hours: number, minutes: number): number {
    const at = new Date();
    at.setHours(hours, minutes, 0, 0);
    return at.getTime();
}

/** The calendar day before the day of `ms`, by the date (not 24 hours back). */
function dayBefore(ms: number): string {
    const at = new Date(ms);
    at.setDate(at.getDate() - 1);
    return dateOf(at.getTime());
}

/**
 * Start a count-up on the row of `FILE` whose text is `name`, in `mode`, and
 * answer the timer's id once its first line is written.
 */
function startTimer(name: string, mode: 'self' | 'child'): string {
    return evalOrThrow<string>(`(async () => {
        const plugin = app.plugins.plugins['obsidian-task-viewer'];
        const widget = plugin.getTimerWidget();
        const task = plugin.getTaskIndex().getTasks().find(t => t.file === ${JSON.stringify(FILE)} && t.content === ${JSON.stringify(name)});
        if (!task) throw new Error('no row ' + ${JSON.stringify(name)});
        const before = new Set(widget.timers.keys());
        widget.startTimer({ taskId: task.id, taskName: task.content, taskFile: task.file, taskOriginalText: task.originalText,
            timerTargetId: task.anchor, timerType: 'countup', recordMode: ${JSON.stringify(mode)}, autoStart: true });
        const timer = [...widget.timers.values()].find(t => t.timerType === 'countup' && !before.has(t.id));
        const end = Date.now() + 5000;
        while (Date.now() < end && !(timer.tailRecordBlockId && !timer.opening)) await new Promise(r => setTimeout(r, 50));
        await new Promise(r => setTimeout(r, 300));
        return JSON.stringify(timer.id);
    })()`);
}

/**
 * Press the elapsed time of the timer `id` and answer the titles of the menu
 * it opens, drawn in the page. With `choose`, the item whose title includes
 * it is then clicked, and the shift waited for.
 */
function pressElapsed(id: string, choose?: string): string[] {
    return evalOrThrow<string[]>(`(async () => {
        const plugin = app.plugins.plugins['obsidian-task-viewer'];
        const presenter = plugin.menuPresenter;
        const present = presenter.present;
        presenter.present = (build, anchor) => present.call(presenter, (menu) => { menu.setUseNativeMenu(false); build(menu); }, anchor);
        try {
            const display = document.querySelector('[data-timer-id="${id}"] .timer-widget__time-display');
            if (!display) throw new Error('no elapsed time shown');
            display.click();
        } finally {
            presenter.present = present;
        }
        await new Promise(r => setTimeout(r, 100));
        const items = [...document.querySelectorAll('.menu .menu-item')];
        const titles = items.map(el => el.querySelector('.menu-item-title')?.textContent ?? '');
        const choose = ${JSON.stringify(choose ?? null)};
        if (choose === null) {
            presenter.dismiss();
        } else {
            const item = items[titles.findIndex(title => title.includes(choose))];
            if (!item) throw new Error('no item ' + choose + ' in ' + JSON.stringify(titles));
            item.click();
            await new Promise(r => setTimeout(r, 800));
        }
        return JSON.stringify(titles);
    })()`);
}

/** Press ⏸ (record and suspend), ▶ (a new session) or ■ (record and close) on the timer `id`, and wait for it. */
function press(id: string, how: 'suspendTimer' | 'resumeSession' | 'finishTimer'): void {
    evalOrThrow(`(async () => {
        const widget = app.plugins.plugins['obsidian-task-viewer'].getTimerWidget();
        const timer = widget.timers.get(${JSON.stringify(id)});
        if (timer) await widget.lifecycle.${how}(timer);
        await new Promise(r => setTimeout(r, 800));
        return JSON.stringify(true);
    })()`);
}

/** Close the timer `id` without recording, if it is open. */
function closeTimer(id: string): void {
    obsidianEval(`(async () => {
        const widget = app.plugins.plugins['obsidian-task-viewer'].getTimerWidget();
        if (widget.timers.has(${JSON.stringify(id)})) widget.lifecycle.closeTimer(${JSON.stringify(id)});
        await new Promise(r => setTimeout(r, 500));
        return JSON.stringify(true);
    })()`);
}

function line(name: string): string {
    const found = readTestFile(FILE).split('\n').find(l => l.includes(name));
    if (!found) throw new Error(`no line ${name} in ${FILE}`);
    return found;
}

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
});

afterAll(async () => {
    deleteTestFile(FILE);
    await waitForFileDeindexed(FILE);
});

describe('shifting the start of a running count-up', () => {
    let open: string | null = null;
    let startHour: number | null = null;
    afterEach(() => {
        if (open) closeTimer(open);
        open = null;
        if (startHour !== null) restoreStartHour(startHour);
        startHour = null;
    });

    it('self, shifted to the start it overwrote: offered in the menu, and ■ records from that start', async () => {
        startHour = startHourAwayFromNow();
        const prior = minuteFloor(Date.now() - 20 * 60_000);
        await writeIndexedTestFile(FILE, [`- [ ] 自分 @${dateOf(prior)}T${timeOf(prior)}`, ''].join('\n'));
        open = startTimer('自分', 'self');
        // The self start overwrote the line's start with now.
        expect(line('自分')).not.toContain(`T${timeOf(prior)}`);

        const titles = pressElapsed(open, timeOf(prior));

        expect(titles.filter(title => title.includes(timeOf(prior)))).toHaveLength(1);
        expect(line('自分')).toMatch(new RegExp(`@${dateOf(prior)}T${timeOf(prior)}(\\s|$)`));

        const before = Date.now();
        press(open, 'finishTimer');
        const after = Date.now();
        open = null;
        const record = line('自分');
        const m = /@(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})>(?:\d{4}-\d{2}-\d{2}T)?(\d{2}:\d{2})/.exec(record);
        expect(m, record).not.toBeNull();
        expect(`${m![1]}T${m![2]}`).toBe(`${dateOf(prior)}T${timeOf(prior)}`);
        expect([timeOf(before), timeOf(after)]).toContain(m![3]);
    });

    it('child, shifted 30 minutes back: the running line\'s start rewritten at once, and ⏸ records from it', async () => {
        await writeIndexedTestFile(FILE, ['- [ ] 親', ''].join('\n'));
        open = startTimer('親', 'child');
        const running = readTestFile(FILE).split('\n')[1];
        expect(running).toMatch(/^\s+- \[ \] .*@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

        const before = Date.now();
        const titles = pressElapsed(open, '30');
        const after = Date.now();

        // A child's running line has no start of its own to remember.
        expect(titles.filter(title => /\d{2}:\d{2}/.test(title))).toEqual([]);
        const shifted = readTestFile(FILE).split('\n')[1];
        const expected = [before, after].map(ms => `@${dateOf(ms - 30 * 60_000)}T${timeOf(ms - 30 * 60_000)}`);
        expect(expected.some(start => shifted.includes(start)), shifted).toBe(true);

        press(open, 'suspendTimer');
        const record = readTestFile(FILE).split('\n')[1];
        const m = /@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})>(?:\d{4}-\d{2}-\d{2}T)?\d{2}:\d{2}/.exec(record);
        expect(m, record).not.toBeNull();
        expect(expected).toContain(`@${m![1]}`);
    });

    it('self, after ⏸ and ▶: the remembered start is no longer offered, the minutes back still are', async () => {
        startHour = startHourAwayFromNow();
        const prior = minuteFloor(Date.now() - 20 * 60_000);
        await writeIndexedTestFile(FILE, [`- [ ] 続ける @${dateOf(prior)}T${timeOf(prior)}`, ''].join('\n'));
        open = startTimer('続ける', 'self');
        expect(pressElapsed(open).some(title => title.includes(timeOf(prior)))).toBe(true);

        press(open, 'suspendTimer');
        press(open, 'resumeSession');

        const titles = pressElapsed(open);
        expect(titles.some(title => title.includes(timeOf(prior)))).toBe(false);
        expect(titles.filter(title => /\b(5|10|15|30)\b/.test(title))).toHaveLength(4);
    });

    it('self, on a line planned months before: the start it overwrote is not offered, not being within today', async () => {
        const prior = minuteFloor(Date.now() - 90 * 24 * 60 * 60_000);
        await writeIndexedTestFile(FILE, [`- [ ] 昔の予定 @${dateOf(prior)}T${timeOf(prior)}`, ''].join('\n'));
        open = startTimer('昔の予定', 'self');

        const titles = pressElapsed(open);
        expect(titles.filter(title => /\d{2}:\d{2}/.test(title))).toEqual([]);
        expect(titles.filter(title => /\b(5|10|15|30)\b/.test(title))).toHaveLength(4);
    });

    it('"Set the shift...": an amount unreadable is warned under the field and not taken; a readable one is foreseen and shifts', async () => {
        await writeIndexedTestFile(FILE, ['- [ ] 量で', ''].join('\n'));
        open = startTimer('量で', 'child');
        pressElapsed(open, '...');
        // Opened from the widget, the dialog comes over it, not under it.
        expect(surfaceOverWidget(open)).toContain('tv-overlay');

        const unreadable = offsetDialog({ type: '1.5' });
        expect(unreadable).toMatchObject({ kind: 'minutes', says: 'warning', invalid: true, applicable: false });

        const before = Date.now();
        const readable = offsetDialog({ type: '25' });
        const expected = [before, Date.now()].map(ms => timeOf(ms - 25 * 60_000));
        expect(readable).toMatchObject({ kind: 'minutes', says: 'info', invalid: false, applicable: true });
        expect(expected.some(time => readable.text.includes(time)), readable.text).toBe(true);

        offsetDialog({ apply: true });
        const shifted = readTestFile(FILE).split('\n')[1];
        expect(expected.some(time => shifted.includes(`T${time}`)), shifted).toBe(true);
    });

    it('"Set the shift...": a time later than now is foreseen as the day before, and shifts to it', async () => {
        await writeIndexedTestFile(FILE, ['- [ ] 時刻で', ''].join('\n'));
        open = startTimer('時刻で', 'child');
        pressElapsed(open, '...');

        // The dialog reads the field against noon; 13:00 is later than that.
        const noon = todayAt(12, 0);
        const seen = offsetDialog({ kind: 'time', type: '13:00', now: noon });
        expect(seen).toMatchObject({ kind: 'time', says: 'info', applicable: true });
        expect(seen.text).toMatch(/前日 13:00|yesterday 13:00/);

        offsetDialog({ apply: true, now: noon });
        expect(readTestFile(FILE).split('\n')[1]).toContain(`@${dayBefore(noon)}T13:00`);
    });

    it('a real press of the mouse on the elapsed time opens the menu, and does not move the widget', async () => {
        await writeIndexedTestFile(FILE, ['- [ ] 押す', ''].join('\n'));
        open = startTimer('押す', 'child');

        expect(mouse(open, [[0, 0]])).toEqual({ presented: 1, captured: false, moved: [0, 0] });
    });

    it('a real press of the mouse that moves drags the widget, and opens no menu', async () => {
        await writeIndexedTestFile(FILE, ['- [ ] 動かす', ''].join('\n'));
        open = startTimer('動かす', 'child');

        const seen = mouse(open, [[0, 0], [3, 0], [-20, -10], [-40, -30]]);
        // Dragged back, to leave the widget where it was.
        mouse(open, [[-40, -30], [-20, -10], [0, 0]], [-40, -30]);

        expect(seen).toEqual({ presented: 0, captured: true, moved: [-40, -30] });
    });
});

/**
 * Press the mouse — real input, through Electron — on the elapsed time of the
 * timer `id` (plus `from`), move it along `path` (offsets from the elapsed
 * time's middle; the first is where it goes down, the last where it goes
 * up), and answer whether the start-offset menu was asked for, whether the
 * widget captured the pointer (a drag), and how far the widget moved.
 */
function mouse(id: string, path: [number, number][], from: [number, number] = [0, 0]): { presented: number; captured: boolean; moved: [number, number] } {
    return evalOrThrow(`(async () => {
        const plugin = app.plugins.plugins['obsidian-task-viewer'];
        const presenter = plugin.menuPresenter;
        const present = presenter.present;
        let presented = 0;
        presenter.present = (build, anchor) => { presented++; return present.call(presenter, (menu) => { menu.setUseNativeMenu(false); build(menu); }, anchor); };
        const display = document.querySelector('[data-timer-id="${id}"] .timer-widget__time-display');
        if (!display) throw new Error('no elapsed time shown');
        const widget = display.closest('.timer-widget');
        let captured = false;
        const onCapture = () => { captured = true; };
        widget.addEventListener('gotpointercapture', onCapture);
        const before = widget.getBoundingClientRect();
        try {
            const r = display.getBoundingClientRect();
            const x0 = Math.round(r.left + r.width / 2) + ${from[0]}, y0 = Math.round(r.top + r.height / 2) + ${from[1]};
            const path = ${JSON.stringify(path)}.map(([dx, dy]) => ({ x: x0 + dx, y: y0 + dy }));
            const contents = require('electron').remote.getCurrentWebContents();
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            contents.sendInputEvent({ type: 'mouseMove', ...path[0] });
            contents.sendInputEvent({ type: 'mouseDown', ...path[0], button: 'left', clickCount: 1 });
            for (const at of path.slice(1)) {
                await wait(30);
                contents.sendInputEvent({ type: 'mouseMove', ...at, button: 'left', modifiers: ['leftButtonDown'] });
            }
            await wait(80);
            contents.sendInputEvent({ type: 'mouseUp', ...path[path.length - 1], button: 'left', clickCount: 1 });
            await wait(300);
        } finally {
            presenter.present = present;
            widget.removeEventListener('gotpointercapture', onCapture);
            presenter.dismiss();
        }
        const after = widget.getBoundingClientRect();
        return JSON.stringify({ presented, captured, moved: [Math.round(after.left - before.left), Math.round(after.top - before.top)] });
    })()`);
}

/**
 * The classes of the surface (the element the body holds) drawn on top at the
 * middle of the widget that shows the timer `id`.
 */
function surfaceOverWidget(id: string): string {
    return evalOrThrow(`(() => {
        const item = document.querySelector('[data-timer-id="${id}"]');
        if (!item) throw new Error('no timer shown');
        const r = item.closest('.timer-widget').getBoundingClientRect();
        let at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        while (at && at.parentElement !== document.body) at = at.parentElement;
        return JSON.stringify(at ? at.className : '');
    })()`);
}

/**
 * Act on the open "Set the shift..." dialog (`TimerStartOffsetModal`): choose
 * the amount or the time with the switch, type into the field shown, or
 * press the button that shifts. Answer what the dialog shows then: the kind
 * chosen, the line under the field and its tone, whether the field is marked
 * invalid, and whether the button can be pressed.
 *
 * With `now`, the dialog is given that as the time it reads the field against
 * and foresees from: `Date.now` answers it while the dialog is acted on, which
 * it reads without waiting. The shift itself is then written at the real now.
 */
function offsetDialog(act: { kind?: 'minutes' | 'time'; type?: string; apply?: boolean; now?: number }): {
    kind: string; text: string; says: 'info' | 'warning' | null; invalid: boolean; applicable: boolean;
} {
    return evalOrThrow(`(async () => {
        const dialog = document.querySelector('.tv-timer-offset');
        if (!dialog) throw new Error('no start-offset dialog open');
        const act = ${JSON.stringify(act)};
        const look = () => {
            const [minutesBtn, timeBtn] = dialog.querySelectorAll('.tv-ctrl__segments > button');
            if (act.kind) (act.kind === 'minutes' ? minutesBtn : timeBtn).click();
            const kind = timeBtn.classList.contains('is-active') ? 'time' : 'minutes';
            const rows = dialog.querySelectorAll('.tv-form__row');
            const input = rows[kind === 'minutes' ? 0 : 1].querySelector('input[type="text"]');
            if (act.type !== undefined) {
                input.value = act.type;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const says = dialog.querySelector('.tv-timer-offset__says');
            const apply = dialog.querySelector('.tv-form__buttons .mod-cta');
            const seen = {
                kind,
                text: says.textContent,
                says: says.style.display === 'none' ? null : says.classList.contains('tv-form__warning') ? 'warning' : says.classList.contains('tv-form__info') ? 'info' : null,
                invalid: input.classList.contains('tv-ctrl__text-input--invalid'),
                applicable: !apply.disabled,
            };
            if (act.apply) apply.click();
            return seen;
        };
        const realNow = Date.now;
        if (act.now !== undefined) Date.now = () => act.now;
        let seen;
        try {
            seen = look();
        } finally {
            Date.now = realNow;
        }
        if (act.apply) await new Promise(r => setTimeout(r, 800));
        return JSON.stringify(seen);
    })()`);
}
