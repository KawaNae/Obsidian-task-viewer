/**
 * A task created in a note the user chooses, in the running E2E vault, as a
 * user does it: a Timeline's empty space, its menu's Create Task in a Note,
 * opens the hub on a task not written yet on its place tab, the focus on
 * the note field, empty, the heading field on the settings' heading, the
 * line above the create asking for a note and the create not offered. The
 * hub holds the day pressed (and the time, on the timed lane). The note and
 * the heading typed in the place tab, the line above the create says each
 * time where the task goes, and the create writes the line there:
 *
 * - in a note there, under a heading there;
 * - in a note not there, by its name alone, under a heading: the note made
 *   empty with the heading, in the folder for new notes seen from no note,
 *   a warning under the note field and on the line above the create;
 * - in a note there, the heading field emptied: at the note's end;
 * - closed with nothing given: it asks nothing and nothing is written.
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
import { DRAFT_HUB } from '../helpers/draft-hub';

const DAY = '2031-01-22';
const DAILY = `${DAY}.md`;
const NOTE_NAME = 'test-int-draft-in-note';
const NOTE_FILE = `${NOTE_NAME}.md`;
/** A note not there: named in the place tab, made by the create. */
const NEW_NAME = 'test-int-draft-in-note-new';

/** A heading with nothing under it, so the line goes right under it at its head or its end. */
const NOTE = [
    '# 見出し',
    '## Work',
    '## Other',
    '- [ ] 既存',
    '',
].join('\n');

const INFO = 'tv-form__info';
const WARNING = 'tv-form__warning';

const PRELUDE = `
${UNTIL}
${DIALOG_ROWS}
${MENUS}
${DRAFT_HUB}
const start = which => dateInput(${JSON.stringify(tr('modal.start'))}, which).value;
/** The hub as Create Task in a Note opens it: the tab chosen, the focus, the place fields, the line above the create and the create. */
const opening = async () => {
    await until(() => draft() && noteInput() && document.activeElement === noteInput());
    await until(() => lineSays().length > 0);
    return {
        tab: tabOn(),
        focusOnNote: document.activeElement === noteInput(),
        note: noteInput().value,
        heading: headingInput().value,
        line: lineSays(),
        offered: !createButton().disabled,
        title: [...draft().querySelectorAll('h2')].map(h => h.textContent),
    };
};
/** Name the task in the properties tab and create it; wait for the hub to close. */
const createNamed = async name => {
    tab('properties').click();
    typeIn(nameInput(), name);
    create();
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

interface Opened {
    tab: string;
    focusOnNote: boolean;
    note: string;
    heading: string;
    line: string[];
    offered: boolean;
    title: string[];
}

/** The path the note made by the name alone is at: the folder for new notes seen from no note. */
let newPath: string | null = null;

function opened(): Opened {
    return {
        tab: 'place',
        focusOnNote: true,
        note: '',
        heading: 'Tasks',
        line: [`${INFO}: ${tr('modal.newTask.noNote')}`],
        offered: false,
        title: [tr('modal.newTask.title')],
    };
}

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
    run(`await cleanUpHubs(); return 'ok';`);
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
        const steps = run<{ opened: Opened; start: { date: string; time: string }; expected: string; line: string[]; under: string[] }>(`
            const leaf = await timeline(${JSON.stringify(DAY)});
            let col = null;
            await until(() => (col = leaf.view.contentEl.querySelector('.timeline-scroll-area__day-column[data-date="${DAY}"]')));
            // Five hours after the lane's start, a pixel down: rounded to that hour.
            const hour = parseFloat(getComputedStyle(col).getPropertyValue('--hour-height'));
            const startHour = plugin.settings.startHour;
            const r = col.getBoundingClientRect();
            col.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + hour * 5 + 1 }));
            await pick(${JSON.stringify(tr('menu.createTaskInNote'))});
            const opened = await opening();
            await retyped(noteInput(), ${JSON.stringify(NOTE_NAME)});
            const line = await retyped(headingInput(), 'Work');
            const under = says(noteInput());
            const at = { date: start('date'), time: start('time') };
            await createNamed('選んだノートへ');
            return JSON.stringify({ opened, start: at, expected: String((startHour + 5) % 24).padStart(2, '0') + ':00', line, under });
        `);
        expect(steps.opened).toEqual(opened());
        expect(steps.start).toEqual({ date: DAY, time: steps.expected });
        expect(steps.line).toEqual([`${INFO}: ${tr('modal.newTask.toHead', { note: NOTE_FILE, heading: 'Work' })}`]);
        // A note there is said nothing of under its field.
        expect(steps.under).toEqual([]);
        const lines = readTestFile(NOTE_FILE).split('\n');
        const at = lines.findIndex(l => l.includes('選んだノートへ'));
        expect(lines[at - 1]).toBe('## Work');
        expect(lines.slice(at + 1)).toContain('## Other');
        expect(lines[0]).toBe('# 見出し');
    });

    it('in a note not there, by its name alone, under a heading: the note made empty with the heading, warned of', () => {
        const steps = run<{ opened: Opened; line: string[]; under: string[]; level: number }>(`
            await fromAllDay(${JSON.stringify(DAY)}, ${JSON.stringify(tr('menu.createTaskInNote'))});
            const opened = await opening();
            await retyped(noteInput(), ${JSON.stringify(NEW_NAME)});
            const line = await retyped(headingInput(), 'Plan');
            const under = says(noteInput());
            await createNamed('新しいノートへ');
            await until(() => app.vault.getAbstractFileByPath(${JSON.stringify(newPath)}));
            return JSON.stringify({ opened, line, under, level: plugin.settings.taskHeadingLevel });
        `);
        expect(steps.opened).toEqual(opened());
        expect(steps.line).toEqual([`${WARNING}: ${tr('modal.newTask.toNewNote', { note: newPath!, heading: 'Plan' })}`]);
        expect(steps.under).toEqual([`${WARNING}: ${tr('modal.newTask.noteNew')}`]);
        const lines = readTestFile(newPath!).split('\n');
        expect(lines[0]).toBe(`${'#'.repeat(steps.level)} Plan`);
        expect(lines[1]).toContain('新しいノートへ');
    });

    it('in a note there, the heading field emptied: at the note\'s end', async () => {
        await writeIndexedTestFile(NOTE_FILE, NOTE);
        const line = run<string[]>(`
            await fromAllDay(${JSON.stringify(DAY)}, ${JSON.stringify(tr('menu.createTaskInNote'))});
            await opening();
            await retyped(noteInput(), ${JSON.stringify(NOTE_NAME)});
            const line = await retyped(headingInput(), '');
            await createNamed('末尾へ');
            return JSON.stringify(line);
        `);
        expect(line).toEqual([`${INFO}: ${tr('modal.newTask.toNoteEnd', { note: NOTE_FILE })}`]);
        const text = readTestFile(NOTE_FILE);
        expect(text.startsWith(NOTE)).toBe(true);
        const added = text.slice(NOTE.length).split('\n').filter(l => l !== '');
        expect(added[0]).toContain('末尾へ');
    });

    it('closed with nothing given: it asks nothing, and nothing is written', async () => {
        await writeIndexedTestFile(NOTE_FILE, NOTE);
        const closed = run<boolean>(`
            await fromAllDay(${JSON.stringify(DAY)}, ${JSON.stringify(tr('menu.createTaskInNote'))});
            await opening();
            draft().closest('.tv-overlay').querySelector('.tv-overlay__close').click();
            await until(() => !draft());
            return JSON.stringify(!draft());
        `);
        expect(closed).toBe(true);
        expect(readTestFile(NOTE_FILE)).toBe(NOTE);
    });
});
