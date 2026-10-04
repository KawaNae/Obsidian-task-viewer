/**
 * The hub's close (段10d), in the running Dev vault: every way the user
 * closes it saves what is typed with no blur waited for, a value that cannot
 * be saved keeps it open and asks (the focus on fix), a write refused keeps
 * it open with why at the form's end and no notice, and the source mode asks
 * nothing over a draft that writes nothing.
 *
 * The fields are typed in as a person types (the text, then its `input`
 * event) and never left: no blur comes, so what is saved is what the close
 * saved. The note's bytes are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with a build that has the hub's close (TaskHubForm.beforeClose)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/close-save.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';

const TEST_FILE = 'test-int-hub-close.md';

const NOTE = [
    '# 見出し',
    '- [ ] 親 @2026-10-01',
    '    - [ ] 子',
    '- [ ] 次',
    '',
].join('\n');

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const FILE = ${JSON.stringify(TEST_FILE)};
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const rowOf = label => [...hub().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const dateInput = (label, which) => rowOf(label).querySelector('.tv-form__field--' + which + ' input.tv-ctrl__text-input');
const nameInput = () => hub().querySelector('.tv-form__name-section input');
const says = input => [...input.closest('.tv-form__row').nextElementSibling.children].map(c => c.className + ': ' + c.textContent);
/** The form's end: what is said of the form, and the question a close puts (null while none is). */
const formEnd = () => {
    const form = hub().querySelector('.task-hub__form');
    const ask = form.querySelector('.tv-form__ask');
    const shown = el => !!el && getComputedStyle(el).display !== 'none';
    return {
        says: [...form.querySelector('.tv-form__says--form').children].map(c => c.className + ': ' + c.textContent),
        ask: shown(ask) ? ask.textContent : null,
        buttons: [...form.querySelectorAll('.tv-form__buttons button')].filter(shown).map(b => b.textContent),
        onFix: document.activeElement === form.querySelector('.tv-form__cancel'),
    };
};
const type = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
const key = (name, code) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: name, keyCode: code, bubbles: true, cancelable: true }));
const escape = () => key('Escape', 27);
const enter = () => key('Enter', 13);
const closeButton = () => hub().closest('.tv-overlay__panel').querySelector('.tv-overlay__close').click();
const outside = () => hub().closest('.tv-overlay').querySelector('.tv-overlay__backdrop')
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
const disk = () => app.vault.adapter.read(FILE);
const notices = () => document.querySelectorAll('.notice').length;
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/** Open the hub on the row whose name starts with `name`. */
function openHub(name: string): void {
    run(`
        const task = plugin.getIndex().getTasks().find(t => t.file === FILE && t.content.startsWith(${JSON.stringify(name)}));
        if (!task) throw new Error('no row ' + ${JSON.stringify(name)});
        plugin.openTaskHub(task.id);
        await until(() => hub() && nameInput());
        await sleep(100);
        return 'ok';
    `);
}

/** Close whatever hub is open, throwing away what it asks about. */
function closeHub(): void {
    run(`
        await plugin.getIndex().setDraggingFile(null);
        for (let i = 0; i < 3 && hub(); i++) {
            closeButton();
            await sleep(100);
            hub()?.querySelector('.tv-form__discard')?.click();
            await until(() => !hub(), 1000);
        }
        return 'ok';
    `);
}

const START = () => tr('modal.start');
const ERROR = 'tv-form__error';

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
});

beforeEach(async () => { await writeIndexedTestFile(TEST_FILE, NOTE); });
afterEach(() => { closeHub(); });

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

describe('closing the hub', () => {
    for (const way of ['escape', 'closeButton', 'outside'] as const) {
        it(`saves the name typed, with no blur, before it closes (${way})`, async () => {
            openHub('親');
            const seen = run<Record<string, unknown>>(`
                type(nameInput(), '親 ${way}');
                ${way}();
                // The hub goes once the write is answered: the disk has the name as it starts to close.
                await until(() => !hub());
                return JSON.stringify({ closed: !hub(), disk: await disk() });
            `);
            const written = NOTE.replace('- [ ] 親 @2026-10-01', `- [ ] 親 ${way} @2026-10-01`);
            expect(seen).toEqual({ closed: true, disk: written });
            expect(readTestFile(TEST_FILE)).toBe(written);
        });
    }

    it('keeps it open over a date that does not read, asking with the focus on fix; discard and close saves the rest', async () => {
        openHub('親');
        const steps = run<Record<string, unknown>>(`
            const out = {};
            const start = () => dateInput(${JSON.stringify(START())}, 'date');
            // The name last: typed before the date, it would be left (a blur) and saved at once.
            type(start(), '2026-02-30');
            type(nameInput(), '親2');
            out.typed = await disk();
            escape();
            await sleep(300);
            out.asked = { open: !!hub(), field: says(start()), invalid: start().classList.contains('tv-ctrl__text-input--invalid'), ...formEnd(), dated: /^- \\[ \\] 親2? @2026-10-01$/m.test(await disk()) };

            // Asked again, it asks again, the focus taken back to fix.
            start().focus();
            escape();
            await sleep(200);
            out.again = { open: !!hub(), onFix: formEnd().onFix };

            // Fix: the question goes, and the date takes the focus.
            hub().querySelector('.task-hub__form .tv-form__cancel').click();
            await sleep(100);
            out.fixing = { ask: formEnd().ask, onDate: document.activeElement === start() };

            // Closed again without fixing it: discard and close keeps the date as it was, and saves the name.
            closeButton();
            await sleep(200);
            hub().querySelector('.task-hub__form .tv-form__discard').click();
            await until(() => !hub());
            out.discarded = { open: !!hub(), disk: await disk() };
            return JSON.stringify(out);
        `);
        const ask = tr('modal.hub.unsavedAsk', { fields: tr('modal.hub.dateField', { group: START(), part: tr('modal.date') }) });
        expect(steps.asked).toEqual({
            open: true,
            field: [`${ERROR}: ${tr('issue.noSuchDay')}`],
            invalid: true,
            says: [],
            ask,
            buttons: [tr('modal.hub.unsavedDiscard'), tr('modal.hub.unsavedFix')],
            onFix: true,
            // The date is not written. (The name, left for the question, may be saved by its blur.)
            dated: true,
        });
        expect(steps.typed).toBe(NOTE);
        expect(steps.again).toEqual({ open: true, onFix: true });
        expect(steps.fixing).toEqual({ ask: null, onDate: true });
        expect(steps.discarded).toEqual({ open: false, disk: NOTE.replace('- [ ] 親 @2026-10-01', '- [ ] 親2 @2026-10-01') });
    });

    it('keeps it open over a write refused, with why at the form\'s end and no notice, the name kept; Enter again writes it', async () => {
        openHub('親');
        const steps = run<Record<string, unknown>>(`
            const out = {};
            const before = notices();
            // The disk refuses the next write once (the write layer's 'failed').
            const real = app.vault.process;
            app.vault.process = async function () { app.vault.process = real; throw new Error('e2e: the disk refused'); };
            try {
                type(nameInput(), '親3');
                enter();
                await sleep(800);
                out.refused = { open: !!hub(), name: nameInput().value, ...formEnd(), notices: notices() - before, disk: await disk() };

                // The name kept, Enter again writes it.
                nameInput().focus();
                enter();
                await sleep(800);
                out.written = { open: !!hub(), says: formEnd().says, notices: notices() - before, disk: await disk() };
            } finally {
                app.vault.process = real;
            }
            return JSON.stringify(out);
        `);
        const why = `${ERROR}: ${tr('notice.notWritten', { reason: tr('notice.refusedFailed'), subject: TEST_FILE })}`;
        expect(steps.refused).toEqual({ open: true, name: '親3', says: [why], ask: null, buttons: [], onFix: false, notices: 0, disk: NOTE });
        expect(steps.written).toEqual({ open: true, says: [], notices: 0, disk: NOTE.replace('- [ ] 親 @2026-10-01', '- [ ] 親3 @2026-10-01') });
    });

    it('says a write refused over a change from outside at the form\'s end, with no notice', async () => {
        openHub('親');
        const steps = run<Record<string, unknown>>(`
            const before = notices();
            // A change from outside the index has not taken in yet (held, as during a drag).
            await plugin.getIndex().setDraggingFile(FILE);
            const file = app.vault.getAbstractFileByPath(FILE);
            await app.vault.modify(file, (await app.vault.read(file)) + '- [ ] 外\\n');
            type(nameInput(), '親4');
            enter();
            await sleep(800);
            return JSON.stringify({ open: !!hub(), name: nameInput().value, says: formEnd().says[0], notices: notices() - before, disk: await disk() });
        `);
        expect(steps).toEqual({
            open: true,
            name: '親4',
            says: `${ERROR}: ${tr('notice.readAgain', { subject: '親' })}`,
            notices: 0,
            disk: `${NOTE}- [ ] 外\n`,
        });
    });

    it('in the source, asks nothing over a blank line added at the end of the children, and closes on Escape', async () => {
        openHub('親');
        const seen = run<Record<string, unknown>>(`
            document.querySelectorAll('.task-hub__mode-toggle button')[1].click();
            const viewOf = which => {
                const el = document.querySelector('.task-hub .tv-source-editor__' + which + ' .cm-content');
                return el ? (el.cmTile?.view ?? el.cmView?.rootView?.view ?? null) : null;
            };
            await until(() => viewOf('children'));
            const children = viewOf('children');
            children.focus();
            children.dispatch({ changes: { from: children.state.doc.length, insert: '\\n' } });
            const draft = children.state.doc.toString();
            escape();
            await until(() => !hub());
            return JSON.stringify({ draft, closed: !hub(), asked: !!document.querySelector('.tv-overlay:not(.is-closing) .task-hub__source-actions .tv-form__ask') });
        `);
        expect(seen).toEqual({ draft: '- [ ] 子\n', closed: true, asked: false });
        expect(readTestFile(TEST_FILE)).toBe(NOTE);
    });
});
