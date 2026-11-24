/**
 * A task created in a note the user chooses, in the running E2E vault, as a
 * user does it: a Timeline's empty space, its menu's Create Task in a Note,
 * opens the place dialog, titled as the task it creates, the note field
 * empty and the heading field on the settings' heading, its next not
 * offered until a note is named. The note and the heading typed, next opens
 * the hub on a task not written yet, holding the day pressed (and the time,
 * on the timed lane), and its create writes the line there:
 *
 * - in a note there, under a heading there;
 * - in a note not there, by its name alone, under a heading: the note made
 *   empty with the heading, in the folder for new notes seen from no note;
 * - in a note there, the heading field emptied: at the note's end;
 * - the dialog cancelled: no hub opens and nothing is written.
 *
 * The day is far off (2031-01-22) and its daily note is not made. The
 * notes' bytes are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     its daily notes at the vault's root as YYYY-MM-DD, with no template
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/draft-in-note.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, writeIndexedTestFile } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';
import { MENUS } from '../helpers/menus';
import { DIALOG_ROWS } from '../helpers/dialog-rows';

const DAY = '2031-01-22';
const DAILY = `${DAY}.md`;
const NOTE_NAME = 'test-int-draft-in-note';
const NOTE_FILE = `${NOTE_NAME}.md`;
/** A note not there: named in the dialog, made by the create. */
const NEW_NAME = 'test-int-draft-in-note-new';

/** A heading with nothing under it, so the line goes right under it at its head or its end. */
const NOTE = [
    '# 見出し',
    '## Work',
    '## Other',
    '- [ ] 既存',
    '',
].join('\n');

const PRELUDE = `
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
${DIALOG_ROWS}
const R = (window.__tvDraftInNoteE2E ??= {});
const shown = el => !!el && getComputedStyle(el).display !== 'none';
const overlays = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing)')];
/** The place dialog: the panel that is not a hub, titled as the task it creates. */
const place = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__panel')]
    .find(p => !p.classList.contains('task-hub') && p.querySelector('h2.tv-form__title')?.textContent === ${JSON.stringify(tr('modal.newTask.title'))}) ?? null;
const fields = () => [...place().querySelectorAll('.tv-form__clearable > input')];
const next = () => formRow(place()).querySelector(':scope > .mod-cta');
/** The hub on a task not written yet: the hub that offers a create. */
const draft = () => [...document.querySelectorAll('.tv-overlay:not(.is-closing) .task-hub')]
    .find(p => formRow(p)?.querySelector(':scope > .mod-cta')) ?? null;
const nameInput = () => draft()?.querySelector('.tv-form__name-section input') ?? null;
const rowOf = label => [...draft().querySelectorAll('.tv-form__row')].find(r => r.querySelector('.tv-form__label')?.textContent === label);
const start = which => rowOf(${JSON.stringify(tr('modal.start'))}).querySelector('.tv-form__field--' + which + ' input.tv-ctrl__text-input').value;
const lineSays = () => [...draft().querySelector(':scope > .tv-overlay__foot > .task-hub__create-line .task-hub__create-says').children].map(c => c.textContent);
/** Typed as a person types: the text, then its input event. */
const typeIn = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
${MENUS}
/** Pick the item titled so in the menu open now (on macOS the menu may be the native one, outside the DOM). */
const pick = async title => {
    await until(() => menuTitles().includes(title), 3000, () => menuTitles().join('|'));
    menuItem(i => i.titleEl?.textContent === title);
};
/** A Timeline on DAY, its leaf kept to be closed after. */
const timeline = async () => {
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: 'timeline-view', state: { date: ${JSON.stringify(DAY)} }, active: true });
    R.tl = leaf;
    return leaf;
};
const contextAt = (el, dx, dy) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + dx, clientY: r.top + dy }));
};
/** The place dialog opened from the all-day lane's menu, as it opens. */
const openFromAllDay = async () => {
    const leaf = await timeline();
    let cell = null;
    await until(() => (cell = leaf.view.contentEl.querySelector('.allday-section__cell[data-date="${DAY}"]')));
    contextAt(cell, 5, 5);
    await pick(${JSON.stringify(tr('menu.createTaskInNote'))});
    await until(() => place() && document.activeElement === fields()[0]);
    return { note: fields()[0].value, heading: fields()[1].value, canNext: !next().disabled, button: next().textContent };
};
/** Type the note and the heading, wait for next to be offered, press it, and wait for the hub. */
const choose = async (note, heading) => {
    typeIn(fields()[0], note);
    typeIn(fields()[1], heading);
    await until(() => !next().disabled, 3000, 'next not offered for ' + note + ' / ' + heading);
    next().click();
    await until(() => !place() && nameInput() && document.activeElement === nameInput());
    await until(() => lineSays().length > 0);
};
/** Name the task in the hub and create it; wait for the hub to close. */
const createNamed = async name => {
    typeIn(nameInput(), name);
    formRow(draft()).querySelector(':scope > .mod-cta').click();
    await until(() => !draft(), 5000, () => lineSays().join('|'));
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

/** Close every overlay, throwing away what a hub asks about, then the menu and the leaves the tests opened. */
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
        for (const name of Object.keys(R)) { R[name]?.detach(); delete R[name]; }
        return 'ok';
    `);
}

interface Opened {
    note: string;
    heading: string;
    canNext: boolean;
    button: string;
}

/** The path the note made by the name alone is at: the folder for new notes seen from no note. */
let newPath: string | null = null;

beforeAll(() => {
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    newPath = run<string>(`
        const folder = app.fileManager.getNewFileParent('').path;
        return JSON.stringify((folder === '/' || folder === '' ? '' : folder + '/') + ${JSON.stringify(`${NEW_NAME}.md`)});
    `);
    const there = run<string[]>(`return JSON.stringify(${JSON.stringify([DAILY, newPath])}.filter(p => app.vault.getAbstractFileByPath(p)));`);
    if (there.length > 0) throw new Error(`${there.join(', ')} in the E2E vault: the test makes none of them over one there.`);
});

afterEach(() => {
    cleanUp();
    expect(run<boolean>(`return JSON.stringify(!!app.vault.getAbstractFileByPath(${JSON.stringify(DAILY)}));`)).toBe(false);
});

afterAll(async () => {
    for (const file of [NOTE_FILE, newPath].filter((p): p is string => p !== null)) {
        deleteTestFile(file);
        await waitForFileDeindexed(file);
    }
});

describe('a task created in a note chosen', () => {
    it('in a note there, under a heading there, from the timed lane: the day and the time pressed carried to the hub', async () => {
        await writeIndexedTestFile(NOTE_FILE, NOTE);
        const steps = run<{ opened: Opened; start: { date: string; time: string }; expected: string; line: string[] }>(`
            const leaf = await timeline();
            let col = null;
            await until(() => (col = leaf.view.contentEl.querySelector('.timeline-scroll-area__day-column[data-date="${DAY}"]')));
            // Five hours after the lane's start, a pixel down: rounded to that hour.
            const hour = parseFloat(getComputedStyle(col).getPropertyValue('--hour-height'));
            const startHour = plugin.settings.startHour;
            contextAt(col, 5, hour * 5 + 1);
            await pick(${JSON.stringify(tr('menu.createTaskInNote'))});
            await until(() => place() && document.activeElement === fields()[0]);
            const opened = { note: fields()[0].value, heading: fields()[1].value, canNext: !next().disabled, button: next().textContent };
            await choose(${JSON.stringify(NOTE_NAME)}, 'Work');
            const at = { date: start('date'), time: start('time') };
            const line = lineSays();
            await createNamed('選んだノートへ');
            return JSON.stringify({ opened, start: at, expected: String((startHour + 5) % 24).padStart(2, '0') + ':00', line });
        `);
        expect(steps.opened).toEqual({ note: '', heading: 'Tasks', canNext: false, button: tr('modal.place.next') });
        expect(steps.start).toEqual({ date: DAY, time: steps.expected });
        expect(steps.line.length).toBeGreaterThan(0);
        const lines = readTestFile(NOTE_FILE).split('\n');
        const at = lines.findIndex(l => l.includes('選んだノートへ'));
        expect(lines[at - 1]).toBe('## Work');
        expect(lines.slice(at + 1)).toContain('## Other');
        expect(lines[0]).toBe('# 見出し');
    });

    it('in a note not there, by its name alone, under a heading: the note made empty with the heading', () => {
        const steps = run<{ opened: Opened; level: number }>(`
            const opened = await openFromAllDay();
            await choose(${JSON.stringify(NEW_NAME)}, 'Plan');
            await createNamed('新しいノートへ');
            await until(() => app.vault.getAbstractFileByPath(${JSON.stringify(newPath)}));
            return JSON.stringify({ opened, level: plugin.settings.taskHeadingLevel });
        `);
        expect(steps.opened).toEqual({ note: '', heading: 'Tasks', canNext: false, button: tr('modal.place.next') });
        const lines = readTestFile(newPath!).split('\n');
        expect(lines[0]).toBe(`${'#'.repeat(steps.level)} Plan`);
        expect(lines[1]).toContain('新しいノートへ');
    });

    it('in a note there, the heading field emptied: at the note\'s end', async () => {
        await writeIndexedTestFile(NOTE_FILE, NOTE);
        run(`
            await openFromAllDay();
            await choose(${JSON.stringify(NOTE_NAME)}, '');
            await createNamed('末尾へ');
            return 'ok';
        `);
        const text = readTestFile(NOTE_FILE);
        expect(text.startsWith(NOTE)).toBe(true);
        const added = text.slice(NOTE.length).split('\n').filter(l => l !== '');
        expect(added[0]).toContain('末尾へ');
    });

    it('the dialog cancelled: no hub opens and nothing is written', async () => {
        await writeIndexedTestFile(NOTE_FILE, NOTE);
        const steps = run<{ hub: boolean; place: boolean }>(`
            await openFromAllDay();
            typeIn(fields()[0], ${JSON.stringify(NOTE_NAME)});
            await until(() => !next().disabled);
            formRow(place()).querySelector('.tv-form__cancel').click();
            await until(() => !place());
            await new Promise(r => setTimeout(r, 300));
            return JSON.stringify({ hub: !!draft(), place: !!place() });
        `);
        expect(steps).toEqual({ hub: false, place: false });
        expect(readTestFile(NOTE_FILE)).toBe(NOTE);
    });
});
