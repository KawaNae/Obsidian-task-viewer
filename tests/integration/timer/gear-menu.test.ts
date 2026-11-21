/**
 * The gear at the end of a started timer's header (`TimerWidgetMenu`), in the
 * running E2E vault: the header holds fold and the gear, and no ✕; the gear's
 * menu is the shift section, a separator and the close item while a count-up
 * runs, the close item alone while it waits to record or is suspended, and
 * the Pomodoro section, a separator and the close item for a Pomodoro. The
 * close item throws the running line away while the timer holds one, and
 * leaves the record of a suspended one; a shift chosen from the gear rewrites
 * the running line's start, a folded widget too; and the next-task
 * suggestion's item, which comes once no timer runs, keeps its ✕ and has no
 * gear. The note's bytes are read back from the disk.
 *
 * The gear is pressed with `click()`, and the menu read from the Menu the
 * plugin has open (`MenuPresenter.currentMenu`): on macOS it is the OS's
 * native menu, outside the DOM, so an item is chosen by running its callback
 * as a click on it would.
 *
 * What the tests look at does not hang on the clock: a child's running line
 * has no end until the end it is drawn with has passed, which is not within
 * a test; and a shift by minutes back reads the clock when it is chosen, so
 * the item is chosen while `Date.now` answers a now on the minute, and the
 * start it lands on is known exactly. A wait wanted to record is made by the
 * disk refusing the record (`app.vault.process`), as a failed write leaves it.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     with a build whose started timer's header ends in a gear
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/timer/gear-menu.test.ts
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { obsidianEval, sleep } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';

const FILE = 'test-int-timer-gear.md';
const NOTE = ['- [ ] 親', ''].join('\n');

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const widget = plugin.getTimerWidget();
const FILE = ${JSON.stringify(FILE)};
${UNTIL}
const item = id => document.querySelector('[data-timer-id="' + id + '"]');
const menuItems = () => plugin.menuPresenter.currentMenu?.items ?? [];
/** An item of the open menu as the test reads it: a separator has no title. */
const read = i => i.titleEl
    ? {
        title: i.titleEl.textContent,
        disabled: i.disabled === true || !!i.dom?.classList.contains('is-disabled'),
        warning: !!i.dom?.classList.contains('is-warning'),
    }
    : 'separator';
/** Press the gear of the timer \`id\` and answer the items of the menu it opens. */
const openGear = async id => {
    const gear = item(id)?.querySelector('.timer-widget__header > .timer-widget__settings-btn');
    if (!gear) throw new Error('no gear on the timer ' + id);
    const was = plugin.menuPresenter.currentMenu;
    gear.click();
    await until(() => plugin.menuPresenter.currentMenu && plugin.menuPresenter.currentMenu !== was, 2000);
    return menuItems().map(read);
};
/**
 * Choose the item titled \`title\` of the open menu, as a click on it would,
 * while \`Date.now\` answers \`now\` (if given), and wait for what it writes.
 */
const choose = async (title, now) => {
    const items = menuItems();
    const found = items.find(i => i.titleEl?.textContent === title);
    if (!found) throw new Error('no item ' + title + ' among ' + items.map(i => i.titleEl?.textContent ?? '---').join('|'));
    plugin.menuPresenter.dismiss();
    const realNow = Date.now;
    if (now !== undefined && now !== null) Date.now = () => now;
    try {
        found.callback(new MouseEvent('click'));
    } finally {
        Date.now = realNow;
    }
    await sleep(800);
};
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

type Item = { title: string; disabled: boolean; warning: boolean } | 'separator';

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

/** The `@YYYY-MM-DDTHH:MM` a line starting at `ms` carries. */
function startOf(ms: number): string {
    const d = new Date(ms);
    return `@${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Whole minutes: the `HH:MM` a line carries. */
function minuteFloor(ms: number): number {
    return Math.floor(ms / 60_000) * 60_000;
}

/**
 * Start a timer of `kind` as a child of the row `親` of `FILE`, and answer its
 * id once its running line is written.
 */
function startTimer(kind: 'countup' | 'pomodoro'): string {
    return run<string>(`
        const task = plugin.getIndex().getTasks().find(t => t.file === FILE && t.content === '親');
        if (!task) throw new Error('no row 親');
        const before = new Set(widget.board.values().map(t => t.id));
        widget.startTimer(task, 'child', { kind: ${JSON.stringify(kind)} });
        const timer = widget.board.values().find(t => !before.has(t.id));
        if (!timer) throw new Error('no timer started');
        await until(() => timer.tail && !timer.opening, 5000);
        await until(() => item(timer.id), 2000);
        await sleep(300);
        return JSON.stringify(timer.id);
    `);
}

/** Press the gear of the timer `id` and answer the items of its menu, closing the menu again. */
function gearMenu(id: string): Item[] {
    return run<Item[]>(`
        const items = await openGear(${JSON.stringify(id)});
        plugin.menuPresenter.dismiss();
        return JSON.stringify(items);
    `);
}

/** Press the gear of the timer `id` and choose the item titled `title`, while `Date.now` answers `now` if given. */
function chooseFromGear(id: string, title: string, now?: number): void {
    run(`
        await openGear(${JSON.stringify(id)});
        await choose(${JSON.stringify(title)}, ${JSON.stringify(now ?? null)});
        return JSON.stringify(true);
    `);
}

/** Press ⏸ on the timer `id` and wait for the record. With `refused`, the disk refuses every write meanwhile. */
function suspend(id: string, refused = false): string {
    return run<string>(`
        const timer = widget.board.get(${JSON.stringify(id)});
        if (!timer) throw new Error('no timer ' + ${JSON.stringify(id)});
        const real = app.vault.process;
        if (${refused}) app.vault.process = async function () { throw new Error('e2e: the disk refused'); };
        try {
            await widget.lifecycle.stop(timer, 'suspend');
        } finally {
            app.vault.process = real;
        }
        await sleep(500);
        return JSON.stringify(timer.session.kind);
    `);
}

/** Whether the board still holds the timer `id`, and whether the widget still shows it. */
function shown(id: string): { onBoard: boolean; inWidget: boolean } {
    return run(`
        return JSON.stringify({ onBoard: !!widget.board.get(${JSON.stringify(id)}), inWidget: !!item(${JSON.stringify(id)}) });
    `);
}

/** Close the timer `id` without recording, if it is open. */
function closeTimer(id: string): void {
    obsidianEval(`(async () => {
        const widget = app.plugins.plugins['obsidian-task-viewer'].getTimerWidget();
        const timer = widget.board.get(${JSON.stringify(id)});
        if (timer) await widget.lifecycle.close(timer);
        await new Promise(r => setTimeout(r, 500));
        return JSON.stringify(true);
    })()`);
}

/** The note's non-empty lines on the disk, once `test` holds of them (within `ms`). */
async function linesOnDisk(test: (lines: string[]) => boolean, what: string, ms = 3000): Promise<string[]> {
    const end = Date.now() + ms;
    let lines: string[] = [];
    for (;;) {
        lines = readTestFile(FILE).split('\n').filter(l => l.trim() !== '');
        if (test(lines)) return lines;
        if (Date.now() >= end) throw new Error(`timed out after ${ms} ms waiting for ${what}; the note was ${JSON.stringify(lines)}`);
        await sleep(100);
    }
}

function heading(title: string): Item {
    return { title, disabled: true, warning: false };
}

function choice(title: string, warning = false): Item {
    return { title, disabled: false, warning };
}

const RUNNING_LINE = /^\s+- \[ \] .*@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(\s|$)/;
const RECORD_LINE = /^\s+- \[.\] .*@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}>(\d{4}-\d{2}-\d{2}T)?\d{2}:\d{2}/;

afterAll(async () => {
    deleteTestFile(FILE);
    await waitForFileDeindexed(FILE);
});

describe('the gear of a started timer', () => {
    let open: string | null = null;
    afterEach(() => {
        if (open) closeTimer(open);
        open = null;
    });

    it('a running count-up: the header is fold and the gear with no ✕, and the menu is the shift section, a separator and Close without recording', async () => {
        await writeIndexedTestFile(FILE, NOTE);
        open = startTimer('countup');

        const header = run<{ buttons: string[]; close: boolean }>(`
            const header = item(${JSON.stringify(open)}).querySelector('.timer-widget__header');
            return JSON.stringify({
                buttons: [...header.querySelectorAll(':scope > button')].map(b =>
                    b.classList.contains('timer-widget__toggle-btn') ? 'fold'
                    : b.classList.contains('timer-widget__settings-btn') ? 'gear'
                    : b.className),
                close: !!item(${JSON.stringify(open)}).querySelector('.timer-widget__close-btn'),
            });
        `);
        expect(header).toEqual({ buttons: ['fold', 'gear'], close: false });

        expect(gearMenu(open)).toEqual([
            heading(tr('timer.offsetStart')),
            ...[5, 10, 15, 30].map(minutes => choice(`  ${tr('timer.offsetMinutesAgo', { minutes })}`)),
            choice(`  ${tr('timer.offsetCustom')}`),
            'separator',
            choice(tr('timer.discard'), true),
        ]);
    });

    it('Close without recording, while running: the timer is gone, and so is its running child line on the disk', async () => {
        await writeIndexedTestFile(FILE, NOTE);
        open = startTimer('countup');
        await linesOnDisk(lines => lines.length === 2 && RUNNING_LINE.test(lines[1]), 'the running child line');

        chooseFromGear(open, tr('timer.discard'));

        expect(shown(open)).toEqual({ onBoard: false, inWidget: false });
        const lines = await linesOnDisk(lines => lines.length === 1, 'the running line thrown away');
        expect(lines[0]).toMatch(/^- \[ \] 親/);
        open = null;
    });

    it('waiting to record, once the disk refused the record: the menu is Close without recording alone', async () => {
        await writeIndexedTestFile(FILE, NOTE);
        open = startTimer('countup');

        expect(suspend(open, true)).toBe('pending');

        expect(gearMenu(open)).toEqual([choice(tr('timer.discard'), true)]);
    });

    it('suspended: the menu is Close (recorded) alone, which closes the timer and leaves the record on the disk', async () => {
        await writeIndexedTestFile(FILE, NOTE);
        open = startTimer('countup');
        expect(suspend(open)).toBe('suspended');
        const recorded = await linesOnDisk(lines => lines.length === 2 && RECORD_LINE.test(lines[1]), 'the record');

        expect(gearMenu(open)).toEqual([choice(tr('timer.close'))]);

        chooseFromGear(open, tr('timer.close'));

        expect(shown(open)).toEqual({ onBoard: false, inWidget: false });
        // The record stays as written; only the anchor the timer put on it is taken off.
        const kept = recorded[1].replace(/ \^tv-t-\S+$/, '');
        await linesOnDisk(lines => lines.length === 2 && lines[1] === kept, 'the record kept, its anchor taken off');
        open = null;
    });

    it('a Pomodoro: the menu has the work and break lengths and auto repeat, no shift section, and ends in a separator and the close item', async () => {
        await writeIndexedTestFile(FILE, NOTE);
        open = startTimer('pomodoro');

        const items = gearMenu(open);
        const titles = items.map(i => i === 'separator' ? '---' : i.title);

        expect(titles).toContain(tr('timer.workDuration'));
        expect(titles).toContain(tr('timer.breakDuration'));
        expect(titles.some(title => title.startsWith(tr('timer.autoRepeat')))).toBe(true);
        expect(titles).not.toContain(tr('timer.offsetStart'));
        expect(titles.some(title => title.includes(tr('timer.offsetMinutesAgo', { minutes: 5 })))).toBe(false);
        expect(items.slice(-2)).toEqual(['separator', choice(tr('timer.discard'), true)]);
    });

    it('a shift chosen from the gear rewrites the running line\'s start, and so does one chosen from a folded widget', async () => {
        await writeIndexedTestFile(FILE, NOTE);
        open = startTimer('countup');

        const now = minuteFloor(Date.now());
        chooseFromGear(open, `  ${tr('timer.offsetMinutesAgo', { minutes: 5 })}`, now);
        let lines = await linesOnDisk(lines => lines.length === 2 && lines[1].includes(startOf(now - 5 * 60_000)), 'the start 5 minutes back');
        expect(lines[1]).toMatch(RUNNING_LINE);

        const folded = run<boolean>(`
            const id = ${JSON.stringify(open)};
            item(id).querySelector('.timer-widget__toggle-btn').click();
            await until(() => item(id) && !item(id).querySelector('.timer-widget__content'), 2000);
            return JSON.stringify(!item(id).querySelector('.timer-widget__time-display'));
        `);
        expect(folded).toBe(true);

        chooseFromGear(open, `  ${tr('timer.offsetMinutesAgo', { minutes: 10 })}`, now);
        lines = await linesOnDisk(lines => lines.length === 2 && lines[1].includes(startOf(now - 10 * 60_000)), 'the start 10 minutes back');
        expect(lines[1]).toMatch(RUNNING_LINE);
    });

    it('the next-task suggestion, once the last timer is closed, keeps its ✕ and has no gear', async () => {
        await writeIndexedTestFile(FILE, NOTE);
        open = startTimer('countup');
        const others = run<string[]>(`
            return JSON.stringify(widget.board.values().map(t => t.id).filter(id => id !== ${JSON.stringify(open)}));
        `);
        expect(others, 'no other timer is open, for the suggestion to come').toEqual([]);

        chooseFromGear(open, tr('timer.discard'));
        open = null;

        const idle = run<{ close: boolean; gear: boolean }>(`
            await until(() => document.querySelector('.timer-widget [data-idle="true"]'), 2000);
            const idle = document.querySelector('.timer-widget [data-idle="true"]');
            return JSON.stringify({
                close: !!idle.querySelector('.timer-widget__close-btn'),
                gear: !!idle.querySelector('.timer-widget__settings-btn'),
            });
        `);
        expect(idle).toEqual({ close: true, gear: false });
    });
});
