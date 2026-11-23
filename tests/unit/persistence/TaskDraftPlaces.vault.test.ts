import { describe, it, expect, vi, afterEach } from 'vitest';
import realMoment from 'moment';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { byKey, valuesOf } from '../helpers/properties';
import { CreatePlaces, type CreatePlace } from '../../../src/services/data/CreatePlaces';
import { draftTask, newRowOf, type DraftSeed } from '../../../src/services/data/TaskDraft';
import type { NoteSpot } from '../../../src/services/persistence/Notes';
import { DEFAULT_SCOPE_KEYS, DEFAULT_SETTINGS, type PropertyScalar, type Task } from '../../../src/types';

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../mocks/obsidian')>('../mocks/obsidian');
    return { ...actual, moment: realMoment };
});

/**
 * A draft made at a place as the place answers (`CreatePlaces.facts`), its
 * row put there (`newRowOf`, `CreatePlaces.create`), and the task the index
 * reads back from the note: each value the draft shows is the one the row
 * reads as once written, its own and what it inherits and from where. In a
 * daily note under the settings' section, at the end of a note, in a note
 * made for it, and at the head of a row's children.
 */

const DAY = '2031-01-15';
const DAILY = `${DAY}.md`;
const FILE = 'note.md';

const text = (s: string): PropertyScalar => ({ type: 'text', text: s, spelling: s });

/** A daily note whose frontmatter and section give a line put there a start, a tag, a mask, a color and a property. */
const DAILY_NOTE = [
    '---', 'tags: [ft]', 'tv-start: "2031-01-15"', '---',
    '## Tasks', '- tv-mask:: ***', '- tv-color:: 00ff00', '- area:: lab', '- [ ] 既存', '',
].join('\n');
/** A row whose section gives its children a start, a line style and a property. */
const PARENT_NOTE = ['## Work', '- tv-start:: 2031-02-01', '- tv-linestyle:: dotted', '- area:: lab', '- [ ] 親', '    - [ ] 子', ''].join('\n');

const SEEDS: [string, DraftSeed][] = [
    ['nothing of its own', {}],
    ['every value of its own, one alike to what it inherits, and one hiding what it would', {
        statusChar: 'x',
        content: '会議 #work #仕事',
        startDate: '2031-01-16', startTime: '09:00', endTime: '10:30', due: '2031-01-20',
        tags: ['plan', 'work', '仕事'],
        color: 'ff0000', linestyle: 'dashed', mask: null,
        properties: byKey({
            area: text('lab'),
            owner: text('me'),
            count: { type: 'number', number: 3, spelling: '3' },
            done: { type: 'boolean', boolean: true, spelling: 'true' },
            items: { type: 'list', items: [text('x'), text('y')] },
            empty: { type: 'null', spelling: '' },
        }),
    }],
    ['a span over two days, a style it has none of, a custom property hidden', {
        statusChar: '/',
        content: '夜勤',
        startDate: '2031-01-16', startTime: '22:00', endDate: '2031-01-17', endTime: '06:00',
        color: null, linestyle: null,
        properties: byKey({ area: { type: 'null', spelling: '' } }),
    }],
    ['a time with no date, a tag declared with no name', {
        startTime: '08:00',
        tags: ['solo'],
    }],
];

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

async function open(files: Record<string, string>) {
    const opened = await openVault(files);
    live = opened.session;
    // The daily notes as the core plugin's options name them.
    (opened.session.app as unknown as { internalPlugins: unknown }).internalPlugins = {
        getPluginById: (id: string) => (id === 'daily-notes' ? { instance: { options: { format: 'YYYY-MM-DD', folder: '', template: '' } } } : null),
    };
    const places = new CreatePlaces(opened.session.app, opened.session.ops, () => DEFAULT_SETTINGS, (id) => opened.session.index.getTask(id));
    return { ...opened, places };
}

/**
 * What a draft and the row read back are compared by: every value the hub
 * shows of a task. A start date of none is spelt two ways: the reading gives
 * a line with no date an empty one, the draft none; both say no date, as
 * `NoteTasks.inheritedBy` reads them.
 */
function shown(task: Task) {
    return {
        file: task.file,
        statusChar: task.statusChar,
        content: task.content,
        startDate: task.startDate || undefined,
        startTime: task.startTime,
        endDate: task.endDate,
        endTime: task.endTime,
        due: task.due,
        tags: task.tags,
        color: task.color,
        linestyle: task.linestyle,
        mask: task.mask,
        properties: valuesOf(task.properties),
        cascadeContext: task.cascadeContext && { ...task.cascadeContext, properties: valuesOf(task.cascadeContext.properties) },
        inheritedFrom: task.inheritedFrom,
    };
}

/** The place at `spot` in the note at `path`, made empty when it is not there. */
function atPath(path: string, spot: NoteSpot): CreatePlace {
    return { kind: 'note', note: { kind: 'path', path }, spot };
}

/** The draft of `seed` at `place`, put there; the draft and the task the index reads of the row written. */
async function putDraft(s: Awaited<ReturnType<typeof open>>, place: CreatePlace, seed: DraftSeed, file: string) {
    const facts = await s.places.facts(place);
    const draft = draftTask({ file: s.places.noteOf(place)!, ...facts }, seed);
    const before = new Set(s.session.index.getTasks().map(task => task.id));
    const answer = await s.places.create(place, newRowOf(draft, DEFAULT_SCOPE_KEYS), { tellRefusal: false });
    expect(answer.written).toBe(true);
    await s.session.settle(file);
    const made = s.session.index.getTasks().filter(task => task.file === file && !before.has(task.id) && task.content === draft.content);
    expect(made).toHaveLength(1);
    return { draft, read: made[0] };
}

describe('a draft put and read back', () => {
    for (const [name, seed] of SEEDS) {
        it(`in a daily note: ${name}`, async () => {
            const s = await open({ [DAILY]: DAILY_NOTE });
            const { draft, read } = await putDraft(s, s.places.dailyNote(DAY), seed, DAILY);
            expect(shown(read)).toEqual(shown(draft));
        });

        it(`at the end of a note: ${name}`, async () => {
            const s = await open({ [FILE]: DAILY_NOTE });
            const { draft, read } = await putDraft(s, atPath(FILE, 'end'), seed, FILE);
            expect(shown(read)).toEqual(shown(draft));
        });

        for (const [where, spot] of [['under a heading', { heading: 'Tasks', level: 2, side: 'head' }], ['at its end', 'end']] as [string, NoteSpot][]) {
            it(`in a note not there yet, ${where}: ${name}`, async () => {
                const s = await open({});
                const { draft, read } = await putDraft(s, atPath(FILE, spot), seed, FILE);
                expect(shown(read)).toEqual(shown(draft));
            });
        }

        it(`under a row: ${name}`, async () => {
            const s = await open({ [FILE]: PARENT_NOTE });
            const parent = s.session.index.getTasks().find(task => task.content === '親')!;
            const { draft, read } = await putDraft(s, { kind: 'childOf', taskId: parent.id }, seed, FILE);
            expect(shown(read)).toEqual(shown(draft));
            expect(read.parentId).toBe(s.session.index.getTasks().find(task => task.content === '親')!.id);
        });
    }

    it('with no date: the draft has no start date, and the row reads back an empty one', async () => {
        const s = await open({ [DAILY]: DAILY_NOTE });
        const { draft, read } = await putDraft(s, s.places.dailyNote(DAY), { content: '日付なし' }, DAILY);
        expect(draft.startDate).toBeUndefined();
        expect(read.startDate).toBe('');
    });

    it('in a daily note not there yet', async () => {
        const s = await open({});
        const { draft, read } = await putDraft(s, s.places.dailyNote(DAY), SEEDS[1][1], DAILY);
        expect(shown(read)).toEqual(shown(draft));
    });
});
