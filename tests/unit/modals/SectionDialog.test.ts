import { describe, it, expect } from 'vitest';
import { t } from '../../../src/i18n';
import {
    SectionDialog, chosenSection, emptySectionAsk, headingTrail, offeredChoices, readSectionNote, sectionAskOf, sectionChoices, sectionLink,
    type HeadingAsk, type SectionHost, type SectionNote, type SectionViewState,
} from '../../../src/modals/section/SectionDialog';
import { frameHeadings, frameTarget, readFrameContent } from '../../../src/services/data/MarkdownFrames';
import { resolveHeading } from '../../../src/services/parsing/utils/HeadingLinks';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { makeFile } from '../helpers/vaultSession';

/**
 * The section dialog as logic (`SectionDialog`), apart from the DOM: which
 * section the fields name in a note and the link that names it, what the
 * heading field offers, and what the dialog says and lets be chosen. The
 * headings are read off a note's lines as a frame reads them, so a link
 * made here is checked by reading it back as a frame does.
 */

const NOTE = [
    '# Plan',
    'top',
    '## Tasks',
    'plan tasks',
    '# Log',
    '## Tasks',
    'log tasks',
    '# Plan',
    'again',
    '## Tasks',
    'third',
    '# C# and a|b',
    'marks',
];
const PATH = 'Folder/Note.md';
const headings = frameHeadings(NOTE);
const text = (s: string, picked: HeadingAsk['picked'] = null): HeadingAsk => ({ text: s, picked });
/** The heading on line `line`, picked in the note at `path`. */
const pickedAt = (line: number, path = PATH): HeadingAsk => ({ text: NOTE[line].replace(/^#+ /, ''), picked: { path, line } });

/** The heading the link of `ask`'s section is read back as, by the walk a frame reads its link with, and the body the frame shows. */
function readBack(ask: HeadingAsk) {
    const link = sectionLink(PATH, chosenSection(PATH, headings, ask));
    if (link === null) return null;
    const { path, subpath } = frameTarget(link);
    const content = readFrameContent(NOTE, subpath, DEFAULT_SETTINGS);
    return {
        link,
        path,
        line: resolveHeading(headings.map(h => h.heading), subpath)?.heading.line ?? null,
        body: content.kind === 'no-heading' ? null : content.markdown,
    };
}

describe('the section the fields name, and its link', () => {
    it('names a heading by its text alone when that names it, and is read back as that heading', () => {
        expect(readBack(pickedAt(4))).toEqual({ link: 'Folder/Note#Log', path: 'Folder/Note', line: 4, body: '## Tasks\nlog tasks' });
        expect(readBack(pickedAt(0))).toMatchObject({ link: 'Folder/Note#Plan', line: 0 });
    });

    it('names a heading by the headings above it when its text alone names an earlier one', () => {
        expect(readBack(pickedAt(5))).toEqual({ link: 'Folder/Note#Log#Tasks', path: 'Folder/Note', line: 5, body: 'log tasks' });
        expect(readBack(pickedAt(2))).toMatchObject({ link: 'Folder/Note#Tasks', line: 2, body: 'plan tasks' });
    });

    it('names no heading that shares its name and the names above it with an earlier one', () => {
        expect(chosenSection(PATH, headings, pickedAt(7))).toEqual({ kind: 'unlinkable', heading: headings[4].heading });
        expect(chosenSection(PATH, headings, pickedAt(9))).toEqual({ kind: 'unlinkable', heading: headings[5].heading });
        expect(readBack(pickedAt(9))).toBeNull();
    });

    it('names the whole note when the heading field is empty', () => {
        expect(chosenSection(PATH, headings, text('  '))).toEqual({ kind: 'note' });
        expect(readBack(text(''))).toMatchObject({ link: 'Folder/Note', line: null, body: NOTE.join('\n') });
    });

    it('writes a heading\'s `#` and `|` as a link can hold them, and is read back as that heading', () => {
        expect(readBack(pickedAt(11))).toEqual({ link: 'Folder/Note#C and a b', path: 'Folder/Note', line: 11, body: 'marks' });
    });

    it('reads a text typed as the first heading of its name, compared as a link compares names', () => {
        expect(chosenSection(PATH, headings, text('tasks'))).toMatchObject({ kind: 'heading', subpath: 'Tasks', heading: { line: 2 } });
        expect(chosenSection(PATH, headings, text('c# and a|b'))).toMatchObject({ kind: 'heading', heading: { line: 11 } });
        expect(chosenSection(PATH, headings, text('Nowhere'))).toEqual({ kind: 'no-heading', text: 'Nowhere' });
    });

    it('says a heading with the headings it stands under, so two of one text are told apart', () => {
        expect(headingTrail(headings, headings[1].heading)).toBe('Plan › Tasks');
        expect(headingTrail(headings, headings[3].heading)).toBe('Log › Tasks');
        expect(headingTrail(headings, headings[2].heading)).toBe('Log');
    });

    it('takes a pick only in the note it was picked in', () => {
        expect(chosenSection(PATH, headings, pickedAt(5))).toMatchObject({ heading: { line: 5 } });
        expect(chosenSection(PATH, headings, pickedAt(5, 'Other.md'))).toMatchObject({ heading: { line: 2 } });
    });
});

describe('what the heading field offers', () => {
    it('offers the whole note first, then each heading with the headings it stands under and its subpath', () => {
        const choices = sectionChoices(headings);
        expect(choices[0]).toEqual({ kind: 'note' });
        expect(choices.slice(1).map(c => c.kind === 'heading' && [c.heading.text, c.above, c.subpath])).toEqual([
            ['Plan', [], 'Plan'],
            ['Tasks', ['Plan'], 'Tasks'],
            ['Log', [], 'Log'],
            ['Tasks', ['Log'], 'Log#Tasks'],
            ['Plan', [], null],
            ['Tasks', ['Plan'], null],
            ['C# and a|b', [], 'C and a b'],
        ]);
    });

    it('offers, for a text typed, the headings that hold it, and the whole note only with nothing typed', () => {
        const choices = sectionChoices(headings);
        expect(offeredChoices(choices, '')).toHaveLength(choices.length);
        expect(offeredChoices(choices, 'TAS').map(c => c.kind === 'heading' && c.heading.line)).toEqual([2, 5, 9]);
    });
});

describe('the fields a dialog opens with', () => {
    it('opens empty to add a frame', () => {
        expect(emptySectionAsk()).toEqual({ note: { text: '', picked: null }, heading: { text: '', picked: null } });
    });

    it('opens on the note a frame found, picked, and the last heading its link names', () => {
        expect(sectionAskOf('Folder/Note#Log#Gone', { path: 'Folder/Note.md', basename: 'Note' })).toEqual({
            note: { text: 'Note', picked: 'Folder/Note.md' },
            heading: { text: 'Gone', picked: null },
        });
    });

    it('opens on its link\'s note as typed when the frame found none, and on the whole note for a link without a heading', () => {
        expect(sectionAskOf('Gone/Note', null)).toEqual({
            note: { text: 'Gone/Note', picked: null },
            heading: { text: '', picked: null },
        });
    });
});

describe('the note the note field names', () => {
    const vault = (files: Record<string, string>) => ({
        vault: {
            getMarkdownFiles: () => Object.keys(files).map(makeFile),
            getAllFolders: () => [],
            cachedRead: async (file: { path: string }) => files[file.path],
        },
    }) as never;

    it('is a note there is, with its headings', async () => {
        const note = await readSectionNote(vault({ 'Folder/Note.md': '# A\n## B' }), { text: 'Note', picked: null });
        expect(note).toMatchObject({ kind: 'note', path: 'Folder/Note.md' });
        expect(note.kind === 'note' && note.headings.map(h => h.subpath)).toEqual(['A', 'B']);
    });

    it('is none for an empty field, a name no note has, or one more than one note has', async () => {
        const files = vault({ 'a/Dup.md': '', 'b/Dup.md': '' });
        expect(await readSectionNote(files, { text: ' ', picked: null })).toEqual({ kind: 'empty' });
        expect(await readSectionNote(files, { text: 'Later', picked: null })).toEqual({ kind: 'missing', name: 'Later' });
        expect(await readSectionNote(files, { text: 'Dup', picked: null })).toEqual({ kind: 'ambiguous', name: 'Dup', paths: ['a/Dup.md', 'b/Dup.md'] });
        expect(await readSectionNote(files, { text: 'Dup', picked: 'b/Dup.md' })).toMatchObject({ kind: 'note', path: 'b/Dup.md' });
    });
});

describe('the section dialog', () => {
    /** A dialog whose host answers each asking of the note when the test says, with what it was handed. */
    function dialogOf(initial = emptySectionAsk()) {
        const asked: { text: string; answer: (note: SectionNote) => Promise<void> }[] = [];
        const chosen: string[] = [];
        let closed = 0;
        let shown: SectionViewState | null = null;
        const host: SectionHost = {
            note: (ask) => new Promise((resolve) => {
                asked.push({ text: ask.text, answer: async (note) => { resolve(note); await Promise.resolve(); } });
            }),
            chosen: link => chosen.push(link),
            close: () => { closed++; },
        };
        const dialog = new SectionDialog(initial, host, { render: (state) => { shown = state; } });
        return { dialog, asked, chosen, closed: () => closed, shown: () => shown! };
    }
    const found: SectionNote = { kind: 'note', path: PATH, headings };

    it('chooses nothing until the note is answered, then the section the fields name, and closes', async () => {
        const d = dialogOf();
        expect(d.shown().canChoose).toBe(false);
        d.dialog.noteChanged({ text: 'Note', picked: null });
        await d.asked[1].answer(found);
        expect(d.shown()).toMatchObject({ path: PATH, canChoose: true });
        expect(d.shown().issues).toContainEqual({ at: 'heading', tone: 'info', text: t('modal.section.wholeNoteShown') });

        d.dialog.headingChanged(pickedAt(5));
        d.dialog.choose();
        expect(d.chosen).toEqual(['Folder/Note#Log#Tasks']);
        expect(d.closed()).toBe(1);
    });

    it('takes only the answer to the last asking, and offers no choice while the field is asked again', async () => {
        const d = dialogOf();
        d.dialog.noteChanged({ text: 'Not', picked: null });
        d.dialog.noteChanged({ text: 'Note', picked: null });
        await d.asked[2].answer(found);
        await d.asked[1].answer({ kind: 'missing', name: 'Not' });
        expect(d.shown()).toMatchObject({ path: PATH, canChoose: true });

        d.dialog.noteChanged({ text: 'Notes', picked: null });
        // The headings of the note last answered stay offered meanwhile.
        expect(d.shown()).toMatchObject({ path: PATH, canChoose: false });
        d.dialog.choose();
        expect(d.chosen).toEqual([]);
    });

    it('says why nothing can be chosen, under the field it is of', async () => {
        const d = dialogOf();
        d.dialog.noteChanged({ text: 'Later', picked: null });
        await d.asked[1].answer({ kind: 'missing', name: 'Later' });
        expect(d.shown()).toMatchObject({
            choices: [],
            canChoose: false,
            issues: [{ at: 'note', tone: 'error', text: t('modal.section.noteMissing', { name: 'Later' }) }],
        });

        d.dialog.noteChanged({ text: 'Note', picked: null });
        await d.asked[2].answer(found);
        d.dialog.headingChanged(pickedAt(7));
        expect(d.shown().canChoose).toBe(false);
        expect(d.shown().issues).toContainEqual({ at: 'heading', tone: 'error', text: t('modal.section.unlinkable', { heading: 'Plan' }) });
        d.dialog.headingChanged(text('Nowhere'));
        expect(d.shown().issues).toContainEqual({ at: 'heading', tone: 'error', text: t('modal.section.noHeading', { note: PATH, heading: 'Nowhere' }) });
        d.dialog.choose();
        expect(d.chosen).toEqual([]);
    });

    it('opens on the fields it is given, and asks the note they name at once', () => {
        const d = dialogOf(sectionAskOf('Folder/Note#Gone', { path: PATH, basename: 'Note' }));
        expect(d.asked.map(a => a.text)).toEqual(['Note']);
    });
});
