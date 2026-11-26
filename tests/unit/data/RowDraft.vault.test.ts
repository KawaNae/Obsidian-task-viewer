import { describe, it, expect, afterEach } from 'vitest';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { RowDraft, type DraftMark } from '../../../src/services/data/RowDraft';
import { TaskUpdateBuilder } from '../../../src/modals/form/TaskUpdateBuilder';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';
import { SubtreeFrame } from '../../../src/services/persistence/utils/SubtreeFrame';
import { indentUnit } from '../../../src/utils/ObsidianConfig';
import { UnfollowableDraft } from '../../../src/services/persistence/FileLines';
import { DEFAULT_SETTINGS, type Task } from '../../../src/types';
import type { SubtreeReplacement } from '../../../src/services/persistence/TaskOps';

/**
 * A draft of a row in a note, which no write holds (`RowDraft`): a field's
 * change leaves the lines a write of the same change to the note leaves,
 * what the fields do not show is kept, a draft of the source is taken in
 * with each line still the line of the disk it was, and the draft is the
 * replacement the write of the row's subtree takes. Each change is also
 * written to the note through the operations, and the two compared.
 */

const FILE = 'note.md';

/** A row with what the fields do not show: a numbered marker, a date block that does not read, `==>`, `^id`, a child line that is no property, a child task. */
const NOTE = [
    '# Note',
    '- [ ] Parent',
    '\t1. [ ] Row @2026-11-26 @2026-13-45 ==> next ^row1',
    '\t\t- tv-color:: red',
    '\t\t- tags:: #a',
    '\t\t- area:: lab',
    '\t\t- a note',
    '\t\t- [ ] Child @2026-11-27',
    '- [ ] After',
    '',
];

/** Notes of a row named `Row…` for the runs of changes: a row with children and what the fields do not show, a row nested deep above a fence, a row under a section's properties. */
const NOTES: string[][] = [
    NOTE,
    ['- [ ] A', '    - [ ] B', '        - [ ] C', '            - [ ] Row', '                - x', '                - tv-mask:: q', '```', 'code', '```', ''],
    ['---', 'tv-color: red', '---', '## S', '- tags:: #sec', '', '- [ ] Row #own', '  - k:: v', '  - [ ] sub', '    - sk:: 1', '1. next', ''],
];

/** A small generator of fixed numbers (mulberry32), so each run is the same. */
const numbers = (seed: number) => (n: number): number => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
};

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

async function open(lines: string[]) {
    const { contents, session } = await openLiveVault({ [FILE]: lines }, s => { live = s; });
    const rowOf = (content: string): Task => {
        const found = session.index.getTasks().filter(task => task.content === content);
        expect(found).toHaveLength(1);
        return found[0];
    };
    const draftOf = async (row: Task): Promise<RowDraft> => {
        const snapshot = await session.ops.rowSnapshot(row.id);
        expect(snapshot).toBeDefined();
        return RowDraft.of(snapshot!, DEFAULT_SETTINGS, indentUnit(session.app));
    };
    return { session, rowOf, draftOf, lines: () => contents.get(FILE)!.split('\n') };
}

type Note = Awaited<ReturnType<typeof open>>;

/** The change taken into the draft and written to the note: both answered as taken, and the draft's lines are the note's. */
async function both(note: Note, draft: RowDraft, id: string, updates: Partial<Task> | null) {
    expect(updates).not.toBeNull();
    expect(draft.apply(updates!)).toBeNull();
    expect(await note.session.ops.updateTask(id, updates!, { tellRefusal: false })).toEqual({ written: true });
    await note.session.settle(FILE);
    expect(draft.lines()).toEqual(note.lines());
}

describe('a field\'s change in the draft', () => {
    const value = (spelling: string) => ({ value: PropertyValues.fromText(spelling) });
    const fields: [string, (row: Task) => Partial<Task> | null][] = [
        ['the name', row => TaskUpdateBuilder.content(row, 'Row renamed #b')],
        ['the status', row => TaskUpdateBuilder.status(row, '/')],
        ['the start', row => TaskUpdateBuilder.dateGroup(row, 'start', '2026-11-28', '09:00')],
        ['the end', row => TaskUpdateBuilder.dateGroup(row, 'end', '2026-11-29', '')],
        ['the due', row => TaskUpdateBuilder.due(row, '2026-11-30', '18:00')],
        ['the tags', row => TaskUpdateBuilder.tags(row, ['a', 'b'])],
        ['the tags, taken off', row => TaskUpdateBuilder.tags(row, [])],
        ['the color', row => TaskUpdateBuilder.styleField(row, 'color', 'blue')],
        ['the color, hidden', row => TaskUpdateBuilder.styleHidden(row, 'color')],
        ['the color, taken off', row => TaskUpdateBuilder.styleField(row, 'color', '')],
        ['the line style', row => TaskUpdateBuilder.styleField(row, 'linestyle', 'dashed')],
        ['the mask', row => TaskUpdateBuilder.styleField(row, 'mask', '***')],
        ['a property, set and added', row => TaskUpdateBuilder.customProperties(row, {
            ...row.properties, area: { key: 'area', ...value('home') }, n: { key: 'n', ...value('007') },
        })],
        ['a property, taken off', row => TaskUpdateBuilder.customProperties(row, {})],
    ];

    it('of nothing leaves the lines as they are: they are as a write spells them', async () => {
        const note = await open(NOTE);
        const draft = await note.draftOf(note.rowOf('Row'));

        expect(draft.apply({})).toBeNull();
        expect(draft.lines()).toEqual(NOTE);
        expect(draft.replacement()).toBeNull();
    });

    for (const [name, change] of fields) {
        it(`${name}: leaves the lines the write of it to the note leaves`, async () => {
            const note = await open(NOTE);
            const row = note.rowOf('Row');
            const draft = await note.draftOf(row);

            await both(note, draft, row.id, change(row));
            expect(note.lines()).not.toEqual(NOTE);
        });
    }

    it('one after another, each planned from the draft as the one before left it', async () => {
        const note = await open(NOTE);
        const row = note.rowOf('Row');
        const draft = await note.draftOf(row);

        await both(note, draft, row.id, TaskUpdateBuilder.content(draft.task(), 'Row two'));
        await both(note, draft, row.id, TaskUpdateBuilder.styleField(draft.task(), 'linestyle', 'dotted'));
        await both(note, draft, row.id, TaskUpdateBuilder.tags(draft.task(), ['c']));
        await both(note, draft, row.id, TaskUpdateBuilder.dateGroup(draft.task(), 'start', '', ''));
    });

    it('keeps the marker, the block that does not read, `==>`, `^id`, the child line and the child task', async () => {
        const note = await open(NOTE);
        const draft = await note.draftOf(note.rowOf('Row'));

        expect(draft.apply({ content: 'Renamed', color: 'blue' })).toBeNull();

        expect(draft.lines()).toEqual([
            '# Note',
            '- [ ] Parent',
            '\t1. [ ] Renamed @2026-11-26 @2026-13-45 ==> next ^row1',
            '\t\t- tv-color:: blue',
            '\t\t- tags:: #a',
            '\t\t- area:: lab',
            '\t\t- a note',
            '\t\t- [ ] Child @2026-11-27',
            '- [ ] After',
            '',
        ]);
    });

    it('reads a row indented four columns and more where it stands, under its parents', async () => {
        const deep = ['# Note', '- [ ] A', '\t- [ ] B', '\t\t- [ ] Deep @2026-11-26', '\t\t\t- tv-color:: red', '\t\t\t- [ ] Under', ''];
        const note = await open(deep);
        const row = note.rowOf('Deep');
        const draft = await note.draftOf(row);
        expect(draft.task().content).toBe('Deep');
        expect(draft.task().color).toBe('red');

        await both(note, draft, row.id, TaskUpdateBuilder.content(draft.task(), 'Deeper'));
        await both(note, draft, row.id, TaskUpdateBuilder.styleField(draft.task(), 'mask', 'm'));
        expect(note.lines()[3]).toBe('\t\t- [ ] Deeper @2026-11-26');
    });
});

describe('the values of the draft', () => {
    it('are the row as its lines read now, under the row\'s name, and its child tasks under it', async () => {
        const note = await open(NOTE);
        const row = note.rowOf('Row');
        const draft = await note.draftOf(row);

        expect(draft.apply({ content: 'Renamed', color: 'blue' })).toBeNull();

        const task = draft.task();
        expect(task.id).toBe(row.id);
        expect(task.content).toBe('Renamed');
        expect(task.color).toBe('blue');
        expect(task.line).toBe(row.line);
        expect(task.childLines.map(line => line.text.trim())).toContain('- a note');
        expect(draft.descendants().map(child => [child.content, child.parentId])).toEqual([['Child', row.id]]);
        expect(task.childIds).toEqual(draft.descendants().map(child => child.id));
    });
});

/** The source editor opened on `mark`. */
function frameOf(mark: DraftMark, unit: string): SubtreeFrame {
    const opening = SubtreeFrame.open(mark.rows, unit);
    if (!opening.open) throw new Error('the source does not open');
    return opening.frame;
}

/** What the source opened on `mark` writes: the row's line, and the child editor's lines with the line each was. */
function sourceOf(mark: DraftMark, unit: string, row: string, children: [text: string, was: number | null][]): SubtreeReplacement {
    const checked = frameOf(mark, unit).check({ parent: row, children: children.map(([text, was]) => ({ text, was })) });
    if (checked.kind !== 'write') throw new Error(`the source draft is ${checked.kind}`);
    return checked.replacement;
}

/**
 * The note `lines` once the draft's replacement is written to a vault of
 * them, the row being `content` (none to write: the lines as they are).
 */
async function writtenOf(lines: string[], content: string, draft: RowDraft): Promise<string[]> {
    const replacement = draft.replacement();
    if (!replacement) return lines;
    let session: VaultSession | undefined;
    try {
        const opened = await openLiveVault({ [FILE]: lines }, s => { session = s; });
        const row = opened.session.index.getTasks().find(task => task.content === content)!;
        expect(await opened.session.ops.replaceSubtree(row.id, row.subtreeLines!, replacement, { tellRefusal: false })).toEqual({ written: true });
        await opened.session.settle(FILE);
        return opened.contents.get(FILE)!.split('\n');
    } finally {
        session?.dispose();
    }
}

describe('a draft of the source, taken in', () => {
    it('between two field changes: each line is the line of the disk it was, and the write of the row\'s subtree takes it', async () => {
        const note = await open(NOTE);
        const row = note.rowOf('Row');
        const child = note.rowOf('Child');
        const draft = await note.draftOf(row);
        const unit = indentUnit(note.session.app);

        // The color's line is rewritten where it stands (line 1 of the subtree).
        expect(draft.apply({ color: 'blue' })).toBeNull();
        // The source as opened: tags (2), area (3), the note (4), child (5);
        // a line made above the note, the area's line taken out, the
        // child's text changed.
        const mark = draft.mark();
        expect(frameOf(mark, unit).children).toEqual(['- tv-color:: blue', '- tags:: #a', '- area:: lab', '- a note', '- [ ] Child @2026-11-27']);
        expect(draft.take(sourceOf(mark, unit, '1. [ ] Row @2026-11-26 @2026-13-45 ==> next ^row1', [
            ['- tv-color:: blue', 1],
            ['- tags:: #a', 2],
            ['- made:: here', null],
            ['- a note', 4],
            ['- [ ] Child two @2026-11-27', 5],
        ]), mark)).toBeNull();
        // A property line added past the last one, below `made`.
        expect(draft.apply({ content: 'Row two', linestyle: 'dashed' })).toBeNull();

        const replacement = draft.replacement();
        expect(replacement).toEqual({
            text: '1. [ ] Row two @2026-11-26 @2026-13-45 ==> next ^row1',
            children: [
                { text: '\t\t- tv-color:: blue', was: 1 },
                { text: '\t\t- tags:: #a', was: 2 },
                { text: '\t\t- made:: here', was: null },
                { text: '\t\t- tv-linestyle:: dashed', was: null },
                { text: '\t\t- a note', was: 4 },
                { text: '\t\t- [ ] Child two @2026-11-27', was: 5 },
            ],
        });
        expect(draft.task().properties.made?.value).toEqual(PropertyValues.fromText('here'));

        expect(await note.session.ops.replaceSubtree(row.id, row.subtreeLines!, replacement!, { tellRefusal: false })).toEqual({ written: true });
        await note.session.settle(FILE);
        expect(note.lines()).toEqual(draft.lines());
        // The rows the draft kept follow it.
        expect(note.session.index.getTask(row.id)?.content).toBe('Row two');
        expect(note.session.index.getTask(child.id)?.content).toBe('Child two');
    });

    it('opened again on a draft that took one in: the lines it is said to be are told as the disk\'s', async () => {
        const note = await open(NOTE);
        const row = note.rowOf('Row');
        const draft = await note.draftOf(row);
        const unit = indentUnit(note.session.app);
        const ROW = '1. [ ] Row @2026-11-26 @2026-13-45 ==> next ^row1';

        // The color's line and the tags' taken out: the note is line 2 of the subtree now, the disk's 4.
        const first = draft.mark();
        expect(draft.take(sourceOf(first, unit, ROW, [['- area:: lab', 3], ['- a note', 4], ['- [ ] Child @2026-11-27', 5]]), first)).toBeNull();
        const second = draft.mark();
        expect(draft.take(sourceOf(second, unit, ROW, [['- a note', 2], ['- [ ] Child @2026-11-27', 3]]), second)).toBeNull();

        expect(draft.replacement()?.children).toEqual([
            { text: '\t\t- a note', was: 4 },
            { text: '\t\t- [ ] Child @2026-11-27', was: 5 },
        ]);
    });

    it('whose lines take in a paragraph below the subtree is refused, and the draft is as it was', async () => {
        const fenced = ['# Note', '- [ ] P', '\t```', '\tcode', '\t```', 'para', ''];
        const note = await open(fenced);
        const draft = await note.draftOf(note.rowOf('P'));
        const unit = indentUnit(note.session.app);

        const mark = draft.mark();
        expect(draft.take(sourceOf(mark, unit, '- [ ] P', [['text', null]]), mark)).toEqual({ kind: 'disturbs', fence: null });
        expect(draft.lines()).toEqual(fenced);
        expect(draft.replacement()).toBeNull();
    });
});

describe('drafts of one source editor, taken in one after another on its mark', () => {
    const THREE = ['# Note', '- [ ] Row', '\t- [ ] A', '\t- [ ] B', '\t- [ ] C', '- [ ] After', ''];
    const ROW = '1. [ ] Row @2026-11-26 @2026-13-45 ==> next ^row1';
    const child = (text: string, was: number | null) => ({ text, was });

    it('a child taken out, then the one left changed: each line the editor says it was is the disk\'s', async () => {
        const note = await open(THREE);
        const draft = await note.draftOf(note.rowOf('Row'));
        const unit = indentUnit(note.session.app);
        const mark = draft.mark();

        expect(draft.take(sourceOf(mark, unit, '- [ ] Row', [['- [ ] B', 2], ['- [ ] C', 3]]), mark)).toBeNull();
        expect(draft.take(sourceOf(mark, unit, '- [ ] Row', [['- [ ] B two', 2], ['- [ ] C', 3]]), mark)).toBeNull();

        expect(draft.replacement()?.children).toEqual([child('\t- [ ] B two', 2), child('\t- [ ] C', 3)]);
        expect(await writtenOf(THREE, 'Row', draft)).toEqual(draft.lines());
        expect(draft.lines()).toEqual(['# Note', '- [ ] Row', '\t- [ ] B two', '\t- [ ] C', '- [ ] After', '']);
    });

    it('three drafts, lines taken out, changed, made and swapped: each written as the draft has it', async () => {
        const note = await open(NOTE);
        const draft = await note.draftOf(note.rowOf('Row'));
        const unit = indentUnit(note.session.app);
        const mark = draft.mark();
        // As opened: the color (1), the tags (2), the area (3), the note (4), the child (5).
        const drafts: [text: string, was: number | null][][] = [
            [['- tv-color:: red', 1], ['- area:: home', 3], ['- a note', 4], ['- [ ] Child @2026-11-27', 5]],
            [['- tv-color:: red', 1], ['- made:: here', null], ['- area:: home', 3], ['- [ ] Child @2026-11-27', 5], ['- a note', 4]],
            [['- made:: here', null], ['- area:: home', 3], ['- [ ] Child two @2026-11-27', 5], ['- a note', 4]],
        ];
        for (const children of drafts) {
            expect(draft.take(sourceOf(mark, unit, ROW, children), mark)).toBeNull();
            expect(await writtenOf(NOTE, 'Row', draft)).toEqual(draft.lines());
        }

        expect(draft.replacement()?.children).toEqual([
            child('\t\t- made:: here', null),
            child('\t\t- area:: home', 3),
            child('\t\t- [ ] Child two @2026-11-27', 5),
            child('\t\t- a note', 4),
        ]);
        expect(draft.task().properties.area?.value).toEqual(PropertyValues.fromText('home'));
        expect(draft.task().color).toBeUndefined();
    });

    it('opened after a field\'s change: the line the change made is one the disk has not', async () => {
        const note = await open(NOTE);
        const draft = await note.draftOf(note.rowOf('Row'));
        const unit = indentUnit(note.session.app);

        expect(draft.apply({ linestyle: 'dashed' })).toBeNull();
        const mark = draft.mark();
        const children: [string, number | null][] = frameOf(mark, unit).children.map((text, i) => [text, i + 1]);
        const made = children.findIndex(([text]) => text === '- tv-linestyle:: dashed');
        expect(made).toBeGreaterThan(-1);
        children.splice(0, 1);
        expect(draft.take(sourceOf(mark, unit, ROW, children), mark)).toBeNull();
        children[0] = ['- tags:: #b', children[0][1]];
        expect(draft.take(sourceOf(mark, unit, ROW, children), mark)).toBeNull();

        expect(draft.replacement()?.children.find(line => line.text.endsWith('tv-linestyle:: dashed'))?.was).toBeNull();
        expect(draft.replacement()?.children.map(line => line.was)).toEqual([2, 3, null, 4, 5]);
        expect(await writtenOf(NOTE, 'Row', draft)).toEqual(draft.lines());
    });

    it('refused, and the next draft on the same mark taken in: the draft and the mark are as they were', async () => {
        const fenced = ['# Note', '- [ ] P', '\t```', '\tcode', '\t```', 'para', ''];
        const note = await open(fenced);
        const draft = await note.draftOf(note.rowOf('P'));
        const unit = indentUnit(note.session.app);
        const mark = draft.mark();

        expect(draft.take(sourceOf(mark, unit, '- [ ] P', [['```', 1], ['```', 3]]), mark)).toBeNull();
        expect(draft.take(sourceOf(mark, unit, '- [ ] P', [['text', null]]), mark)).toEqual({ kind: 'disturbs', fence: null });
        expect(draft.lines()).toEqual(['# Note', '- [ ] P', '\t```', '\t```', 'para', '']);

        expect(draft.take(sourceOf(mark, unit, '- [ ] P', [['```', 1], ['more code', null], ['```', 3]]), mark)).toBeNull();
        expect(draft.replacement()?.children).toEqual([child('\t```', 1), child('\tmore code', null), child('\t```', 3)]);
        expect(await writtenOf(fenced, 'P', draft)).toEqual(draft.lines());
    });

    it('back to the lines opened (`SubtreeFrame.unchanged`): the draft is as the mark found it, nothing to write when that is the disk\'s', async () => {
        const note = await open(NOTE);
        const draft = await note.draftOf(note.rowOf('Row'));
        const unit = indentUnit(note.session.app);
        const mark = draft.mark();
        const frame = frameOf(mark, unit);

        expect(draft.take(sourceOf(mark, unit, ROW, [['- a note', 4]]), mark)).toBeNull();
        expect(draft.replacement()).not.toBeNull();
        // The editor typed back to the lines it opened on is the same to it, not to the draft.
        expect(frame.check({ parent: frame.parent, children: frame.children.map((text, i) => ({ text, was: i + 1 })) })).toEqual({ kind: 'same' });
        expect(draft.take(frame.unchanged(), mark)).toBeNull();
        expect(draft.lines()).toEqual(NOTE);
        expect(draft.replacement()).toBeNull();
    });

    it('back to the lines opened after a field\'s change: the draft is as the change left it', async () => {
        const note = await open(NOTE);
        const draft = await note.draftOf(note.rowOf('Row'));
        const unit = indentUnit(note.session.app);
        expect(draft.apply({ color: 'blue' })).toBeNull();
        const changed = draft.lines();
        const replaced = draft.replacement();
        const mark = draft.mark();

        expect(draft.take(sourceOf(mark, unit, ROW, [['- tags:: #a', 2]]), mark)).toBeNull();
        expect(draft.take(frameOf(mark, unit).unchanged(), mark)).toBeNull();
        expect(draft.lines()).toEqual(changed);
        expect(draft.replacement()).toEqual(replaced);
    });
});

describe('a draft of the source taken in on a mark that no longer holds', () => {
    const ROW = '1. [ ] Row @2026-11-26 @2026-13-45 ==> next ^row1';

    it('after a field\'s change is thrown, and the draft is as the change left it', async () => {
        const note = await open(NOTE);
        const draft = await note.draftOf(note.rowOf('Row'));
        const unit = indentUnit(note.session.app);
        const mark = draft.mark();
        const source = sourceOf(mark, unit, ROW, [['- a note', 4]]);

        expect(draft.apply({ color: 'blue' })).toBeNull();
        const changed = draft.lines();
        expect(() => draft.take(source, mark)).toThrow(UnfollowableDraft);
        expect(draft.lines()).toEqual(changed);
        // A mark made now holds.
        const now = draft.mark();
        expect(draft.take(sourceOf(now, unit, ROW, [['- tv-color:: blue', 1], ['- a note', 4]]), now)).toBeNull();
    });

    it('after a field\'s change between two of its drafts is thrown', async () => {
        const note = await open(NOTE);
        const draft = await note.draftOf(note.rowOf('Row'));
        const unit = indentUnit(note.session.app);
        const mark = draft.mark();

        expect(draft.take(sourceOf(mark, unit, ROW, [['- tags:: #a', 2], ['- a note', 4]]), mark)).toBeNull();
        expect(draft.apply({ content: 'Renamed' })).toBeNull();
        expect(() => draft.take(sourceOf(mark, unit, ROW, [['- a note', 4]]), mark)).toThrow(UnfollowableDraft);
    });

    it('after a draft taken in on another mark is thrown; another mark made, and nothing taken in on it, ends none', async () => {
        const note = await open(NOTE);
        const draft = await note.draftOf(note.rowOf('Row'));
        const unit = indentUnit(note.session.app);
        const first = draft.mark();
        const idle = draft.mark();
        expect(draft.take(sourceOf(first, unit, ROW, [['- a note', 4]]), first)).toBeNull();
        expect(() => draft.take(sourceOf(idle, unit, ROW, [['- tags:: #a', 2]]), idle)).toThrow(UnfollowableDraft);
        expect(draft.take(sourceOf(first, unit, ROW, [['- tags:: #a', 2]]), first)).toBeNull();
        expect(draft.replacement()?.children).toEqual([{ text: '\t\t- tags:: #a', was: 2 }]);
    });

    it('made by another draft, or by no draft, is thrown', async () => {
        const note = await open(NOTE);
        const draft = await note.draftOf(note.rowOf('Row'));
        const other = await note.draftOf(note.rowOf('Row'));
        const unit = indentUnit(note.session.app);
        const theirs = other.mark();
        const source = sourceOf(theirs, unit, ROW, [['- a note', 4]]);

        expect(() => draft.take(source, theirs)).toThrow(UnfollowableDraft);
        expect(() => draft.take(source, { rows: theirs.rows, was: theirs.was })).toThrow(UnfollowableDraft);
        expect(draft.lines()).toEqual(NOTE);
    });
});

describe('one source editor\'s drafts, taken in on its mark in a run', () => {
    // A fixed run per note of three to five drafts of one editor, opened
    // once, each made from the one before by one or two edits (a line
    // added, taken out, swapped with the next, indented one level more, or
    // its text changed): after each draft taken in, the write of the
    // draft's replacement to the note leaves the draft's lines.
    NOTES.forEach((lines, n) => {
        it(`over note ${n + 1}: the write of the replacement leaves the draft's lines after each draft`, async () => {
            const pick = numbers(n + 11);
            for (let run = 0; run < 8; run++) {
                live?.dispose();
                const note = await open(lines);
                const content = note.session.index.getTasks().find(task => task.content.startsWith('Row'))!.content;
                const draft = await note.draftOf(note.rowOf(content));
                const unit = indentUnit(note.session.app);
                const mark = draft.mark();
                const frame = frameOf(mark, unit);
                const children: [string, number | null][] = frame.children.map((text, i) => [text, i + 1]);
                const drafts = 3 + pick(3);
                for (let step = 0; step < drafts; step++) {
                    for (let edits = 1 + pick(2); edits > 0; edits--) {
                        const at = children.length > 0 ? pick(children.length) : 0;
                        const kind = pick(5);
                        if (kind === 0) children.splice(at, 0, [pick(2) ? `- new ${step}` : `- [ ] T${step}`, null]);
                        else if (children.length === 0) continue;
                        else if (kind === 1) children.splice(at, 1);
                        else if (kind === 2) {
                            const next = (at + 1) % children.length;
                            [children[at], children[next]] = [children[next], children[at]];
                        } else if (kind === 3) children[at] = [`\t${children[at][0]}`, children[at][1]];
                        else children[at] = [`${children[at][0]} e`, children[at][1]];
                    }
                    const checked = frame.check({ parent: frame.parent, children: children.map(([text, was]) => ({ text, was })) });
                    if (checked.kind === 'refused') continue;
                    const taken = draft.take(checked.kind === 'write' ? checked.replacement : frame.unchanged(), mark);
                    if (taken) continue;
                    expect(await writtenOf(lines, content, draft)).toEqual(draft.lines());
                }
            }
        });
    });
});

describe('a draft of the source whose row reads as no row in the note', () => {
    // An ordered list that starts at another number than 1 cannot interrupt
    // a paragraph: the line goes on the text above it, though it reads as a
    // task line alone.
    const cases: [string, string[], string][] = [
        ['under its parent\'s text', ['- [ ] P', '    1. [ ] R', '- [ ] After', ''], '2. [ ] R'],
        ['right after a paragraph', ['text', '1. [ ] R', '', '- [ ] After', ''], '3. [ ] R'],
        ['with a child, under its parent\'s text', ['- [ ] P', '    1. [ ] R', '        - [ ] C', '- [ ] After', ''], '2. [ ] R'],
    ];
    for (const [name, lines, row] of cases) {
        it(`${name}: is refused as no task, and the draft is as it was, its values read`, async () => {
            const note = await open(lines);
            const draft = await note.draftOf(note.rowOf('R'));
            const unit = indentUnit(note.session.app);
            const mark = draft.mark();

            const taken = draft.take(sourceOf(mark, unit, row, frameOf(mark, unit).children.map((text, i) => [text, i + 1])), mark);
            expect(taken).toEqual({ kind: 'not-task' });
            expect(draft.lines()).toEqual(lines);
            expect(draft.replacement()).toBeNull();
            expect(draft.task().content).toBe('R');
            expect(draft.apply({ content: 'Renamed' })).toBeNull();
            expect(draft.descendants().map(child => child.content)).toEqual(lines.some(line => line.includes('[ ] C')) ? ['C'] : []);
        });
    }
});

describe('a draft of the subtree whose child line ends the row\'s item', () => {
    it('is refused as unplaceable, and the draft is as it was', async () => {
        const lines = ['# Note', '- [ ] R', '    - [ ] C', '- [ ] After', ''];
        const note = await open(lines);
        const draft = await note.draftOf(note.rowOf('R'));

        // A child at the row's own indentation is its sibling: the row's item ends above it.
        expect(draft.take({ text: '- [ ] R', children: [{ text: '    - [ ] C', was: 1 }, { text: '- [ ] Sibling', was: null }] }, draft.mark()))
            .toEqual({ kind: 'unplaceable', fence: null });
        expect(draft.lines()).toEqual(lines);
        expect(draft.replacement()).toBeNull();
    });
});

describe('field changes and drafts of the source in turn', () => {
    // A fixed run of five changes per note, each a field's change or a draft
    // of the source (a line added, taken out, swapped with the next, indented
    // one level more, or its text changed): the draft's lines are what the
    // write of its replacement to the note leaves.
    const fields: ((row: Task) => Partial<Task> | null)[] = [
        row => TaskUpdateBuilder.content(row, `${row.content}z`),
        row => TaskUpdateBuilder.due(row, '2026-11-30', ''),
        row => TaskUpdateBuilder.tags(row, ['a', 'b']),
        row => TaskUpdateBuilder.styleField(row, 'color', 'blue'),
        row => TaskUpdateBuilder.styleHidden(row, 'color'),
        row => TaskUpdateBuilder.styleField(row, 'linestyle', 'dashed'),
        row => TaskUpdateBuilder.customProperties(row, { ...row.properties, n: { key: 'n', value: PropertyValues.fromText('007') } }),
        row => TaskUpdateBuilder.customProperties(row, {}),
    ];

    NOTES.forEach((lines, n) => {
        it(`over note ${n + 1}: the write of the replacement leaves the draft's lines`, async () => {
            const pick = numbers(n + 1);
            for (let run = 0; run < 6; run++) {
                live?.dispose();
                const note = await open(lines);
                const row = note.rowOf(note.session.index.getTasks().find(task => task.content.startsWith('Row'))!.content);
                const draft = await note.draftOf(row);
                const unit = indentUnit(note.session.app);
                for (let step = 0; step < 5; step++) {
                    if (pick(2) === 0) {
                        const updates = fields[pick(fields.length)](draft.task());
                        if (updates) draft.apply(updates);
                        continue;
                    }
                    const mark = draft.mark();
                    const opening = SubtreeFrame.open(mark.rows, unit);
                    if (!opening.open) continue;
                    const children: [string, number | null][] = opening.frame.children.map((text, i) => [text, i + 1]);
                    const at = children.length > 0 ? pick(children.length) : 0;
                    const kind = pick(5);
                    if (kind === 0) children.splice(at, 0, [pick(2) ? `- new ${step}` : `- [ ] T${step}`, null]);
                    else if (children.length === 0) continue;
                    else if (kind === 1) children.splice(at, 1);
                    else if (kind === 2) {
                        const next = (at + 1) % children.length;
                        [children[at], children[next]] = [children[next], children[at]];
                    } else if (kind === 3) children[at] = [`\t${children[at][0]}`, children[at][1]];
                    else children[at] = [`${children[at][0]} e`, children[at][1]];
                    const checked = opening.frame.check({ parent: opening.frame.parent, children: children.map(([text, was]) => ({ text, was })) });
                    if (checked.kind === 'write') draft.take(checked.replacement, mark);
                }
                const replacement = draft.replacement();
                if (!replacement) continue;
                expect(await note.session.ops.replaceSubtree(row.id, row.subtreeLines!, replacement, { tellRefusal: false })).toEqual({ written: true });
                await note.session.settle(FILE);
                expect(note.lines()).toEqual(draft.lines());
            }
        });
    });
});

describe('a change the draft cannot take in', () => {
    it('over a property whose lines are wrong is refused as the write refuses it, and the draft is as it was', async () => {
        const wrong = ['# Note', '- [ ] Row', '\t- tv-color:: red', '\t- tv-color:: green', ''];
        const note = await open(wrong);
        const row = note.rowOf('Row');
        const draft = await note.draftOf(row);

        const refused = draft.apply({ content: 'Renamed', color: 'blue' });
        expect(refused).toEqual({ kind: 'property', key: 'tv-color', line: 2 });
        expect(draft.lines()).toEqual(wrong);
        expect(draft.task().content).toBe('Row');
        expect(draft.replacement()).toBeNull();

        const written = await note.session.ops.updateTask(row.id, { content: 'Renamed', color: 'blue' }, { tellRefusal: false });
        expect(written).toEqual({ written: false, refused: expect.objectContaining({ reason: refused }) });
        expect(note.lines()).toEqual(wrong);
    });
});

describe('the draft\'s replacement', () => {
    it('is none while the lines are the disk\'s, and none again once a change is undone', async () => {
        const note = await open(NOTE);
        const draft = await note.draftOf(note.rowOf('Row'));
        expect(draft.replacement()).toBeNull();

        expect(draft.apply({ color: 'blue' })).toBeNull();
        expect(draft.replacement()).not.toBeNull();
        expect(draft.apply({ color: 'red' })).toBeNull();
        expect(draft.replacement()).toBeNull();
    });
});
