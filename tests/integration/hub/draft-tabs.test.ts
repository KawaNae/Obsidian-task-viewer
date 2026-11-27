/**
 * The tabs of the hub on a task not written yet, "General" and "Details",
 * under its card, in the running E2E vault. General holds the name, the
 * status, the dates and the place after them; Details the tags, the style,
 * the mask and the properties.
 *
 * - On a daily note (a Timeline's all-day empty space, Create task for
 *   daily note): it opens on General, the focus on the name, the place's
 *   fields there on the daily note's name and the settings' heading. The
 *   panel does not move nor change its size as the tab is changed.
 * - Its body, bounded by the window: General scrolls with the card and the
 *   tabs, the body's bottom padding after it at the scroll's end; on
 *   Details, lower, the body scrolls only as far as Details reaches.
 * - Details taller than General (the child of a row whose section gives
 *   many properties), in the desktop's box and on a phone's sheet: the panel
 *   keeps the size General gives it, and the body scrolls, the card and the
 *   tabs with it, until Details' last field stands the body's bottom
 *   padding above the body's bottom.
 * - Details' last field under a keyboard, in the desktop's box: the field
 *   rides 10px above the keyboard's top, and the padding written on the
 *   body is no more than the field needs to come there.
 * - The keys: the arrows go from tab to tab, round at the ends, and Tab
 *   goes from the tab chosen into its pane, never into the pane not chosen.
 * - Its place changed: to another note, to a note not there and back to
 *   the daily note, the line above the create saying each time where the
 *   task goes; the daily note not there is made of its day's template, as
 *   it is when the place is not changed.
 * - Closed: a place changed alone is asked about, a place changed back is
 *   not, nor is a hub given nothing.
 * - A create pressed on Details while a date does not read, or while a
 *   time with no date has lost the date the place gave it, writes nothing
 *   and goes to General, the focus on that field.
 * - An Escape while the note field's list is open closes the list alone;
 *   the next goes the way the hub closes.
 * - A create pressed while the note just typed is being read waits for it,
 *   and writes the name typed before the press in that note.
 * - Under a row (a card's menu, Add child task): the tabs are there, it
 *   opens on General, which shows under the dates the parent's note, the
 *   heading its row is under ("None" above the note's first heading) and
 *   the parent, with no field. The child goes first among the parent's
 *   children.
 *
 * Keys are sent as the keyboard sends them, through Electron, so the
 * browser's own Tab order and Obsidian's key scopes take them. A check that
 * something did not happen reads the state in the CLI call after the one
 * that pressed. The notes' bytes are read back from the disk. The daily
 * notes are of days far off (2031-02), made by the test or not at all, and
 * deleted after.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     its daily notes at the vault's root as YYYY-MM-DD, with no template,
 *     and new notes made at the vault's root
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/draft-tabs.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile, writeTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { MENUS } from '../helpers/menus';
import { KEYBOARD, resetKeyboard } from '../helpers/keyboard';
import { DIALOG_ROWS } from '../helpers/dialog-rows';
import { DRAFT_HUB } from '../helpers/draft-hub';
import { REAL_INPUT } from '../helpers/real-input';

/** Daily notes not there: each test that makes one makes it of a day of its own. */
const DAYS = ['2031-02-03', '2031-02-04', '2031-02-05', '2031-02-06', '2031-02-07', '2031-02-08', '2031-02-09', '2031-02-10'];
const [OPEN_DAY, TEMPLATE_DAY, CLOSE_DAY, DATE_DAY, ESCAPE_DAY, WAIT_DAY, KEYS_DAY, SCROLL_DAY] = DAYS;

/** The window's inner height that leaves the desktop's box and a phone's sheet less than their General tab (px). */
const LOW_WINDOW = 600;

/** The window's inner size and the keyboard's height that hide Details' last field in the desktop's box (px). */
const KEYBOARD_WINDOW = { width: 656, height: 1000 };
const KEYBOARD_HEIGHT = 600;

const OTHER_NAME = 'test-int-draft-tabs-other';
const OTHER_FILE = `${OTHER_NAME}.md`;
/** A note not there: named in the place tab, never made. */
const NEW_NAME = 'test-int-draft-tabs-new';
const INHERIT_NAME = 'test-int-draft-tabs-inherit';
const INHERIT_FILE = `${INHERIT_NAME}.md`;
const CHILD_FILE = 'test-int-draft-tabs-child.md';
const TEMPLATE_FILE = 'test-int-draft-tabs-template.md';
const TALL_FILE = 'test-int-draft-tabs-tall.md';

const OTHER_NOTE = [
    '# 別',
    '## Tasks',
    '- [ ] 既存',
    '',
].join('\n');

/** The section gives a start date, so a time alone is a start there. */
const INHERIT_NOTE = [
    '## Work',
    '- tv-start:: 2031-02-01',
    '- [ ] 既存',
    '',
].join('\n');

/** A parent above the note's first heading, and one under it with a child already. */
const CHILD_NOTE = [
    '- [ ] 上の親',
    '# 見出し',
    '- [ ] 親',
    '\t- [ ] 前からの子',
    '',
].join('\n');

/** A section giving many properties: the hub of a child under its row shows each in Details. */
const TALL_NOTE = [
    '## Work',
    ...Array.from({ length: 14 }, (_, i) => `- p${String(i).padStart(2, '0')}:: v${i}`),
    '- [ ] 高い親',
    '',
].join('\n');

const TEMPLATE = [
    '# テンプレート',
    '## Tasks',
    '',
].join('\n');

const INFO = 'tv-form__info';
const WARNING = 'tv-form__warning';
const ERROR = 'tv-form__error';

const PRELUDE = `
${UNTIL}
${DIALOG_ROWS}
${MENUS}
${KEYBOARD}
${DRAFT_HUB}
${REAL_INPUT}
const ask =() => { const el = formRow(draft())?.querySelector('.tv-form__ask'); return shown(el) ? el.textContent : null; };
const button = text => [...formRow(draft()).querySelectorAll('button')].filter(shown).find(b => b.textContent === text);
const closeHub = () => draft().closest('.tv-overlay').querySelector('.tv-overlay__close').click();
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
/** The hub on the daily note of \`day\`, as the views open it, the focus on its name and its place read. */
const openDaily = async day => {
    plugin.openDraftHub(plugin.getCreatePlaces().dailyNote(day), { startDate: day });
    await until(() => nameInput() && document.activeElement === nameInput() && lineSays().length > 0);
};
/** Choose the tab \`id\` by its button, and wait for it to be chosen. */
const choose = async id => {
    tab(id).click();
    await until(() => tabOn() === id);
};
const rect = el => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height }; };
/** Press \`name\` and wait for the focus to move from where it is. */
const moveBy = async name => {
    const from = document.activeElement;
    keys(name);
    await until(() => document.activeElement !== from, 2000, () => name + ' left the focus on ' + from?.outerHTML.slice(0, 80));
    return document.activeElement;
};
const rowTask = (file, name) => {
    const task = plugin.getIndex().getTasks().find(t => t.file === file && t.content === name);
    if (!task) throw new Error('no row ' + name);
    return task;
};
const exists = path => !!app.vault.getAbstractFileByPath(path);
/** The hub of a task not written yet under the row of \`file\` named so, the focus on its name and its place read. */
const openChild = async (file, name) => {
    plugin.openDraftHub({ kind: 'childOf', taskId: rowTask(file, name).id }, {});
    await until(() => nameInput() && document.activeElement === nameInput() && lineSays().length > 0);
};
/** The text fields a pane shows, top first. */
const fieldsOf = pane => [...pane.querySelectorAll('input, textarea')].filter(el => el.offsetParent !== null && !el.disabled && el.type !== 'checkbox');
/** The window's inner size set to \`width\` by \`height\`; answers what puts it back. */
const sizeWindow = async (width, height) => {
    const win = require('electron').remote.getCurrentWindow();
    const bounds = win.getBounds();
    const set = async (w, h) => {
        const b = win.getBounds();
        win.setBounds({ ...b, width: w + (b.width - innerWidth), height: h + (b.height - innerHeight) });
        await until(() => innerWidth === w && innerHeight === h, 3000, () => innerWidth + 'x' + innerHeight);
    };
    await set(width, height);
    return async () => {
        const w = innerWidth, h = innerHeight;
        win.setBounds(bounds);
        await until(() => innerWidth !== w || innerHeight !== h || (bounds.width === win.getBounds().width && bounds.height === win.getBounds().height));
    };
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

const dailyOf = (day: string) => `${day}.md`;

beforeAll(() => {
    // Focus moves and keys need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    const made = [...DAYS.map(dailyOf), `${NEW_NAME}.md`];
    const there = run<string[]>(`return JSON.stringify(${JSON.stringify(made)}.filter(exists));`);
    if (there.length > 0) throw new Error(`${there.join(', ')} in the E2E vault: the test makes and deletes them, so it does not run over one.`);
    const folder = run<string>(`return JSON.stringify(app.fileManager.getNewFileParent('').path);`);
    if (folder !== '/') throw new Error(`new notes are made in ${folder}: the test names a daily note at the root by its name alone.`);
});

afterEach(() => {
    resetKeyboard();
    run(`await cleanUpHubs(); return 'ok';`);
});

afterAll(async () => {
    for (const file of [...DAYS.map(dailyOf), `${NEW_NAME}.md`, OTHER_FILE, INHERIT_FILE, CHILD_FILE, TEMPLATE_FILE, TALL_FILE]) {
        deleteTestFile(file);
        await waitForFileDeindexed(file);
    }
});

describe('the tabs of the hub on a daily note', () => {
    it('opens on General, the focus on the name, the place\'s fields there on the daily note and the settings\' heading, the panel still as the tab changes', () => {
        const steps = run<Record<string, unknown>>(`
            await fromAllDay(${JSON.stringify(OPEN_DAY)}, ${JSON.stringify(tr('menu.createTaskForDailyNote'))});
            await until(() => nameInput() && document.activeElement === nameInput() && lineSays().length > 0);
            const panel = draft();
            const out = {
                opened: {
                    tabs: [...panel.querySelectorAll('button.tv-tabs__tab')].map(b => b.dataset.tab + ': ' + b.textContent),
                    tab: tabOn(),
                    onName: document.activeElement === nameInput(),
                    placeOnBasic: placeInputs().length === 2 && placeInputs().every(i => paneOf('basic').contains(i)),
                    note: noteInput().value,
                    heading: headingInput().value,
                    line: lineSays(),
                },
                rects: [rect(panel)],
            };
            out.offDetail = { inert: paneOf('detail').inert, display: getComputedStyle(paneOf('detail')).display };
            await choose('detail');
            await nextFrame();
            out.rects.push(rect(panel));
            out.offBasic = { inert: paneOf('basic').inert, visibility: getComputedStyle(paneOf('basic')).visibility };
            await choose('basic');
            await nextFrame();
            out.rects.push(rect(panel));
            return JSON.stringify(out);
        `);
        expect(steps.opened).toEqual({
            tabs: [`basic: ${tr('modal.hub.tabBasic')}`, `detail: ${tr('modal.hub.tabDetail')}`],
            tab: 'basic',
            onName: true,
            placeOnBasic: true,
            note: OPEN_DAY,
            heading: 'Tasks',
            line: [`${INFO}: ${tr('modal.newTask.toNew', { note: dailyOf(OPEN_DAY), heading: 'Tasks' })}`],
        });
        const [first, ...rest] = steps.rects as { top: number; left: number; width: number; height: number }[];
        for (const r of rest) {
            expect(r.top).toBeCloseTo(first.top, 1);
            expect(r.left).toBeCloseTo(first.left, 1);
            expect(r.width).toBeCloseTo(first.width, 1);
            expect(r.height).toBeCloseTo(first.height, 1);
        }
        // General off keeps its room, unseen; Details off takes none.
        expect(steps.offBasic).toEqual({ inert: true, visibility: 'hidden' });
        expect(steps.offDetail).toEqual({ inert: true, display: 'none' });
    });

    it('goes from tab to tab by the arrows, round at the ends, and by Tab into the pane chosen alone', () => {
        const steps = run<Record<string, unknown>>(`
            await openDaily(${JSON.stringify(KEYS_DAY)});
            const out = {};
            tab('basic').focus();
            await moveBy('Right');
            out.right = { tab: tabOn(), onTab: document.activeElement === tab('detail') };
            const into = await moveBy('Tab');
            out.tabIntoDetail = { inDetail: paneOf('detail').contains(into), first: into === fieldsOf(paneOf('detail'))[0] };
            tab('detail').focus();
            await moveBy('Right');
            out.round = { tab: tabOn(), onTab: document.activeElement === tab('basic') };
            await moveBy('Left');
            out.left = { tab: tabOn(), onTab: document.activeElement === tab('detail') };
            await moveBy('Left');
            // From General's tab, Tab after Tab until the focus leaves the hub.
            const visits = [];
            for (let i = 0; i < 60 && draft()?.contains(document.activeElement); i++) {
                const at = await moveBy('Tab');
                visits.push(paneOf('detail').contains(at) ? 'detail' : paneOf('basic').contains(at) ? 'basic' : 'other');
            }
            out.walk = { tab: tabOn(), first: visits[0], detail: visits.filter(v => v === 'detail').length, basic: visits.filter(v => v === 'basic').length, left: !draft()?.contains(document.activeElement) };
            return JSON.stringify(out);
        `);
        expect(steps.right).toEqual({ tab: 'detail', onTab: true });
        expect(steps.tabIntoDetail).toEqual({ inDetail: true, first: true });
        expect(steps.round).toEqual({ tab: 'basic', onTab: true });
        expect(steps.left).toEqual({ tab: 'detail', onTab: true });
        const walk = steps.walk as { tab: string; first: string; detail: number; basic: number; left: boolean };
        expect(walk).toMatchObject({ tab: 'basic', first: 'basic', detail: 0, left: true });
        // The name, the dates and the place's two fields at least.
        expect(walk.basic).toBeGreaterThan(4);
    });

    it.each([
        ['the desktop\'s box', false],
        ['a phone\'s sheet', true],
    ])('in %s, in a window too low for General, scrolls the body for the pane chosen alone, the card and the tabs with it, the body\'s bottom padding after the pane', (_, phone) => {
        const steps = run<Record<string, unknown>>(`
            const win = require('electron').remote.getCurrentWindow();
            const bounds = win.getBounds();
            try {
                if (${phone}) document.body.classList.add('is-phone');
                const height = innerHeight;
                win.setBounds({ ...bounds, height: bounds.height - (innerHeight - ${LOW_WINDOW}) });
                await until(() => innerHeight !== height);
                await openDaily(${JSON.stringify(SCROLL_DAY)});
                const b = draft().querySelector('.tv-overlay__body');
                const pad = parseFloat(getComputedStyle(b).paddingBottom);
                /** How the body stands: its scroll, and where the pane of the tab id and its last field end, from the body's bottom. */
                const seen = id => {
                    const pane = paneOf(id);
                    const field = [...pane.querySelectorAll('input, textarea')].filter(el => el.offsetParent !== null).at(-1);
                    const bottom = b.getBoundingClientRect().bottom;
                    return {
                        scrollHeight: b.scrollHeight,
                        clientHeight: b.clientHeight,
                        scrollTop: b.scrollTop,
                        paneToBottom: bottom - pane.getBoundingClientRect().bottom,
                        fieldToBottom: field ? bottom - field.getBoundingClientRect().bottom : null,
                        card: draft().querySelector('.task-hub__preview').getBoundingClientRect().top,
                        tabs: draft().querySelector('.tv-tabs').getBoundingClientRect().top,
                        panel: rect(draft()),
                    };
                };
                const out = { pad, top: seen('basic') };
                b.scrollTop = b.scrollHeight;
                await nextFrame();
                out.end = seen('basic');
                b.scrollTop = 0;
                await choose('detail');
                await nextFrame();
                out.detail = seen('detail');
                /** Where Details' last group ends in the body's scroll, the body's padding after it. */
                const last = [...paneOf('detail').children].filter(c => getComputedStyle(c).display !== 'none').at(-1);
                out.detailEnd = last.getBoundingClientRect().bottom - b.getBoundingClientRect().top + b.scrollTop + pad;
                out.basicHeight = paneOf('basic').scrollHeight;
                out.detailHeight = paneOf('detail').getBoundingClientRect().height;
                b.scrollTop = b.scrollHeight;
                await nextFrame();
                out.detailScrolled = b.scrollTop;
                return JSON.stringify(out);
            } finally {
                await cleanUpHubs();
                document.body.classList.remove('is-phone');
                const height = innerHeight;
                win.setBounds(bounds);
                await until(() => innerHeight !== height);
            }
        `);
        type Seen = { scrollHeight: number; clientHeight: number; scrollTop: number; paneToBottom: number; fieldToBottom: number | null; card: number; tabs: number; panel: { top: number; left: number; width: number; height: number } };
        const pad = steps.pad as number;
        const top = steps.top as Seen;
        const end = steps.end as Seen;
        const detail = steps.detail as Seen;
        // The window bounds the body: General is more than it shows, and Details is lower.
        expect(top.scrollHeight, 'the window is too tall for the body to scroll').toBeGreaterThan(top.clientHeight + 10);
        expect(pad).toBeGreaterThan(0);
        expect(steps.detailHeight as number).toBeLessThan(steps.basicHeight as number);

        // Scrolled to its end, the body shows its padding under General.
        // Within a pixel each: the scroll is whole pixels, the layout is not.
        expect(Math.abs(end.scrollTop - (end.scrollHeight - end.clientHeight))).toBeLessThanOrEqual(1);
        expect(Math.abs(end.paneToBottom - pad)).toBeLessThanOrEqual(1);
        expect(end.fieldToBottom!).toBeGreaterThanOrEqual(pad - 1);
        // The card and the tabs went up with the scroll.
        expect(Math.abs(top.card - end.card - end.scrollTop)).toBeLessThanOrEqual(1);
        expect(Math.abs(top.tabs - end.tabs - end.scrollTop)).toBeLessThanOrEqual(1);

        // On Details the panel and the body are as they were, and the body
        // scrolls only as far as Details and the padding after it reach: no
        // further for General's room, kept unseen.
        for (const side of ['top', 'left', 'width', 'height'] as const) expect(detail.panel[side]).toBeCloseTo(top.panel[side], 1);
        expect(detail.clientHeight).toBe(top.clientHeight);
        expect(Math.abs(detail.scrollHeight - Math.max(detail.clientHeight, steps.detailEnd as number))).toBeLessThanOrEqual(1);
        expect(Math.abs((steps.detailScrolled as number) - (detail.scrollHeight - detail.clientHeight))).toBeLessThanOrEqual(1);
        expect(detail.scrollHeight).toBeLessThan(top.scrollHeight);
    });
});

describe('Details taller than General (the child of a row whose section gives many properties)', () => {
    it.each([
        ['the desktop\'s box', false],
        ['a phone\'s sheet', true],
    ])('in %s, keeps the panel General sizes and scrolls the body, the card and the tabs with it, until Details\' last field stands the body\'s padding above its bottom', async (_, phone) => {
        await writeIndexedTestFile(TALL_FILE, TALL_NOTE);
        const steps = run<Record<string, unknown>>(`
            try {
                if (${phone}) document.body.classList.add('is-phone');
                await openChild(${JSON.stringify(TALL_FILE)}, '高い親');
                const panel = draft();
                const b = panel.querySelector('.tv-overlay__body');
                const pad = parseFloat(getComputedStyle(b).paddingBottom);
                const body = () => ({ scrollHeight: b.scrollHeight, clientHeight: b.clientHeight, scrollTop: b.scrollTop });
                const out = { pad, rects: [rect(panel)], basic: { ...body(), height: paneOf('basic').getBoundingClientRect().height } };
                await choose('detail');
                await nextFrame();
                out.rects.push(rect(panel));
                const field = fieldsOf(paneOf('detail')).at(-1);
                const last = [...paneOf('detail').children].filter(c => getComputedStyle(c).display !== 'none').at(-1);
                const tops = () => ({ card: panel.querySelector('.task-hub__preview').getBoundingClientRect().top, tabs: panel.querySelector('.tv-tabs').getBoundingClientRect().top });
                out.detail = { ...body(), height: paneOf('detail').getBoundingClientRect().height, properties: paneOf('detail').querySelectorAll('.task-hub__value-box.tv-form__control--inherited').length, ...tops() };
                b.scrollTop = b.scrollHeight;
                await nextFrame();
                const bottom = b.getBoundingClientRect().bottom;
                out.end = { ...body(), lastToBottom: bottom - last.getBoundingClientRect().bottom, fieldToBottom: bottom - field.getBoundingClientRect().bottom, inLast: last.contains(field), ...tops() };
                b.scrollTop = 0;
                await choose('basic');
                await nextFrame();
                out.rects.push(rect(panel));
                out.back = body();
                return JSON.stringify(out);
            } finally {
                await cleanUpHubs();
                document.body.classList.remove('is-phone');
            }
        `);
        type Body = { scrollHeight: number; clientHeight: number; scrollTop: number };
        const pad = steps.pad as number;
        const basic = steps.basic as Body & { height: number };
        const detail = steps.detail as Body & { height: number; properties: number; card: number; tabs: number };
        const end = steps.end as Body & { lastToBottom: number; fieldToBottom: number; inLast: boolean; card: number; tabs: number };
        // Each property the section gives is a row of Details, which is taller than General by far.
        expect(detail.properties).toBeGreaterThanOrEqual(14);
        expect(detail.height).toBeGreaterThan(basic.height + 100);
        expect(pad).toBeGreaterThan(0);

        // The panel stands as General sizes it whichever tab is chosen.
        const [first, ...rest] = steps.rects as { top: number; left: number; width: number; height: number }[];
        for (const r of rest) {
            for (const side of ['top', 'left', 'width', 'height'] as const) expect(r[side]).toBeCloseTo(first[side], 1);
        }
        expect(detail.clientHeight).toBe(basic.clientHeight);
        expect(steps.back).toEqual({ scrollHeight: basic.scrollHeight, clientHeight: basic.clientHeight, scrollTop: basic.scrollTop });

        // Details is more than the body shows: the body scrolls for it, to
        // its end, with the card and the tabs, Details' last field the body's
        // padding above the body's bottom. Within a pixel each: the scroll is
        // whole pixels, the layout is not.
        expect(detail.scrollHeight).toBeGreaterThan(detail.clientHeight + 100);
        expect(Math.abs(end.scrollTop - (end.scrollHeight - end.clientHeight))).toBeLessThanOrEqual(1);
        expect(end.inLast).toBe(true);
        expect(Math.abs(end.lastToBottom - pad)).toBeLessThanOrEqual(1);
        expect(end.fieldToBottom).toBeGreaterThanOrEqual(pad - 1);
        expect(Math.abs(detail.card - end.card - end.scrollTop)).toBeLessThanOrEqual(1);
        expect(Math.abs(detail.tabs - end.tabs - end.scrollTop)).toBeLessThanOrEqual(1);
    });
});

describe('Details\' last field under a keyboard, in the desktop\'s box', () => {
    it.each([
        ['Details lower than General (a row\'s child)', CHILD_FILE, '親'],
        ['Details taller than General (a child given many properties)', TALL_FILE, '高い親'],
    ])('%s: the field rides 10px above the keyboard\'s top, the body padded no more than the field needs', async (_, file, parent) => {
        await writeIndexedTestFile(CHILD_FILE, CHILD_NOTE);
        await writeIndexedTestFile(TALL_FILE, TALL_NOTE);
        const steps = run<Record<string, unknown>>(`
            const restore = await sizeWindow(${KEYBOARD_WINDOW.width}, ${KEYBOARD_WINDOW.height});
            try {
                await openChild(${JSON.stringify(file)}, ${JSON.stringify(parent)});
                const panel = draft();
                const root = panel.closest('.tv-overlay');
                const b = panel.querySelector('.tv-overlay__body');
                await choose('detail');
                await nextFrame();
                const out = {
                    heights: { basic: paneOf('basic').scrollHeight, detail: paneOf('detail').getBoundingClientRect().height },
                    stylePad: parseFloat(getComputedStyle(b).paddingBottom),
                };
                const field = fieldsOf(paneOf('detail')).at(-1);
                // The body scrolled until the field shows, as a user does to press it.
                const hidden = field.getBoundingClientRect().bottom - (b.getBoundingClientRect().bottom - 10);
                if (hidden > 0) {
                    b.scrollTop += Math.ceil(hidden);
                    await nextFrame();
                }
                field.focus({ preventScroll: true });
                out.focused = document.activeElement === field;
                out.start = b.scrollTop;
                out.fieldBefore = field.getBoundingClientRect().bottom;
                const frames = await recordFrames(root, b, field, ${KEYBOARD_HEIGHT}, { after: showKeyboardAsIPad(${KEYBOARD_HEIGHT}) });
                out.rest = frames.at(-1);
                out.written = b.style.paddingBottom;
                const pad = parseFloat(b.style.paddingBottom);
                const top = b.scrollTop;
                const range = () => b.scrollHeight - b.clientHeight;
                out.top = top;
                out.range = range();
                // The padding written, less a pixel: how far the body then scrolls.
                b.style.paddingBottom = (pad - 1) + 'px';
                out.rangeLess = range();
                b.style.paddingBottom = out.written;
                b.scrollTop = top;
                out.pad = pad;
                return JSON.stringify(out);
            } finally {
                hideKeyboard();
                await cleanUpHubs();
                await restore();
            }
        `);
        type Frame = { field: number; keyboardTop: number; bodyBottom: number; scrollTop: number };
        const heights = steps.heights as { basic: number; detail: number };
        if (file === CHILD_FILE) expect(heights.detail).toBeLessThan(heights.basic);
        else expect(heights.detail).toBeGreaterThan(heights.basic);
        expect(steps.focused).toBe(true);
        // The field stands below where it is to ride: what the keyboard is sized for.
        expect(steps.fieldBefore as number).toBeGreaterThan(KEYBOARD_WINDOW.height - KEYBOARD_HEIGHT - 10);
        const rest = steps.rest as Frame;
        // The keyboard hides the field: the body moved for it.
        expect(rest.scrollTop).toBeGreaterThan(steps.start as number);
        expect(Math.abs(rest.field - (Math.min(rest.keyboardTop, rest.bodyBottom) - 10))).toBeLessThanOrEqual(1);
        expect(steps.written).not.toBe('');
        expect(steps.pad as number).toBeGreaterThan(steps.stylePad as number);
        // The body scrolls as far as the field needs with the padding written, and a pixel less of it falls short.
        expect(steps.range as number).toBeGreaterThanOrEqual((steps.top as number) - 1);
        expect(steps.rangeLess as number).toBeLessThan(steps.top as number);
    });
});

describe('the place of the hub on a daily note, changed', () => {
    it('says where the task goes as the note is changed, and makes the daily note of its template once it is named again', async () => {
        await writeIndexedTestFile(OTHER_FILE, OTHER_NOTE);
        // A note with no task: the vault lists it, the index does not.
        writeTestFile(TEMPLATE_FILE, TEMPLATE);
        const steps = run<Record<string, unknown>>(`
            await until(() => exists(${JSON.stringify(TEMPLATE_FILE)}));
            const daily = app.internalPlugins.getPluginById('daily-notes').instance.options;
            const had = daily.template;
            daily.template = ${JSON.stringify(TEMPLATE_FILE.replace(/\.md$/, ''))};
            try {
                await fromAllDay(${JSON.stringify(TEMPLATE_DAY)}, ${JSON.stringify(tr('menu.createTaskForDailyNote'))});
                await until(() => nameInput() && document.activeElement === nameInput() && lineSays().length > 0);
                const out = { opened: lineSays() };
                type(nameInput(), '戻した');
                out.other = await retyped(noteInput(), ${JSON.stringify(OTHER_NAME)});
                out.made = await retyped(noteInput(), ${JSON.stringify(NEW_NAME)});
                out.madeUnder = says(noteInput());
                out.back = await retyped(noteInput(), ${JSON.stringify(TEMPLATE_DAY)});
                out.backUnder = says(noteInput());
                create();
                await until(() => !draft(), 5000, () => lineSays().join('|'));
                await until(() => exists(${JSON.stringify(dailyOf(TEMPLATE_DAY))}));
                out.disk = await disk(${JSON.stringify(dailyOf(TEMPLATE_DAY))});
                out.newMade = exists(${JSON.stringify(`${NEW_NAME}.md`)});
                return JSON.stringify(out);
            } finally {
                daily.template = had;
            }
        `);
        const toDaily = `${INFO}: ${tr('modal.newTask.toNew', { note: dailyOf(TEMPLATE_DAY), heading: 'Tasks' })}`;
        expect(steps.opened).toEqual([toDaily]);
        expect(steps.other).toEqual([`${INFO}: ${tr('modal.newTask.toHead', { note: OTHER_FILE, heading: 'Tasks' })}`]);
        expect(steps.made).toEqual([`${WARNING}: ${tr('modal.newTask.toNewNote', { note: `${NEW_NAME}.md`, heading: 'Tasks' })}`]);
        expect(steps.madeUnder).toEqual([`${WARNING}: ${tr('modal.newTask.noteNew')}`]);
        // Named again, it is the daily note, made of the day's template, not an empty note.
        expect(steps.back).toEqual([toDaily]);
        expect(steps.backUnder).toEqual([`${WARNING}: ${tr('modal.newTask.noteNew')}`]);
        const lines = (steps.disk as string).split('\n');
        expect(lines.slice(0, 2)).toEqual(['# テンプレート', '## Tasks']);
        expect(lines[2]).toMatch(/^- \[ \] 戻した/);
        expect(steps.newMade).toBe(false);
        expect(readTestFile(OTHER_FILE)).toBe(OTHER_NOTE);
    });

    it('asks on a close of a place changed alone, and not once it is changed back, nor of a hub given nothing', async () => {
        await writeIndexedTestFile(OTHER_FILE, OTHER_NOTE);
        const steps = run<Record<string, unknown>>(`
            const out = {};
            await openDaily(${JSON.stringify(CLOSE_DAY)});
            closeHub();
            await until(() => !draft());
            out.nothing = { open: !!draft() };

            await openDaily(${JSON.stringify(CLOSE_DAY)});
            await retyped(noteInput(), ${JSON.stringify(OTHER_NAME)});
            closeHub();
            await until(() => ask());
            out.changed = { open: !!draft(), ask: ask() };
            button(${JSON.stringify(tr('modal.draft.keep'))}).click();
            await until(() => !ask());
            await retyped(noteInput(), ${JSON.stringify(CLOSE_DAY)});
            closeHub();
            await until(() => !draft() || ask());
            out.back = { open: !!draft(), ask: ask() };
            return JSON.stringify(out);
        `);
        expect(steps).toEqual({
            nothing: { open: false },
            changed: { open: true, ask: tr('modal.newTask.discardAsk') },
            back: { open: false, ask: null },
        });
        expect(run<boolean>(`return JSON.stringify(exists(${JSON.stringify(dailyOf(CLOSE_DAY))}));`)).toBe(false);
        expect(readTestFile(OTHER_FILE)).toBe(OTHER_NOTE);
    });
});

describe('a create pressed on Details, over a value of General that cannot be written', () => {
    it('a date that does not read: goes to General, the focus on the date, and writes nothing', () => {
        run(`
            await openDaily(${JSON.stringify(DATE_DAY)});
            type(nameInput(), '日付');
            typeIn(dateInput(${JSON.stringify(tr('modal.start'))}, 'date'), 'あした');
            await choose('detail');
            create();
            return 'ok';
        `);
        const after = run<Record<string, unknown>>(`
            const date = dateInput(${JSON.stringify(tr('modal.start'))}, 'date');
            return JSON.stringify({ open: !!draft(), tab: tabOn(), focused: document.activeElement === date, says: says(date).length, made: exists(${JSON.stringify(dailyOf(DATE_DAY))}) });
        `);
        expect(after).toEqual({ open: true, tab: 'basic', focused: true, says: 1, made: false });
    });

    it('a time whose date the place gave, the place changed to one that gives none: goes to General, the focus on the time, and writes nothing', async () => {
        await writeIndexedTestFile(INHERIT_FILE, INHERIT_NOTE);
        await writeIndexedTestFile(OTHER_FILE, OTHER_NOTE);
        const steps = run<Record<string, unknown>>(`
            plugin.openDraftHub(null, {});
            await until(() => draft() && document.activeElement === noteInput());
            await retyped(noteInput(), ${JSON.stringify(INHERIT_NAME)});
            await retyped(headingInput(), 'Work');
            const time = () => dateInput(${JSON.stringify(tr('modal.start'))}, 'time');
            const date = () => dateInput(${JSON.stringify(tr('modal.start'))}, 'date');
            type(nameInput(), '時刻だけ');
            type(time(), '10:00');
            const out = { inherited: { placeholder: date().placeholder, says: says(time()) } };
            await retyped(noteInput(), ${JSON.stringify(OTHER_NAME)});
            await retyped(headingInput(), 'Tasks');
            await choose('detail');
            create();
            return JSON.stringify(out);
        `);
        const after = run<Record<string, unknown>>(`
            const time = dateInput(${JSON.stringify(tr('modal.start'))}, 'time');
            return JSON.stringify({ open: !!draft(), tab: tabOn(), focused: document.activeElement === time, says: says(time) });
        `);
        expect(steps.inherited).toEqual({ placeholder: '2031-02-01', says: [] });
        expect(after).toEqual({ open: true, tab: 'basic', focused: true, says: [`${ERROR}: ${tr('validation.startRequiresDate')}`] });
        expect(readTestFile(INHERIT_FILE)).toBe(INHERIT_NOTE);
        expect(readTestFile(OTHER_FILE)).toBe(OTHER_NOTE);
    });
});

describe('the note field of the place', () => {
    it('closes its list alone on an Escape, and the next Escape goes the way the hub closes', async () => {
        await writeIndexedTestFile(OTHER_FILE, OTHER_NOTE);
        const steps = run<Record<string, unknown>>(`
            await openDaily(${JSON.stringify(ESCAPE_DAY)});
            const list = () => document.querySelector('.suggestion-container');
            const items = () => [...document.querySelectorAll('.suggestion-container .suggestion-item')].map(el => el.textContent);
            typeIn(noteInput(), ${JSON.stringify(OTHER_NAME.slice(0, -3))});
            await until(() => items().some(t => t.includes(${JSON.stringify(OTHER_NAME)})));
            const out = { listed: items().some(t => t.includes(${JSON.stringify(OTHER_NAME)})) };
            keys('Escape');
            await until(() => !list());
            await nextFrame();
            out.first = { list: !!list(), open: !!draft(), ask: ask(), onNote: document.activeElement === noteInput() };
            keys('Escape');
            await until(() => ask() || !draft());
            out.second = { open: !!draft(), ask: ask() };
            return JSON.stringify(out);
        `);
        expect(steps).toEqual({
            listed: true,
            first: { list: false, open: true, ask: null, onNote: true },
            // The note typed changed the place: the close asks.
            second: { open: true, ask: tr('modal.newTask.discardAsk') },
        });
    });
});

describe('a create pressed while the note just typed is read', () => {
    it('waits for the read and writes the name typed before the press in that note', async () => {
        await writeIndexedTestFile(OTHER_FILE, OTHER_NOTE);
        const steps = run<Record<string, unknown>>(`
            await openDaily(${JSON.stringify(WAIT_DAY)});
            type(nameInput(), '待った');
            holdReads();
            const out = {};
            try {
                typeIn(noteInput(), ${JSON.stringify(OTHER_NAME)});
                create();
                await until(() => R.held > 0 && createButton().textContent === ${JSON.stringify(tr('modal.newTask.creating'))});
                await nextFrame();
                out.waiting = {
                    open: !!draft(),
                    create: createButton().textContent,
                    offered: !createButton().disabled,
                    fields: placeInputs().map(i => i.disabled),
                    name: nameInput().disabled,
                    disk: await disk(${JSON.stringify(OTHER_FILE)}),
                };
                R.releaseReads();
                await until(() => !draft(), 5000, () => lineSays().join('|'));
            } finally {
                R.unhold?.();
            }
            out.disk = await disk(${JSON.stringify(OTHER_FILE)});
            out.daily = exists(${JSON.stringify(dailyOf(WAIT_DAY))});
            return JSON.stringify(out);
        `);
        expect(steps.waiting).toEqual({
            open: true,
            create: tr('modal.newTask.creating'),
            offered: false,
            fields: [true, true],
            name: true,
            disk: OTHER_NOTE,
        });
        expect(steps.disk).toMatch(/^# 別\n## Tasks\n- \[ \] 待った.*\n- \[ \] 既存\n$/);
        expect(steps.daily).toBe(false);
    });
});

describe('the tabs of the hub under a row (a card\'s menu, Add child task)', () => {
    /** The hub under the row named, opened from the card menu the hub's cards open. */
    const OPEN = (name: string) => `
        const task = rowTask(${JSON.stringify(CHILD_FILE)}, ${JSON.stringify(name)});
        if (!plugin.taskHub.cards) {
            plugin.openTaskHub(task.id);
            const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
            await until(() => hub());
            hub().closest('.tv-overlay').querySelector('.tv-overlay__close').click();
            await until(() => !hub());
        }
        await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, task);
        await pick(${JSON.stringify(tr('menu.addChildTask'))});
        await until(() => nameInput() && document.activeElement === nameInput() && lineSays().length > 0);
        const shownPlace = () => paneOf('basic').querySelector('.task-hub__shown');
        const values = () => [...shownPlace().querySelectorAll('.task-hub__shown-value')].map(v => v.textContent);
        const labels = () => [...shownPlace().querySelectorAll('.tv-form__row .tv-form__label')].map(l => l.textContent);
    `;

    it('opens on General, which shows the parent\'s note, heading and text with no field; the child goes first among its children', async () => {
        await writeIndexedTestFile(CHILD_FILE, CHILD_NOTE);
        const steps = run<Record<string, unknown>>(`
            ${OPEN('親')}
            const out = {
                tabs: [...draft().querySelectorAll('button.tv-tabs__tab')].map(b => b.dataset.tab),
                tab: tabOn(),
                onName: document.activeElement === nameInput(),
            };
            out.place = { labels: labels(), values: values(), fields: shownPlace().querySelectorAll('input').length, says: [...shownPlace().querySelectorAll('.tv-form__says > *')].map(c => c.className + ': ' + c.textContent) };
            type(nameInput(), '新しい子');
            create();
            await until(() => !draft());
            out.disk = await disk(${JSON.stringify(CHILD_FILE)});
            return JSON.stringify(out);
        `);
        expect(steps).toMatchObject({ tabs: ['basic', 'detail'], tab: 'basic', onName: true });
        expect(steps.place).toEqual({
            labels: [tr('modal.note'), tr('modal.heading'), tr('modal.parentTask')],
            values: [CHILD_FILE, '見出し', '親'],
            fields: 0,
            says: [`${INFO}: ${tr('modal.newTask.childFixed')}`],
        });
        expect(steps.disk).toBe(CHILD_NOTE.replace('- [ ] 親\n', '- [ ] 親\n\t- [ ] 新しい子\n'));
    });

    it('shows no heading for a parent above the note\'s first heading', async () => {
        await writeIndexedTestFile(CHILD_FILE, CHILD_NOTE);
        const values = run<string[]>(`
            ${OPEN('上の親')}
            return JSON.stringify(values());
        `);
        expect(values).toEqual([CHILD_FILE, tr('modal.newTask.noHeading'), '上の親']);
    });
});
