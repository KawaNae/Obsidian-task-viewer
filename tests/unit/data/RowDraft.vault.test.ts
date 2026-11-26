import { describe, it, expect, afterEach } from 'vitest';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { RowDraft } from '../../../src/services/data/RowDraft';
import { TaskUpdateBuilder } from '../../../src/modals/form/TaskUpdateBuilder';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';
import { SubtreeFrame } from '../../../src/services/persistence/utils/SubtreeFrame';
import { indentUnit } from '../../../src/utils/ObsidianConfig';
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

/** What the source opened on the draft writes: the row's line, and the child editor's lines with the line each was. */
function sourceOf(draft: RowDraft, unit: string, row: string, children: [text: string, was: number | null][]): SubtreeReplacement {
    const opening = SubtreeFrame.open(draft.subtree(), unit);
    if (!opening.open) throw new Error('the source does not open');
    const checked = opening.frame.check({ parent: row, children: children.map(([text, was]) => ({ text, was })) });
    if (checked.kind !== 'write') throw new Error(`the source draft is ${checked.kind}`);
    return checked.replacement;
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
        const opening = SubtreeFrame.open(draft.subtree(), unit);
        if (!opening.open) throw new Error('the source does not open');
        expect(opening.frame.children).toEqual(['- tv-color:: blue', '- tags:: #a', '- area:: lab', '- a note', '- [ ] Child @2026-11-27']);
        expect(draft.take(sourceOf(draft, unit, '1. [ ] Row @2026-11-26 @2026-13-45 ==> next ^row1', [
            ['- tv-color:: blue', 1],
            ['- tags:: #a', 2],
            ['- made:: here', null],
            ['- a note', 4],
            ['- [ ] Child two @2026-11-27', 5],
        ]))).toBeNull();
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
        expect(draft.take(sourceOf(draft, unit, ROW, [['- area:: lab', 3], ['- a note', 4], ['- [ ] Child @2026-11-27', 5]]))).toBeNull();
        expect(draft.take(sourceOf(draft, unit, ROW, [['- a note', 2], ['- [ ] Child @2026-11-27', 3]]))).toBeNull();

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

        expect(draft.take(sourceOf(draft, unit, '- [ ] P', [['text', null]]))).toEqual({ kind: 'disturbs', fence: null });
        expect(draft.lines()).toEqual(fenced);
        expect(draft.replacement()).toBeNull();
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
            const children = SubtreeFrame.open(draft.subtree(), unit);
            if (!children.open) throw new Error('the source does not open');

            const taken = draft.take(sourceOf(draft, unit, row, children.frame.children.map((text, i) => [text, i + 1])));
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
        expect(draft.take({ text: '- [ ] R', children: [{ text: '    - [ ] C', was: 1 }, { text: '- [ ] Sibling', was: null }] }))
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
    const notes: string[][] = [
        NOTE,
        ['- [ ] A', '    - [ ] B', '        - [ ] C', '            - [ ] Row', '                - x', '                - tv-mask:: q', '```', 'code', '```', ''],
        ['---', 'tv-color: red', '---', '## S', '- tags:: #sec', '', '- [ ] Row #own', '  - k:: v', '  - [ ] sub', '    - sk:: 1', '1. next', ''],
    ];
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
    /** A small generator of fixed numbers (mulberry32), so each run is the same. */
    const numbers = (seed: number) => (n: number): number => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
    };

    notes.forEach((lines, n) => {
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
                    const opening = SubtreeFrame.open(draft.subtree(), unit);
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
                    if (checked.kind === 'write') draft.take(checked.replacement);
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
