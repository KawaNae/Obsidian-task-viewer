/**
 * Closing the hub on a task not written yet, in the running E2E vault, and
 * opening it over the hub on a row.
 *
 * - Given nothing, it closes asking nothing, however it is closed.
 * - Given something (a name typed and not left, or a date that does not
 *   read), a close asks one question, whether to throw the task away:
 *   discard closes it at once, writing nothing; back keeps it, and the next
 *   close asks again. The question is said as the plugin's text for it, and
 *   its buttons are read.
 * - Over the hub on a row, opened from its card's menu ("Add child task"):
 *   the hub on a row stays open under it. Made, the child goes into the
 *   card of the hub under it; thrown away (the close button, Escape, a
 *   press outside), it alone closes, and the focus goes back to the hub
 *   under it.
 *
 * The fields are typed in as a person types (the text, then its `input`
 * event). The note's bytes are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/draft-close.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';

const TEST_FILE = 'test-int-draft-close.md';

const NOTE = [
    '# 見出し',
    '- [ ] 親 @2026-10-01',
    '- [ ] 次',
    '',
].join('\n');

const PRELUDE = `
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const FILE = ${JSON.stringify(TEST_FILE)};
${UNTIL}
const shown = el => !!el && getComputedStyle(el).display !== 'none';
const overlays = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing)')];
const hubs = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing) .task-hub')];
/** The hub on a task not written yet: the hub that offers a create. */
const isDraft = p => !!p.querySelector('.task-hub__form > .tv-form__buttons > .mod-cta');
const draft = () => hubs().find(isDraft) ?? null;
const rowHub = () => hubs().find(p => !isDraft(p)) ?? null;
const nameInput = () => draft()?.querySelector('.tv-form__name-section input') ?? null;
const rowOf = label => [...draft().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const startDate = () => rowOf(${JSON.stringify(tr('modal.start'))}).querySelector('.tv-form__field--date input.tv-ctrl__text-input');
const typeIn = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
const type = (input, text) => { typeIn(input, text); input.dispatchEvent(new FocusEvent('blur')); };
const ask = () => { const el = draft()?.querySelector('.tv-form__ask'); return shown(el) ? el.textContent : null; };
const buttons = () => [...draft().querySelectorAll('.tv-form__buttons button')].filter(shown).map(b => b.textContent);
const button = text => [...draft().querySelectorAll('.tv-form__buttons button')].filter(shown).find(b => b.textContent === text);
const key = (name, code) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: name, code: name, keyCode: code, bubbles: true, cancelable: true }));
/** The ways the user closes the hub on a task not written yet. */
const ways = {
    closeButton: () => draft().closest('.tv-overlay').querySelector('.tv-overlay__close').click(),
    escape: () => key('Escape', 27),
    outside: () => draft().closest('.tv-overlay').querySelector('.tv-overlay__backdrop')
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })),
};
const disk = () => app.vault.adapter.read(FILE);
const menuTitles = () => (plugin.menuPresenter.currentMenu?.items ?? []).map(i => i.titleEl?.textContent ?? '').filter(Boolean);
const rowTask = name => {
    const task = plugin.getIndex().getTasks().find(t => t.file === FILE && t.content.startsWith(name));
    if (!task) throw new Error('no row ' + name);
    return task;
};
/** Open the hub on a task not written yet as the child of the row named, the focus on its name. */
const openChild = async name => {
    plugin.openDraftHub({ kind: 'childOf', taskId: rowTask(name).id }, {});
    await until(() => nameInput() && document.activeElement === nameInput());
    await until(() => draft().querySelector('.tv-form__says--form').children.length > 0);
};
/**
 * Open the hub on the row named, then, from its card's menu, Add child task:
 * wait for both to be open and the focus on the name.
 */
const openOverHub = async name => {
    plugin.openTaskHub(rowTask(name).id);
    await until(() => rowHub() && rowHub().contains(document.activeElement));
    rowHub().querySelector('.task-hub__preview .task-card')
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    const title = ${JSON.stringify(tr('menu.addChildTask'))};
    await until(() => menuTitles().includes(title), 3000, () => menuTitles().join('|'));
    const item = plugin.menuPresenter.currentMenu.items.find(i => i.titleEl?.textContent === title);
    plugin.menuPresenter.dismiss();
    item.callback(new MouseEvent('click'));
    await until(() => rowHub() && nameInput() && document.activeElement === nameInput());
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

/** Close every overlay, top first, throwing away what a hub asks about. */
function cleanUp(): void {
    run(`
        for (let i = 0; i < 6 && overlays().length > 0; i++) {
            const top = overlays().pop();
            const discard = () => [...top.querySelectorAll('.tv-form__discard')].find(shown);
            if (discard()) discard().click();
            else top.querySelector('.tv-overlay__close').click();
            await until(() => !overlays().includes(top) || discard());
        }
        plugin.menuPresenter.dismiss();
        return 'ok';
    `);
}

const WAYS = ['closeButton', 'escape', 'outside'] as const;

beforeAll(() => {
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
});

beforeEach(async () => { await writeIndexedTestFile(TEST_FILE, NOTE); });
afterEach(() => { cleanUp(); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('closing the hub on a task not written yet', () => {
    for (const way of WAYS) {
        it(`closes asking nothing when it was given nothing (${way})`, () => {
            const closed = run<boolean>(`
                await openChild('親');
                ways.${way}();
                await until(() => !draft());
                return JSON.stringify(!draft());
            `);
            expect(closed).toBe(true);
            expect(readTestFile(TEST_FILE)).toBe(NOTE);
        });
    }

    it('asks whether to throw away a name typed and not left: back keeps it and the next close asks again, discard closes it', () => {
        const steps = run<Record<string, unknown>>(`
            await openChild('親');
            const out = {};
            typeIn(nameInput(), '捨てる');
            ways.closeButton();
            await until(() => ask());
            out.asked = { open: !!draft(), ask: ask(), buttons: buttons(), onBack: document.activeElement === button(${JSON.stringify(tr('modal.draft.keep'))}) };

            button(${JSON.stringify(tr('modal.draft.keep'))}).click();
            await until(() => !ask());
            out.kept = { open: !!draft(), name: nameInput().value, onName: document.activeElement === nameInput() };

            ways.closeButton();
            await until(() => ask());
            out.again = { open: !!draft(), ask: ask() };

            button(${JSON.stringify(tr('modal.hub.unsavedDiscard'))}).click();
            await until(() => !draft());
            out.discarded = { open: !!draft(), disk: await disk() };
            return JSON.stringify(out);
        `);
        const question = tr('modal.newTask.discardAsk');
        expect(steps.asked).toEqual({
            open: true,
            ask: question,
            buttons: [tr('modal.hub.unsavedDiscard'), tr('modal.draft.keep'), tr('modal.create')],
            onBack: true,
        });
        expect(steps.kept).toEqual({ open: true, name: '捨てる', onName: true });
        expect(steps.again).toEqual({ open: true, ask: question });
        expect(steps.discarded).toEqual({ open: false, disk: NOTE });
    });

    it('asks the same, not of the date alone, over a date that does not read, and discard closes it at once', () => {
        const steps = run<Record<string, unknown>>(`
            await openChild('親');
            const out = {};
            type(nameInput(), '日付');
            typeIn(startDate(), '2026-02-30');
            ways.escape();
            await until(() => ask());
            out.asked = { open: !!draft(), ask: ask(), buttons: buttons() };
            button(${JSON.stringify(tr('modal.hub.unsavedDiscard'))}).click();
            await until(() => !draft());
            out.discarded = { open: !!draft(), disk: await disk() };
            return JSON.stringify(out);
        `);
        expect(steps.asked).toEqual({
            open: true,
            ask: tr('modal.newTask.discardAsk'),
            buttons: [tr('modal.hub.unsavedDiscard'), tr('modal.draft.keep'), tr('modal.create')],
        });
        expect(steps.discarded).toEqual({ open: false, disk: NOTE });
    });
});

describe('the hub on a task not written yet, over the hub on a row', () => {
    it('opens over it from its card\'s menu, and once made closes alone, the child in the card of the hub under it', () => {
        const steps = run<Record<string, unknown>>(`
            await openOverHub('親');
            const order = overlays().map(o => o.querySelector('.task-hub') ? (isDraft(o.querySelector('.task-hub')) ? 'draft' : 'row') : 'other');
            const out = { opened: { row: !!rowHub(), draft: !!draft(), order } };
            type(nameInput(), '重ね');
            draft().querySelector('.task-hub__form > .tv-form__buttons > .mod-cta').click();
            await until(() => !draft());
            await until(() => rowHub()?.querySelector('.task-hub__preview')?.textContent.includes('重ね'));
            out.made = { row: !!rowHub(), draft: !!draft(), inRowCard: rowHub().querySelector('.task-hub__preview').textContent.includes('重ね') };
            return JSON.stringify(out);
        `);
        expect(steps).toEqual({
            opened: { row: true, draft: true, order: ['row', 'draft'] },
            made: { row: true, draft: false, inRowCard: true },
        });
        expect(readTestFile(TEST_FILE)).toBe(NOTE.replace('- [ ] 親 @2026-10-01\n', '- [ ] 親 @2026-10-01\n\t- [ ] 重ね\n'));
    });

    for (const way of WAYS) {
        it(`thrown away, closes alone, the focus going back to the hub under it (${way})`, () => {
            const steps = run<Record<string, unknown>>(`
                await openOverHub('親');
                ways.${way}();
                await until(() => !draft());
                await until(() => rowHub()?.contains(document.activeElement));
                return JSON.stringify({ row: !!rowHub(), draft: !!draft(), focus: !!rowHub()?.contains(document.activeElement) });
            `);
            expect(steps).toEqual({ row: true, draft: false, focus: true });
            expect(readTestFile(TEST_FILE)).toBe(NOTE);
        });
    }
});
