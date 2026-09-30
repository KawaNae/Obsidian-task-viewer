/**
 * Shifting the start of a running count-up (`TimerLifecycle.offsetStart`),
 * in the running Dev vault, through the widget: the elapsed time pressed,
 * an item of the menu it opens chosen. A self start shifted back to the
 * start it overwrote records from that start; a child's running line has
 * its start rewritten when the shift is chosen; after ⏸ and ▶ the menu no
 * longer offers the remembered start. The note's bytes are read back from
 * the disk.
 *
 * The menu is asked to draw itself in the page rather than as the OS's
 * native menu, whose items a test cannot reach.
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
    afterEach(() => {
        if (open) closeTimer(open);
        open = null;
    });

    it('self, shifted to the start it overwrote: offered in the menu, and ■ records from that start', async () => {
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

    // Known bug: a press of the mouse on the elapsed time starts the widget's
    // drag (FloatingOverlayHost's pointerdown captures the pointer on the
    // widget, the elapsed time not being among the non-draggable selectors),
    // and the click then goes to the widget, not the elapsed time: the menu
    // does not open. Drop `.fails` once that is fixed.
    it.fails('a real press of the mouse on the elapsed time opens the menu, not a drag', async () => {
        await writeIndexedTestFile(FILE, ['- [ ] 押す', ''].join('\n'));
        open = startTimer('押す', 'child');
        const seen = evalOrThrow<{ presented: number; captured: boolean }>(`(async () => {
            const plugin = app.plugins.plugins['obsidian-task-viewer'];
            const presenter = plugin.menuPresenter;
            const present = presenter.present;
            let presented = 0;
            presenter.present = (build, anchor) => { presented++; return present.call(presenter, (menu) => { menu.setUseNativeMenu(false); build(menu); }, anchor); };
            const display = document.querySelector('[data-timer-id="${open}"] .timer-widget__time-display');
            let captured = false;
            const widget = display.closest('.timer-widget');
            const onCapture = () => { captured = true; };
            widget.addEventListener('gotpointercapture', onCapture);
            try {
                const r = display.getBoundingClientRect();
                const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
                const contents = require('electron').remote.getCurrentWebContents();
                contents.sendInputEvent({ type: 'mouseMove', x, y });
                contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
                await new Promise(r => setTimeout(r, 80));
                contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
                await new Promise(r => setTimeout(r, 300));
            } finally {
                presenter.present = present;
                widget.removeEventListener('gotpointercapture', onCapture);
                presenter.dismiss();
            }
            return JSON.stringify({ presented, captured });
        })()`);
        expect(seen).toEqual({ presented: 1, captured: false });
    });
});
