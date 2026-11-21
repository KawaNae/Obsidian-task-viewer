/**
 * The name in a timer's header (`TimerTitle`), in the running E2E vault: the
 * name of the line the timer runs on, a button that opens that line's hub
 * with the focus on its name field. A child count-up opens the hub of the
 * child line it writes, not of the task it times; a daily note's line, with
 * no name yet, shows the date faint and is named in the hub, the name coming
 * back to the widget through the index; a link in the name is drawn and not
 * followed, the press opening the hub; a line deleted from the note leaves
 * the name plain text that opens nothing; and a press that moves drags the
 * widget instead.
 *
 * The presses on the name are real input, through Electron, but for Enter,
 * which is dispatched on the focused name. The note's bytes are read back
 * from the disk.
 *
 * What the tests look at does not hang on the clock: the running line is
 * written with a start and no end, and the timer writes an end on it only
 * once the end it is drawn with has passed, which is not within a test. The
 * daily note is of a day far off (2031-01), the timer being given that day.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     its daily notes at the vault's root as YYYY-MM-DD, with no template,
 *     with a build whose timer's name opens the hub
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/timer/name-hub.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile, writeTestFile } from '../helpers/test-file-manager';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';

const FILE = 'test-int-timer-name.md';
/** The note a name links to. */
const TARGET = 'test-int-timer-name-target.md';
const DAY = '2031-01-21';
const DAILY = `${DAY}.md`;

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const widget = plugin.getTimerWidget();
const FILE = ${JSON.stringify(FILE)};
${UNTIL}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const nameInput = () => hub()?.querySelector('.tv-form__name-section input');
const item = id => document.querySelector('[data-timer-id="' + id + '"]');
const nameEl = id => item(id)?.querySelector('.timer-widget__title-name--row');
/** How the name of the timer \`id\` is drawn. */
const looks = id => {
    const el = nameEl(id);
    if (!el) return null;
    return {
        text: el.textContent,
        role: el.getAttribute('role'),
        tabindex: el.getAttribute('tabindex'),
        openable: el.classList.contains('timer-widget__title-name--openable'),
        placeholder: el.classList.contains('timer-widget__title-name--placeholder'),
        links: [...el.querySelectorAll('a.internal-link')].map(a => a.getAttribute('data-href')),
    };
};
/** Count the hubs asked for from outside the views while \`body\` runs, and their options. */
const counting = async (body) => {
    const asked = [];
    const real = plugin.openTaskHub;
    plugin.openTaskHub = function (taskId, options) { asked.push({ taskId, options: options ?? null }); return real.call(this, taskId, options); };
    try { await body(); } finally { plugin.openTaskHub = real; }
    return asked;
};
/**
 * Press the mouse, real input, at \`at\` (a point of the page), move it along
 * \`path\` (offsets from \`at\`; the first is where it goes down, the last
 * where it goes up), and let it go.
 */
const mouse = async (at, path) => {
    const contents = require('electron').remote.getCurrentWebContents();
    const points = path.map(([dx, dy]) => ({ x: Math.round(at.x + dx), y: Math.round(at.y + dy) }));
    contents.sendInputEvent({ type: 'mouseMove', ...points[0] });
    contents.sendInputEvent({ type: 'mouseDown', ...points[0], button: 'left', clickCount: 1 });
    for (const p of points.slice(1)) {
        await sleep(30);
        contents.sendInputEvent({ type: 'mouseMove', ...p, button: 'left', modifiers: ['leftButtonDown'] });
    }
    await sleep(80);
    contents.sendInputEvent({ type: 'mouseUp', ...points[points.length - 1], button: 'left', clickCount: 1 });
    await sleep(400);
};
const middle = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const type = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
const key = (el, name, code) => el.dispatchEvent(new KeyboardEvent('keydown', { key: name, keyCode: code, bubbles: true, cancelable: true }));
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/**
 * Start a count-up, as a child of the row of `FILE` named `name` or on the
 * daily note of `daily`, and answer the timer's id once its first line is
 * written and its name is a button.
 */
function startTimer(subject: { name: string } | { daily: string }): string {
    return run<string>(`
        const subject = ${JSON.stringify(subject)};
        let input;
        if ('daily' in subject) {
            input = { daily: subject.daily };
        } else {
            input = plugin.getIndex().getTasks().find(t => t.file === FILE && t.content === subject.name);
            if (!input) throw new Error('no row ' + subject.name);
        }
        const before = new Set(widget.board.values().map(t => t.id));
        widget.startTimer(input, 'child', { kind: 'countup' });
        const timer = widget.board.values().find(t => !before.has(t.id));
        if (!timer) throw new Error('no timer started');
        await until(() => timer.tail && !timer.opening, 5000);
        await until(() => looks(timer.id)?.openable, 3000, () => JSON.stringify(looks(timer.id)));
        return JSON.stringify(timer.id);
    `);
}

/** The running line of the timer `id`, as the index has it: its id, name and file. */
function runningLine(id: string): { id: string; content: string; file: string } {
    return run(`
        const timer = widget.board.get(${JSON.stringify(id)});
        const row = plugin.getIndex().getTaskByAnchor(timer.file, timer.tail);
        if (!row) throw new Error('no running line');
        return JSON.stringify({ id: row.id, content: row.content, file: row.file });
    `);
}

/** Close whatever hub is open, throwing away what it asks about. */
function closeHub(): void {
    run(`
        if (!hub()) return 'ok';
        hub().closest('.tv-overlay__panel').querySelector('.tv-overlay__close').click();
        await sleep(100);
        hub()?.querySelector('.tv-form__discard')?.click();
        await until(() => !hub(), 1000);
        return 'ok';
    `);
}

/** Close the timer `id` without recording, if it is open. */
function closeTimer(id: string): void {
    obsidianEval(`(async () => {
        const widget = app.plugins.plugins['obsidian-task-viewer'].getTimerWidget();
        const timer = widget.board.get(${JSON.stringify(id)});
        if (timer) widget.lifecycle.close(timer, true);
        await new Promise(r => setTimeout(r, 500));
        return JSON.stringify(true);
    })()`);
}

beforeAll(() => {
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
});

afterAll(async () => {
    for (const file of [FILE, TARGET, DAILY]) {
        deleteTestFile(file);
        await waitForFileDeindexed(file);
    }
});

describe('the name in a timer\'s header', () => {
    let open: string | null = null;
    afterEach(() => {
        closeHub();
        if (open) closeTimer(open);
        open = null;
    });

    it('of a child count-up opens the hub of the running child line, the focus on its name', async () => {
        await writeIndexedTestFile(FILE, ['- [ ] 親', ''].join('\n'));
        open = startTimer({ name: '親' });
        const line = runningLine(open);

        const seen = run<Record<string, unknown>>(`
            const id = ${JSON.stringify(open)};
            const asked = await counting(() => mouse(middle(nameEl(id)), [[0, 0]]));
            await until(() => hub() && nameInput());
            // The first focus comes to the field once the hub's open animation has ended.
            await until(() => document.activeElement === nameInput());
            const parent =plugin.getIndex().getTasks().find(t => t.file === FILE && t.content === '親' && !t.parentId);
            return JSON.stringify({
                looks: looks(id),
                asked,
                parent: parent?.id ?? null,
                name: nameInput().value,
                focused: document.activeElement === nameInput(),
            });
        `);
        expect(seen.looks).toMatchObject({ text: '親', role: 'button', tabindex: '0', openable: true, placeholder: false });
        expect(seen.asked).toEqual([{ taskId: line.id, options: { focusField: 'name' } }]);
        // The child line the timer writes, which takes the task's name, and not the task.
        expect(line.id).not.toBe(seen.parent);
        expect(readTestFile(FILE).split('\n')[1]).toMatch(/^\s+- \[ \] 親 @\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
        expect(seen.name).toBe('親');
        expect(seen.focused).toBe(true);
    });

    it('of a daily note\'s line with no name shows the date faint; Enter opens its hub, and the name given there is the note\'s and the widget\'s', async () => {
        open = startTimer({ daily: DAY });
        const line = runningLine(open);
        expect(line.file).toBe(DAILY);
        expect(line.content).toBe('');

        const seen = run<Record<string, unknown>>(`
            const id = ${JSON.stringify(open)};
            const out = { before: looks(id) };
            const asked = await counting(async () => {
                nameEl(id).focus();
                key(nameEl(id), 'Enter', 13);
                await until(() => hub() && nameInput());
                // The first focus comes to the field once the hub's open animation has ended.
                await until(() => document.activeElement === nameInput());
            });
            out.asked = asked;
            out.hub = { name: nameInput().value, focused: document.activeElement === nameInput() };
            type(nameInput(), '朝会');
            key(document.activeElement, 'Escape', 27);
            await until(() => !hub());
            await until(() => looks(id)?.text === '朝会', 3000, () => JSON.stringify(looks(id)));
            out.after = looks(id);
            return JSON.stringify(out);
        `);
        expect(seen.before).toMatchObject({ text: DAY, role: 'button', tabindex: '0', openable: true, placeholder: true });
        expect(seen.asked).toEqual([{ taskId: line.id, options: { focusField: 'name' } }]);
        expect(seen.hub).toEqual({ name: '', focused: true });
        expect(seen.after).toMatchObject({ text: '朝会', role: 'button', openable: true, placeholder: false });
        expect(readTestFile(DAILY)).toMatch(/^- \[ \] 朝会 @\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/m);
    });

    it('draws a link in the line\'s name, and a press on the link opens the hub, not the note', async () => {
        writeTestFile(TARGET, 'target\n');
        await writeIndexedTestFile(FILE, ['- [ ] 読む', ''].join('\n'));
        open = startTimer({ name: '読む' });
        const line = runningLine(open);
        const target = TARGET.replace(/\.md$/, '');

        const seen = run<Record<string, unknown>>(`
            const id = ${JSON.stringify(open)};
            await plugin.getOperations().updateTask(${JSON.stringify(line.id)}, { content: ${JSON.stringify(`読む [[${target}]]`)} });
            await until(() => looks(id)?.links.length === 1, 3000, () => JSON.stringify(looks(id)));
            const out = { looks: looks(id) };
            const link = nameEl(id).querySelector('a.internal-link');
            out.linkTabindex = link.getAttribute('tabindex');
            // The row is read again after the write, under a new id.
            const timer = widget.board.get(id);
            out.lineId = plugin.getIndex().getTaskByAnchor(timer.file, timer.tail)?.id ?? null;
            const files = () => app.workspace.getLeavesOfType('markdown').map(l => l.view.file?.path ?? null).sort();
            const filesBefore = files();
            const openLinkText = app.workspace.openLinkText;
            let followed = 0;
            app.workspace.openLinkText = function (...args) { followed++; return openLinkText.apply(this, args); };
            try {
                out.asked = await counting(() => mouse(middle(link), [[0, 0]]));
                await until(() => hub() && nameInput());
                await sleep(150);
            } finally {
                app.workspace.openLinkText = openLinkText;
            }
            out.followed = followed;
            out.sameFiles = JSON.stringify(files()) === JSON.stringify(filesBefore);
            out.targetShown = files().includes(${JSON.stringify(TARGET)});
            out.hubName = nameInput().value;
            return JSON.stringify(out);
        `);
        expect(seen.looks).toMatchObject({ role: 'button', openable: true, links: [target] });
        expect(seen.linkTabindex).toBe('-1');
        expect(seen.lineId).not.toBeNull();
        expect(seen.asked).toEqual([{ taskId: seen.lineId, options: { focusField: 'name' } }]);
        expect(seen).toMatchObject({ followed: 0, sameFiles: true, targetShown: false });
        expect(seen.hubName).toBe(`読む [[${target}]]`);
    });

    it('turns plain text when the running line is deleted from the note, and a press opens nothing', async () => {
        await writeIndexedTestFile(FILE, ['- [ ] 消す', ''].join('\n'));
        open = startTimer({ name: '消す' });

        const seen = run<Record<string, unknown>>(`
            const id = ${JSON.stringify(open)};
            const file = app.vault.getAbstractFileByPath(FILE);
            await app.vault.process(file, text => text.split('\\n').filter((l, i) => i !== 1).join('\\n'));
            await until(() => looks(id) && !looks(id).openable, 3000, () => JSON.stringify(looks(id)));
            const out = { looks: looks(id), disk: await app.vault.adapter.read(FILE) };
            out.asked = await counting(async () => {
                await mouse(middle(nameEl(id)), [[0, 0]]);
                nameEl(id).click();
                key(nameEl(id), 'Enter', 13);
                await sleep(300);
            });
            out.hub = !!hub();
            return JSON.stringify(out);
        `);
        // The task keeps the anchor the start put on it; the running line is gone.
        expect(seen.disk).toMatch(/^- \[ \] 消す \^[\w-]+\n$/);
        expect(seen.looks).toEqual({ text: '消す', role: null, tabindex: null, openable: false, placeholder: true, links: [] });
        // The press reaches the name and finds no line to open.
        expect(seen.asked).toEqual([]);
        expect(seen.hub).toBe(false);
    });

    it('drags the widget on a press that moves, and opens no hub', async () => {
        await writeIndexedTestFile(FILE, ['- [ ] 動かす', ''].join('\n'));
        open = startTimer({ name: '動かす' });

        const seen = run<Record<string, unknown>>(`
            const id = ${JSON.stringify(open)};
            const box = nameEl(id).closest('.timer-widget');
            let captured = false;
            const onCapture = () => { captured = true; };
            box.addEventListener('gotpointercapture', onCapture);
            const before = box.getBoundingClientRect();
            const at = middle(nameEl(id));
            let asked;
            try {
                asked = await counting(() => mouse(at, [[0, 0], [3, 0], [-20, -10], [-40, -30]]));
            } finally {
                box.removeEventListener('gotpointercapture', onCapture);
            }
            const after = box.getBoundingClientRect();
            const out = { asked, captured, hub: !!hub(), moved: [Math.round(after.left - before.left), Math.round(after.top - before.top)] };
            // Dragged back, to leave the widget where it was.
            await mouse({ x: at.x - 40, y: at.y - 30 }, [[0, 0], [20, 20], [40, 30]]);
            return JSON.stringify(out);
        `);
        expect(seen).toEqual({ asked: [], captured: true, hub: false, moved: [-40, -30] });
    });
});
