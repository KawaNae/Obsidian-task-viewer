/**
 * Where the focus goes as a create on the hub of a task not written yet
 * ends unwritten, in the running E2E vault, once its fields are open again
 * and its place is read: where what keeps the task from being created is.
 *
 * - The place's fields read as the create waits, the heading named twice in
 *   the note, the details tab chosen meanwhile: the basic tab chosen again,
 *   the focus on the heading's field.
 * - A create pressed as a note is named that two notes are, in folders of
 *   their own: the basic tab, the note's field.
 * - Under a row (Add child task), the details tab chosen, the write refused
 *   and the parent's row gone before the place is asked again: the basic
 *   tab chosen, the focus on its button, the place it shows having no
 *   field.
 * - The write refused once, the place still there: the focus on the create,
 *   which is offered again.
 * - The same, the user putting the focus on the name while the place is
 *   asked again: it stays there.
 * - Written: the hub closes, and nothing in it holds the focus.
 *
 * The create is pressed with the mouse, through Electron, as a person
 * presses it, so the focus goes where the browser puts it on a press and
 * from the create as it is shut. A read is held by `holdReads` until the
 * test lets it go, the place's asking again after a refusal by
 * `CreatePlaces.facts` held so. The notes and the daily notes (of days far off, 2031-03)
 * are made by the test and deleted after.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     its daily notes at the vault's root as YYYY-MM-DD, with no template
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/hub/draft-unwritten-focus.test.ts
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

const [HEADING_DAY, NOTE_DAY, REFUSED_DAY, STAY_DAY, WRITTEN_DAY] = ['2031-03-03', '2031-03-04', '2031-03-05', '2031-03-06', '2031-03-07'];
const dailyOf = (day: string) => `${day}.md`;

const TWICE_NAME = 'test-int-unwritten-twice';
const TWICE_FILE = `${TWICE_NAME}.md`;
/** The settings' heading, twice. */
const TWICE_NOTE = [
    '## Tasks',
    '- [ ] 一つ目',
    '## Tasks',
    '- [ ] 二つ目',
    '',
].join('\n');

/** A name two notes have, in folders of their own. */
const TWO_NAME = 'test-int-unwritten-two';
const TWO_FILES = [`test-int-unwritten-a/${TWO_NAME}.md`, `test-int-unwritten-b/${TWO_NAME}.md`];
const TWO_NOTE = '- [ ] どちらか\n';

const CHILD_FILE = 'test-int-unwritten-child.md';
const CHILD_NOTE = [
    '# 見出し',
    '- [ ] 親',
    '- [ ] 隣',
    '',
].join('\n');
const CHILD_GONE = [
    '# 見出し',
    '- [ ] 隣',
    '',
].join('\n');

const DAILY_NOTE = [
    '## Tasks',
    '- [ ] 既存',
    '',
].join('\n');

const PRELUDE = `
${UNTIL}
${DIALOG_ROWS}
${MENUS}
${DRAFT_HUB}
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
/** The hub on the daily note of \`day\`, the focus on its name and its place read. */
const openDaily = async day => {
    plugin.openDraftHub(plugin.getCreatePlaces().dailyNote(day), { startDate: day });
    await until(() => nameInput() && document.activeElement === nameInput() && lineSays().length > 0);
};
/** Press \`el\` with the mouse, as a person does, through Electron. */
const press = el => {
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const contents = require('electron').remote.getCurrentWebContents();
    contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
};
/** Choose the tab \`id\` with the mouse, and wait for it to be chosen. */
const choose = async id => {
    press(tab(id));
    await until(() => tabOn() === id);
};
const creating = () => createButton().textContent === ${JSON.stringify(tr('modal.newTask.creating'))};
/** Press the create, and wait for its refusal to be said above it. */
const pressCreate = async () => {
    press(createButton());
    await until(refusedSaid, 3000, () => lineSays().join('|'));
};
const refusedSaid = () => lineSays().some(s => s.startsWith('tv-form__error'));
/** Wait for the create to have ended unwritten, the fields open again. */
const ended = () => until(() => draft() && !creating() && !nameInput().disabled, 5000, () => lineSays().join('|'));
/** What holds the focus, by what it is in the hub. */
const focused = () => {
    const at = document.activeElement;
    if (!at || at === document.body) return 'body';
    if (at === nameInput()) return 'name';
    if (at === noteInput()) return 'note';
    if (at === headingInput()) return 'heading';
    if (at === createButton()) return 'create';
    if (at === tab('basic')) return 'basic tab';
    if (at === tab('detail')) return 'detail tab';
    return draft()?.contains(at) ? 'hub: ' + at.className : 'outside: ' + at.className;
};
/** The task of \`file\` named \`name\`. */
const rowTask = (file, name) => {
    const task = plugin.getIndex().getTasks().find(t => t.file === file && t.content === name);
    if (!task) throw new Error('no row ' + name);
    return task;
};
/** The disk refusing the next write once, \`before\` run first. */
const refuseOnce = before => {
    const real = app.vault.process;
    R.unrefuse = () => { app.vault.process = real; delete R.unrefuse; };
    app.vault.process = async function (...args) {
        R.unrefuse();
        await before?.(real);
        throw new Error('e2e: the disk refused');
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

beforeAll(() => {
    // Presses and focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
});

afterEach(() => { run(`R.unrefuse?.(); await cleanUpHubs(); return 'ok';`); });

afterAll(async () => {
    for (const file of [TWICE_FILE, ...TWO_FILES, CHILD_FILE, ...[HEADING_DAY, NOTE_DAY, REFUSED_DAY, STAY_DAY, WRITTEN_DAY].map(dailyOf)]) {
        deleteTestFile(file);
        await waitForFileDeindexed(file);
    }
    run(`for (const path of ['test-int-unwritten-a', 'test-int-unwritten-b']) { const folder = app.vault.getAbstractFileByPath(path); if (folder) await app.vault.delete(folder, true); } return 'ok';`);
});

describe('a create that waited for the place\'s fields, ended unwritten', () => {
    it('by a heading named twice in the note, the details tab chosen meanwhile: the basic tab chosen, the focus on the heading\'s field', async () => {
        await writeIndexedTestFile(TWICE_FILE, TWICE_NOTE);
        const steps = run<Record<string, unknown>>(`
            await openDaily(${JSON.stringify(HEADING_DAY)});
            type(nameInput(), '見出しが二つ');
            holdReads();
            const out = {};
            try {
                typeIn(noteInput(), ${JSON.stringify(TWICE_NAME)});
                await choose('detail');
                press(createButton());
                await until(() => creating() && R.held > 0, 3000, () => createButton().textContent);
                out.waiting = { tab: tabOn(), focus: focused() };
                R.releaseReads();
                await ended();
                await until(() => focused() !== 'body', 3000, () => focused());
            } finally {
                R.unhold?.();
            }
            out.ended = { tab: tabOn(), focus: focused(), heading: headingInput().value, says: says(headingInput()).length > 0 };
            return JSON.stringify(out);
        `);
        expect(steps.waiting).toMatchObject({ tab: 'detail' });
        expect(steps.ended).toEqual({ tab: 'basic', focus: 'heading', heading: 'Tasks', says: true });
        expect(readTestFile(TWICE_FILE)).toBe(TWICE_NOTE);
    });

    it('by a note named that two notes are: the basic tab chosen, the focus on the note\'s field', async () => {
        for (const file of TWO_FILES) await writeIndexedTestFile(file, TWO_NOTE);
        const steps = run<Record<string, unknown>>(`
            await openDaily(${JSON.stringify(NOTE_DAY)});
            type(nameInput(), 'ノートが無い');
            // Pressed as soon as the name is typed, before the note's field has said what it names:
            // the focus goes to the create as a press puts it, and the press clicks it.
            typeIn(noteInput(), ${JSON.stringify(TWO_NAME)});
            const out = { offered: !createButton().disabled };
            createButton().focus();
            create();
            await ended();
            await until(() => focused() !== 'create' && focused() !== 'body', 3000, () => focused());
            out.ended = { tab: tabOn(), focus: focused(), daily: !!app.vault.getAbstractFileByPath(${JSON.stringify(dailyOf(NOTE_DAY))}) };
            return JSON.stringify(out);
        `);
        expect(steps.offered).toBe(true);
        expect(steps.ended).toEqual({ tab: 'basic', focus: 'note', daily: false });
    });
});

describe('a create whose write was refused', () => {
    it('under a row whose parent is gone before the place is asked again, the details tab chosen: the basic tab chosen, the focus on its button', async () => {
        await writeIndexedTestFile(CHILD_FILE, CHILD_NOTE);
        const steps = run<Record<string, unknown>>(`
            const parent = rowTask(${JSON.stringify(CHILD_FILE)}, '親');
            plugin.openDraftHub({ kind: 'childOf', taskId: parent.id }, {});
            await until(() => nameInput() && document.activeElement === nameInput() && lineSays().length > 0);
            type(nameInput(), '親が消える');
            await choose('detail');
            // The parent's row taken out of the note, and the index without it, before the write is refused.
            refuseOnce(async real => {
                const file = app.vault.getAbstractFileByPath(${JSON.stringify(CHILD_FILE)});
                await real.call(app.vault, file, () => ${JSON.stringify(CHILD_GONE)});
                await until(() => !plugin.getIndex().getTask(parent.id), 5000);
            });
            await pressCreate();
            await ended();
            await until(() => focused() !== 'body', 3000, () => focused());
            return JSON.stringify({ tab: tabOn(), focus: focused(), offered: !createButton().disabled, disk: await disk(${JSON.stringify(CHILD_FILE)}) });
        `);
        // The place is all the basic tab shows of what keeps the task: its button, which raises no keyboard.
        expect(steps).toEqual({ tab: 'basic', focus: 'basic tab', offered: false, disk: CHILD_GONE });
    });

    it('the place still there: the focus on the create, offered again, and a press on it writes', async () => {
        await writeIndexedTestFile(dailyOf(REFUSED_DAY), DAILY_NOTE);
        const steps = run<Record<string, unknown>>(`
            await openDaily(${JSON.stringify(REFUSED_DAY)});
            type(nameInput(), '断られる');
            refuseOnce();
            await pressCreate();
            await ended();
            await until(() => focused() !== 'body', 3000, () => focused());
            const out = { tab: tabOn(), focus: focused(), offered: !createButton().disabled, refused: lineSays().some(s => s.startsWith('tv-form__error')) };
            press(createButton());
            await until(() => !draft(), 5000, () => lineSays().join('|'));
            return JSON.stringify(out);
        `);
        expect(steps).toEqual({ tab: 'basic', focus: 'create', offered: true, refused: true });
        expect(readTestFile(dailyOf(REFUSED_DAY))).toMatch(/^## Tasks\n- \[ \] 断られる.*\n- \[ \] 既存\n$/);
    });

    it('the user on the name while the place is asked again: the focus stays on the name', async () => {
        await writeIndexedTestFile(dailyOf(STAY_DAY), DAILY_NOTE);
        const steps = run<Record<string, unknown>>(`
            await openDaily(${JSON.stringify(STAY_DAY)});
            type(nameInput(), '名前に戻る');
            // The place's asking again after the refusal held, the user going back to the name meanwhile.
            const places = plugin.getCreatePlaces();
            const real = places.facts;
            let open;
            const gate = new Promise(r => { open = r; });
            let asked = 0;
            let answered = 0;
            R.unhold = () => { places.facts = real; open(); delete R.unhold; };
            refuseOnce(async () => {
                places.facts = async function (...args) { asked++; await gate; const facts = await real.apply(this, args); answered++; return facts; };
            });
            const out = {};
            try {
                await pressCreate();
                await until(() => asked > 0 && !nameInput().disabled, 5000, () => 'asked ' + asked);
                press(nameInput());
                await until(() => focused() === 'name');
                open();
                await until(() => answered === asked);
                // The host takes the answer after the promise settles: the frames after it.
                await nextFrame();
                await nextFrame();
            } finally {
                R.unhold?.();
            }
            out.ended = { tab: tabOn(), focus: focused() };
            return JSON.stringify(out);
        `);
        expect(steps.ended).toEqual({ tab: 'basic', focus: 'name' });
    });
});

describe('a create written', () => {
    it('closes the hub, nothing in it holding the focus', async () => {
        await writeIndexedTestFile(dailyOf(WRITTEN_DAY), DAILY_NOTE);
        const steps = run<Record<string, unknown>>(`
            await openDaily(${JSON.stringify(WRITTEN_DAY)});
            type(nameInput(), '書ける');
            const hub = draft();
            press(createButton());
            await until(() => !draft(), 5000, () => lineSays().join('|'));
            await nextFrame();
            return JSON.stringify({ open: !!draft(), inHub: hub.contains(document.activeElement) });
        `);
        expect(steps).toEqual({ open: false, inHub: false });
        expect(readTestFile(dailyOf(WRITTEN_DAY))).toMatch(/^## Tasks\n- \[ \] 書ける.*\n- \[ \] 既存\n$/);
    });
});
