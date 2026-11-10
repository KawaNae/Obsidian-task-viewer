/**
 * The section dialog of Timeline's and Calendar's sidebar, in the running
 * Dev vault, driven as the user drives it: opened from the add button's
 * menu to add a markdown frame, and from a frame's ⋯ menu, or the card of
 * a frame whose note or section is not there, to choose its section again. The fields are typed
 * in as a person types (the text, then its `input` event), the items of
 * their lists clicked, or chosen with the arrow keys and Enter.
 *
 * What a choice wrote is read from the view's state (`sidebar`,
 * `sidebarCollapsed`), and what the frame shows from its DOM. The notes
 * are the test's own, under `SyncIgnore/`, written through the vault.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/markdown-frames-dialog.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { isObsidianRunning } from '../helpers/cli-helper';
import { deleteNotesUnder, frameLinks, framesOf, notesUnder, readFrames, type Reading } from '../helpers/markdown-frames';
import { closeViews, ev, openView, restartView, tr } from '../helpers/view-helper';

/** Every note of the test is under this: nothing else is written to or deleted. */
const PREFIX = 'SyncIgnore/test-int-mdsection';
const NOTES = notesUnder(PREFIX);

/**
 * A note whose headings the dialog offers. Each heading is followed by a
 * line that names it (`s01`…), so a frame's body tells which section it
 * shows. Two headings are named `Tasks`, under `Plan` and under `Log`; the
 * second `Plan`, and the `Tasks` under it, share their names with earlier
 * headings under headings of the same names, so no link names them.
 */
const SECTIONS = [
    's00',
    '',
    '# Plan',
    's01',
    '## Tasks',
    's02',
    '# Log',
    's03',
    '## Tasks',
    's04',
    '### Detail',
    's05',
    '# Plan',
    's06',
    '## Tasks',
    's07',
    '# C# and a|b',
    's08',
    '',
].join('\n');

/** The note a frame is chosen again to show. */
const OTHER = ['o00', '', '# Other', 'o01', ''].join('\n');

/** What the dialog shows. */
interface DialogState {
    open: boolean;
    title: string | null;
    note: string | null;
    heading: string | null;
    /** What is said under each field, the errors apart. */
    noteSays: string | null;
    noteErrors: string | null;
    headingSays: string | null;
    headingErrors: string | null;
    canChoose: boolean;
}

/** An item of the heading field's list. */
interface Choice {
    title: string;
    /** The line under its title. */
    note: string;
    /** Its level (`H2`); empty for the whole note. */
    flair: string;
    /** How deep it is indented; null when it is not. */
    depth: string | null;
    shut: boolean;
}

/**
 * What a snippet on the dialog has, besides the frames' names of the view
 * `name`: the dialog as it is drawn, its fields and their lists.
 */
function dialogOf(name: string): string {
    return `
        ${framesOf(PREFIX, name)}
        const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await wait(50); } return false; };
        const panel = () => document.querySelector('.tv-overlay:not(.is-closing) .tv-overlay__panel.tv-section');
        const inputs = () => [...(panel()?.querySelectorAll('input') ?? [])];
        const saidUnder = (input, errors) => {
            const el = input?.closest('.tv-form__row')?.nextElementSibling;
            return el ? [...el.children].filter(c => c.classList.contains('tv-form__error') === errors).map(c => c.textContent).join(' ') || null : null;
        };
        const cta = () => panel()?.querySelector('.tv-form__buttons .mod-cta') ?? null;
        const state = () => ({
            open: !!panel(),
            title: panel()?.querySelector('.tv-form__title')?.textContent ?? null,
            note: inputs()[0]?.value ?? null,
            heading: inputs()[1]?.value ?? null,
            noteSays: saidUnder(inputs()[0], false),
            noteErrors: saidUnder(inputs()[0], true),
            headingSays: saidUnder(inputs()[1], false),
            headingErrors: saidUnder(inputs()[1], true),
            canChoose: !!cta() && !cta().disabled,
        });
        const typeIn = (input, text) => {
            input.focus();
            input.value = text;
            input.setSelectionRange(text.length, text.length);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const pressKey = (el, k, code) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, keyCode: code, bubbles: true, cancelable: true }));
        const items = () => [...document.querySelectorAll('.suggestion-container .suggestion-item')];
        const choiceItems = () => items().filter(el => el.classList.contains('tv-section-choice'));
        const choiceOf = (el) => ({
            title: el.querySelector('.suggestion-title')?.textContent ?? '',
            note: el.querySelector('.suggestion-note')?.textContent ?? '',
            flair: el.querySelector('.suggestion-flair')?.textContent ?? '',
            depth: el.style.getPropertyValue('--tv-section-depth') || null,
            shut: el.classList.contains('tv-section-choice--shut'),
        });
        /** Open the dialog from the add button's menu. */
        const openAdd = async () => {
            el.querySelector('.tv-sidebar__panel-add-btn').click();
            await wait(100);
            menuItem(it => it.titleEl?.textContent === ${JSON.stringify(tr('sidebar.addSection'))});
            if (!(await until(() => panel()))) throw new Error('no section dialog');
        };
        /** Type \`text\` into the note field and click the note of the list titled \`title\`; wait until the note is answered. */
        const pickNote = async (text, title) => {
            typeIn(inputs()[0], text);
            const item = () => items().find(e => !e.classList.contains('tv-section-choice') && e.querySelector('.suggestion-title')?.textContent === title);
            if (!(await until(() => item()))) throw new Error('no note ' + title + ' in the list of ' + text);
            item().click();
            if (!(await until(() => state().noteSays && !document.querySelector('.suggestion-container')))) throw new Error('the note is not answered');
        };
        /** Open the heading field's list on \`text\`. */
        const openHeadings = async (text = '') => {
            typeIn(inputs()[1], text);
            if (!(await until(() => choiceItems().length > 0))) throw new Error('no list of headings');
        };
        /** Click the item of the heading field's list that is the \`nth\` titled \`title\`. */
        const pickChoice = async (title, nth = 0) => {
            const item = choiceItems().filter(e => choiceOf(e).title === title)[nth];
            if (!item) throw new Error('no heading ' + title + ' among ' + choiceItems().map(e => choiceOf(e).title).join('|'));
            item.click();
            await wait(100);
        };
        /** Press the button that chooses, once it can, and wait until the dialog is gone. */
        const choose = async () => {
            if (!(await until(() => state().canChoose))) throw new Error('nothing can be chosen: ' + JSON.stringify(state()));
            cta().click();
            if (!(await until(() => !panel()))) throw new Error('the dialog stays open');
        };
    `;
}

/** Run `body` (statements, ending in a `return`) on the dialog of the view `name`. */
function onDialog<T>(name: string, body: string): T {
    return ev<T>(`(async () => {
        ${dialogOf(name)}
        ${body}
    })()`);
}

/** Close the dialog and its lists if they are open, and wait until they have left the DOM. */
function closeDialog(name: string): void {
    onDialog(name, `
        closeMenus();
        document.querySelectorAll('.tv-overlay__panel.tv-section .tv-overlay__close').forEach(b => b.click());
        await until(() => !document.querySelector('.tv-overlay .tv-section') && !document.querySelector('.suggestion-container'));
        document.querySelectorAll('.suggestion-container').forEach(e => e.remove());
        return JSON.stringify(true);
    `);
}

/** The ids of the frames the state of `r` holds, in its order. */
function ids(r: Reading): string[] {
    return r.sidebar.map(f => f.id);
}

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    // The arrow keys of a list need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    deleteNotesUnder(PREFIX);
});

afterAll(async () => {
    await closeViews();
    deleteNotesUnder(PREFIX);
});

describe.each([
    ['Timeline', 'timeline-view', 'tl'],
    ['Calendar', 'calendar-view', 'cal'],
])("%s's section dialog", (_label, type, key) => {
    const name = `mfd-${key}`;
    const NOTE = `${PREFIX}-${key}`;
    const SHORT = NOTE.slice(NOTE.lastIndexOf('/') + 1);
    const OTHER_NOTE = `${PREFIX}-other-${key}`;
    const OTHER_SHORT = OTHER_NOTE.slice(OTHER_NOTE.lastIndexOf('/') + 1);
    const GONE = `${PREFIX}-none-${key}`;
    /** A note that links to a note there is not. */
    const LINKER = `${PREFIX}-linker-${key}`;
    const GHOST = `${SHORT}-ghost`;
    /** A note whose name has a `#`: a link to it is cut there. */
    const HASHED = `${PREFIX}-hash-${key}#note`;
    const HASHED_SHORT = HASHED.slice(HASHED.lastIndexOf('/') + 1);
    const LIST = {
        id: 'list',
        name: 'Tasks',
        filterState: { logic: 'and', filters: [{ property: 'parent', operator: 'isNotSet' }] },
        applyViewFilter: false,
    };
    const write = (path: string, text: string) => `await writeNote(${JSON.stringify(`${path}.md`)}, ${JSON.stringify(text)});`;
    const op = (body: string) => readFrames(PREFIX, name, body);
    /** The frame the state of `r` holds that is not among `before`. */
    const added = (r: Reading, before: string[]) => {
        const fresh = r.sidebar.filter(f => !before.includes(f.id));
        expect(fresh).toHaveLength(1);
        return fresh[0];
    };

    beforeAll(() => {
        ev(`(async () => {
            ${NOTES}
            ${write(NOTE, SECTIONS)}
            ${write(OTHER_NOTE, OTHER)}
            ${write(LINKER, `[[${GHOST}]]\n`)}
            ${write(HASHED, '# A\nh01\n')}
            for (let i = 0; i < 40 && !app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(`${NOTE}.md`)}))?.headings; i++) await new Promise(r => setTimeout(r, 100));
            for (let i = 0; i < 40 && !app.metadataCache.unresolvedLinks[${JSON.stringify(`${LINKER}.md`)}]?.[${JSON.stringify(GHOST)}]; i++) await new Promise(r => setTimeout(r, 100));
            return JSON.stringify(true);
        })()`);
        openView(name, type, { showSidebar: true, sidebar: [LIST] });
    });

    afterEach(() => closeDialog(name));

    it('opens to add a section, empty, the button that adds off until a note is named', () => {
        const s = onDialog<DialogState>(name, `
            await openAdd();
            await wait(200);
            return JSON.stringify(state());
        `);
        expect(s).toMatchObject({ open: true, title: tr('modal.section.addTitle'), note: '', heading: '', canChoose: false, noteErrors: null });
    });

    it('offers the whole note first, then the note\'s headings, each indented under those above it, and fades those no link names', () => {
        const choices = onDialog<Choice[]>(name, `
            await openAdd();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            await openHeadings();
            return JSON.stringify(choiceItems().map(choiceOf));
        `);
        expect(choices.map(c => [c.title, c.flair, c.depth, c.shut])).toEqual([
            [tr('modal.section.wholeNote'), '', null, false],
            ['Plan', 'H1', '0', false],
            ['Tasks', 'H2', '1', false],
            ['Log', 'H1', '0', false],
            ['Tasks', 'H2', '1', false],
            ['Detail', 'H3', '2', false],
            ['Plan', 'H1', '0', true],
            ['Tasks', 'H2', '1', true],
            ['C# and a|b', 'H1', '0', false],
        ]);
        expect(choices[6].note).toBe(tr('modal.section.unlinkableShort'));
    });

    it('adds the section of the heading picked at the end of the stack, its link naming the heading, its body drawn', () => {
        const before = ids(op(''));
        const s = onDialog<DialogState>(name, `
            await openAdd();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            await openHeadings();
            await pickChoice('Log');
            const s = state();
            await choose();
            return JSON.stringify(s);
        `);
        expect(s.noteSays).toBe(tr('modal.section.note', { note: `${NOTE}.md` }));
        expect(s.heading).toBe('Log');
        expect(s.headingSays).toBe(tr('modal.section.headingShown', { heading: 'Log' }));

        const r = op('');
        const frame = added(r, before);
        expect(frame).toMatchObject({ kind: 'markdown', link: `${NOTE}#Log` });
        expect(ids(r)).toEqual([...before, frame.id]);
        expect(r.order).toEqual([...before, frame.id]);
        expect(r.frames[frame.id].name).toBe('Log');
        expect(r.frames[frame.id].text).toBe('s03 Tasks s04 Detail s05');
    });

    it('names a heading by the headings above it when an earlier one has its name, and draws that one\'s section', () => {
        const before = ids(op(''));
        const s = onDialog<DialogState>(name, `
            await openAdd();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            await openHeadings();
            await pickChoice('Tasks', 1);
            const s = state();
            await choose();
            return JSON.stringify(s);
        `);
        expect(s.headingSays).toBe(tr('modal.section.headingShown', { heading: 'Log › Tasks' }));
        const r = op('');
        const frame = added(r, before);
        expect(frame.link).toBe(`${NOTE}#Log#Tasks`);
        expect(r.frames[frame.id].name).toBe('Tasks');
        expect(r.frames[frame.id].text).toBe('s04 Detail s05');
    });

    it('adds the whole note with the heading field left empty, and with the whole note picked from its list', () => {
        let before = ids(op(''));
        onDialog(name, `
            await openAdd();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            await until(() => state().headingSays);
            if (state().headingSays !== ${JSON.stringify(tr('modal.section.wholeNoteShown'))}) throw new Error('said ' + state().headingSays);
            await choose();
            return JSON.stringify(true);
        `);
        let r = op('');
        let frame = added(r, before);
        expect(frame.link).toBe(NOTE);
        expect(r.frames[frame.id].name).toBe(SHORT);
        expect(r.frames[frame.id].text).toMatch(/^s00 Plan s01 .* s08$/);

        before = ids(r);
        onDialog(name, `
            await openAdd();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            await openHeadings('Lo');
            typeIn(inputs()[1], '');
            await until(() => choiceItems().length > 1);
            await pickChoice(${JSON.stringify(tr('modal.section.wholeNote'))});
            if (inputs()[1].value !== '') throw new Error('the field holds ' + inputs()[1].value);
            await choose();
            return JSON.stringify(true);
        `);
        r = op('');
        frame = added(r, before);
        expect(frame.link).toBe(NOTE);
    });

    it('adds a heading whose text holds # and |, which the link writes without them, and draws its section', () => {
        const before = ids(op(''));
        onDialog(name, `
            await openAdd();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            await openHeadings('C#');
            await pickChoice('C# and a|b');
            await choose();
            return JSON.stringify(true);
        `);
        const r = op('');
        const frame = added(r, before);
        // A `#` would cut the heading, a `|` the link: the link holds neither in the heading's name.
        expect(frame.link!.startsWith(`${NOTE}#`)).toBe(true);
        expect(frame.link!.slice(NOTE.length + 1)).not.toMatch(/[#|]/);
        expect(r.frames[frame.id].name).toBe('C# and a|b');
        expect(r.frames[frame.id].text).toBe('s08');
    });

    it('picks nothing on a click of a heading no link names: the list stays open and the field as it was', () => {
        const r = onDialog<{ before: DialogState; after: DialogState; listed: boolean }>(name, `
            await openAdd();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            await openHeadings();
            const before = state();
            const shut = choiceItems().find(e => choiceOf(e).shut);
            shut.click();
            await wait(200);
            return JSON.stringify({ before, after: state(), listed: choiceItems().length > 0 });
        `);
        expect(r.listed).toBe(true);
        expect(r.after.heading).toBe('');
        expect(r.after).toEqual(r.before);
    });

    it('says under the field that a note or a heading typed is not there, and adds nothing meanwhile', () => {
        const r = onDialog<{ note: DialogState; heading: DialogState }>(name, `
            await openAdd();
            typeIn(inputs()[0], ${JSON.stringify(GONE)});
            await until(() => state().noteErrors);
            const note = state();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            typeIn(inputs()[1], 'Nowhere');
            await until(() => state().headingErrors);
            const heading = state();
            cta().click();
            await wait(200);
            return JSON.stringify({ note, heading });
        `);
        expect(r.note.noteErrors).toBe(tr('modal.section.noteMissing', { name: GONE }));
        expect(r.note.canChoose).toBe(false);
        expect(r.heading.noteErrors).toBeNull();
        expect(r.heading.headingErrors).toBe(tr('modal.section.noHeading', { note: `${NOTE}.md`, heading: 'Nowhere' }));
        expect(r.heading.canChoose).toBe(false);
        // The button is off: its click chose nothing, and the dialog stays.
        expect(onDialog<boolean>(name, `return JSON.stringify(!!panel());`)).toBe(true);
    });

    it('says under the note field that a note whose name has a # cannot be linked, and adds nothing', () => {
        const before = op('');
        const s = onDialog<DialogState>(name, `
            await openAdd();
            typeIn(inputs()[0], ${JSON.stringify(HASHED_SHORT)});
            const item = () => items().find(e => e.querySelector('.suggestion-title')?.textContent === ${JSON.stringify(HASHED_SHORT)});
            if (!(await until(() => item()))) throw new Error('the note is not offered');
            item().click();
            if (!(await until(() => state().noteErrors))) throw new Error('nothing is said of the note');
            await wait(200);
            const s = state();
            cta().click();
            await wait(200);
            return JSON.stringify(s);
        `);
        expect(s.noteErrors).toBe(tr('modal.section.noteUnlinkableHash', { note: `${HASHED}.md` }));
        expect(s.noteSays).toBeNull();
        expect(s.canChoose).toBe(false);
        // The button is off: its click chose nothing, and the dialog stays.
        expect(onDialog<boolean>(name, `return JSON.stringify(!!panel());`)).toBe(true);
        expect(op('').sidebar).toEqual(before.sidebar);
    });

    it('closes the heading field\'s list alone on Escape, the dialog left open', () => {
        const r = onDialog<{ listed: boolean; closed: boolean; open: boolean; focused: boolean }>(name, `
            await openAdd();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            await openHeadings();
            const listed = choiceItems().length > 0;
            pressKey(inputs()[1], 'Escape', 27);
            await wait(300);
            return JSON.stringify({ listed, closed: !document.querySelector('.suggestion-container'), open: !!panel(), focused: document.activeElement === inputs()[1] });
        `);
        expect(r).toEqual({ listed: true, closed: true, open: true, focused: true });
    });

    it('closes a dialog left open when its view is closed', () => {
        const other = `${name}-closed`;
        openView(other, type, { showSidebar: true, sidebar: [LIST] });
        const r = onDialog<{ opened: boolean; closed: boolean }>(other, `
            await openAdd();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            const opened = !!panel();
            R[${JSON.stringify(other)}].detach();
            delete R[${JSON.stringify(other)}];
            const closed = await until(() => !document.querySelector('.tv-overlay .tv-section'));
            return JSON.stringify({ opened, closed });
        `);
        expect(r).toEqual({ opened: true, closed: true });
    });

    it('offers in the note field the notes there are, and no note an unresolved link names', () => {
        const titles = onDialog<string[]>(name, `
            await openAdd();
            typeIn(inputs()[0], ${JSON.stringify(SHORT)});
            await until(() => items().length > 0);
            await wait(300);
            return JSON.stringify(items().map(e => e.querySelector('.suggestion-title')?.textContent ?? e.textContent));
        `);
        expect(titles).toContain(SHORT);
        expect(titles).not.toContain(GHOST);
        // What the test rests on: the vault has the link unresolved.
        expect(ev<boolean>(`(() => JSON.stringify(!!app.metadataCache.unresolvedLinks[${JSON.stringify(`${LINKER}.md`)}]?.[${JSON.stringify(GHOST)}]))()`)).toBe(true);
    });

    it('adds nothing on Cancel, nor on Escape', () => {
        const before = op('');
        const r = onDialog<{ cancelled: boolean; escaped: boolean }>(name, `
            await openAdd();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            await until(() => state().canChoose);
            panel().querySelector('.tv-form__cancel').click();
            const cancelled = await until(() => !panel());

            await openAdd();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            await until(() => state().canChoose);
            pressKey(inputs()[0], 'Escape', 27);
            const escaped = await until(() => !panel());
            return JSON.stringify({ cancelled, escaped });
        `);
        expect(r).toEqual({ cancelled: true, escaped: true });
        const after = op('');
        expect(after.sidebar).toEqual(before.sidebar);
    });

    it('picks the note and the heading with the arrow keys and Enter, and adds on Enter once the list is closed', () => {
        const before = ids(op(''));
        const s = onDialog<{ picked: DialogState; selected: string | null }>(name, `
            await openAdd();
            typeIn(inputs()[0], ${JSON.stringify(SHORT)});
            const first = () => items()[0]?.querySelector('.suggestion-title')?.textContent;
            if (!(await until(() => first() === ${JSON.stringify(SHORT)}))) throw new Error('the note is not first: ' + first());
            pressKey(inputs()[0], 'Enter', 13);
            if (!(await until(() => state().noteSays))) throw new Error('the note is not answered');
            await openHeadings();
            // From the whole note, two down: Plan, then the Tasks under it.
            pressKey(inputs()[1], 'ArrowDown', 40);
            pressKey(inputs()[1], 'ArrowDown', 40);
            await wait(100);
            const sel = document.querySelector('.suggestion-container .suggestion-item.is-selected');
            const selected = sel ? choiceOf(sel).title + ' ' + choiceOf(sel).flair : null;
            pressKey(inputs()[1], 'Enter', 13);
            await until(() => !document.querySelector('.suggestion-container'));
            const picked = state();
            await until(() => state().canChoose);
            pressKey(inputs()[1], 'Enter', 13);
            if (!(await until(() => !panel()))) throw new Error('Enter added nothing');
            return JSON.stringify({ picked, selected });
        `);
        expect(s.selected).toBe('Tasks H2');
        expect(s.picked.note).toBe(SHORT);
        expect(s.picked.heading).toBe('Tasks');
        expect(s.picked.headingSays).toBe(tr('modal.section.headingShown', { heading: 'Plan › Tasks' }));
        const r = op('');
        const frame = added(r, before);
        expect(frame.link).toBe(`${NOTE}#Tasks`);
        expect(r.frames[frame.id].text).toBe('s02');
    });

    it('keeps the frames added once the view is opened again from its saved state', () => {
        // A frame of its own, so the view opened again has one to keep whatever ran before.
        onDialog(name, `
            await openAdd();
            await pickNote(${JSON.stringify(SHORT)}, ${JSON.stringify(SHORT)});
            await choose();
            return JSON.stringify(true);
        `);
        const r = op('');
        expect(r.sidebar.filter(one => one.kind === 'markdown').length).toBeGreaterThan(0);
        const restarted = `${name}-2`;
        restartView(name, restarted);
        const again = readFrames(PREFIX, restarted, '');
        expect(again.sidebar).toEqual(r.sidebar);
        for (const f of r.sidebar.filter(one => one.kind === 'markdown')) {
            expect(again.frames[f.id].text).toBe(r.frames[f.id].text);
        }
        ev(`(async () => { const R = window.__tvE2E; R[${JSON.stringify(restarted)}].detach(); delete R[${JSON.stringify(restarted)}]; return JSON.stringify(true); })()`);
    });

    describe('a note moved to a name with a #', () => {
        const MOVED = `${PREFIX}-moved-${key}`;
        /** A note at the part of the new name before its `#`, with the heading after it. */
        const DECOY = `${PREFIX}-decoy-${key}`;

        beforeAll(() => {
            ev(`(async () => {
                ${NOTES}
                ${write(MOVED, 'm00\n')}
                ${write(DECOY, '# x\nd01\n')}
                return JSON.stringify(true);
            })()`);
            openView(name, type, { showSidebar: true, sidebar: [{ kind: 'markdown', id: 'moved', link: MOVED }] });
        });

        it('keeps its frame\'s link, and the frame shows no other note: it says the note is not there', () => {
            expect(op('').frames.moved.text).toBe('m00');
            const r = op(`await renameNote(${JSON.stringify(`${MOVED}.md`)}, ${JSON.stringify(`${DECOY}#x.md`)});`);
            // What the test rests on: the note is at the new name.
            expect(ev<boolean>(`(() => JSON.stringify(!!app.vault.getAbstractFileByPath(${JSON.stringify(`${DECOY}#x.md`)})))()`)).toBe(true);
            expect(frameLinks(r)).toEqual({ moved: MOVED });
            expect(r.frames.moved.missing).toBe(tr('sidebar.noteNotFound'));
            expect(r.frames.moved.text).toBeNull();
        });
    });

    describe('choosing a frame\'s section again', () => {
        /** The frames this part works on: one whose heading is renamed, one folded, one whose note is not there. */
        const FRAMES = [
            { kind: 'markdown', id: 'renamed', link: `${NOTE}#Log#Tasks#Detail` },
            { kind: 'markdown', id: 'folded', link: `${NOTE}#Log` },
            { kind: 'markdown', id: 'gone', link: `${GONE}#Plan` },
        ];
        const relinkOf = (id: string) => `frame(${JSON.stringify(id)}).querySelector('.markdown-frame__missing-relink').click();
            if (!(await until(() => panel()))) throw new Error('no section dialog');`;
        /** Open the dialog from the ⋯ menu of the frame `id`, as the user does: its item picked from the menu Obsidian holds. */
        const relinkFromMenu = (id: string) => `await openMenu(${JSON.stringify(id)});
            menuItem(it => it.titleEl?.textContent === ${JSON.stringify(tr('sidebar.relinkSection'))});
            if (!(await until(() => panel()))) throw new Error('no section dialog');`;

        beforeAll(() => {
            openView(name, type, { showSidebar: true, sidebar: [LIST, ...FRAMES], sidebarCollapsed: { folded: true } });
        });

        it('opens from the card of a frame whose heading is not there on the note the frame found, and writes only that frame\'s link', () => {
            let r = op(write(NOTE, SECTIONS.replace('### Detail', '### Details')));
            expect(r.frames.renamed.missing).toBe(tr('sidebar.sectionNotFound'));
            const before = r;

            const s = onDialog<DialogState>(name, `
                ${relinkOf('renamed')}
                await until(() => state().noteSays);
                const s = state();
                await openHeadings('Details');
                await pickChoice('Details');
                await choose();
                return JSON.stringify(s);
            `);
            expect(s.title).toBe(tr('modal.section.relinkTitle'));
            expect(s.note).toBe(SHORT);
            expect(s.noteSays).toBe(tr('modal.section.note', { note: `${NOTE}.md` }));

            r = op('');
            expect(ids(r)).toEqual(ids(before));
            expect(r.order).toEqual(before.order);
            expect(frameLinks(r)).toEqual({ ...frameLinks(before), renamed: `${NOTE}#Details` });
            expect(r.collapsed).toEqual(before.collapsed);
            expect(r.frames.renamed.missing).toBeNull();
            expect(r.frames.renamed.name).toBe('Details');
            expect(r.frames.renamed.text).toBe('s05');
        });

        it('chooses again from its ⋯ menu the section of a folded frame not found, which stays folded', () => {
            // The card, which holds the button, is hidden while the frame is folded: the ⋯ menu of its row is there.
            let r = op(write(NOTE, SECTIONS.replace('### Detail', '### Details').replace('# Log', '# Journal')));
            expect(r.frames.folded.collapsed).toBe(true);
            expect(r.frames.folded.missing).toBe(tr('sidebar.sectionNotFound'));
            const before = r;

            onDialog(name, `
                ${relinkFromMenu('folded')}
                await until(() => state().noteSays);
                await openHeadings('Journal');
                await pickChoice('Journal');
                await choose();
                return JSON.stringify(true);
            `);
            r = op('');
            expect(frameLinks(r)).toEqual({ ...frameLinks(before), folded: `${NOTE}#Journal` });
            expect(ids(r)).toEqual(ids(before));
            expect(r.collapsed.folded).toBe(true);
            expect(r.frames.folded.collapsed).toBe(true);
            expect(r.frames.folded.missing).toBeNull();
            expect(r.frames.folded.name).toBe('Journal');

            r = op(`frame('folded').querySelector('.' + C.header).click();`);
            expect(r.frames.folded.text).toBe('s03 Tasks s04 Details s05');
        });

        it('opens from the card of a frame whose note is not there on the note its link names, and has it show another note', () => {
            const before = op('');
            expect(before.frames.gone.missing).toBe(tr('sidebar.noteNotFound'));

            const s = onDialog<DialogState>(name, `
                ${relinkOf('gone')}
                await until(() => state().noteErrors);
                const s = state();
                await pickNote(${JSON.stringify(OTHER_SHORT)}, ${JSON.stringify(OTHER_SHORT)});
                typeIn(inputs()[1], '');
                await choose();
                return JSON.stringify(s);
            `);
            expect(s.note).toBe(GONE);
            expect(s.noteErrors).toBe(tr('modal.section.noteMissing', { name: GONE }));
            expect(s.canChoose).toBe(false);

            const r = op('');
            expect(ids(r)).toEqual(ids(before));
            expect(frameLinks(r)).toEqual({ ...frameLinks(before), gone: OTHER_NOTE });
            expect(r.frames.gone.missing).toBeNull();
            expect(r.frames.gone.name).toBe(OTHER_SHORT);
            expect(r.frames.gone.text).toBe('o00 Other o01');
        });

        it('chooses again from its ⋯ menu the section of a frame that is found: only its link is written, its id, place and fold kept', () => {
            const before = op('');
            expect(before.frames.renamed.missing).toBeNull();
            expect(before.frames.renamed.name).toBe('Details');

            const s = onDialog<DialogState>(name, `
                ${relinkFromMenu('renamed')}
                await until(() => state().noteSays);
                const s = state();
                await openHeadings('Plan');
                await pickChoice('Plan');
                await choose();
                return JSON.stringify(s);
            `);
            expect(s.title).toBe(tr('modal.section.relinkTitle'));
            expect(s.note).toBe(SHORT);

            const r = op('');
            expect(ids(r)).toEqual(ids(before));
            expect(r.order).toEqual(before.order);
            expect(r.collapsed).toEqual(before.collapsed);
            expect(frameLinks(r)).toEqual({ ...frameLinks(before), renamed: `${NOTE}#Plan` });
            expect(r.frames.renamed.name).toBe('Plan');
            expect(r.frames.renamed.text).toBe('s01 Tasks s02');
        });
    });
});
