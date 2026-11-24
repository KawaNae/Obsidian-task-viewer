import { describe, it, expect, vi, afterEach } from 'vitest';
import realMoment from 'moment';
import { Notice } from '../mocks/obsidian';
import { CreatePlaces, type CreatePlace } from '../../../src/services/data/CreatePlaces';
import type { NoteSpot } from '../../../src/services/persistence/Notes';
import { DEFAULT_SETTINGS, type TaskViewerSettings } from '../../../src/types';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../mocks/obsidian')>('../mocks/obsidian');
    return { ...actual, moment: realMoment };
});

/**
 * What the hub on a task not written yet is told of a place before the line
 * is written (`CreatePlaces.facts`): where the line goes, and what it inherits there —
 * what the reading gives the line once it is written, and nothing else (a
 * daily note's day is not given) — with where each value comes from, as the
 * reading says it of the line once it is written (`inheritedFrom`).
 */

const DAY = '2031-01-15';
const NOTE = `${DAY}.md`;
const TEMPLATE = 'Templates/Daily.md';

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

async function places(files: Record<string, string>, template = '', settings: Partial<TaskViewerSettings> = {}) {
    const { contents, session } = await openLiveVault(files, (s) => { live = s; });
    // The daily notes as the core plugin's options name them.
    (session.app as unknown as { internalPlugins: unknown }).internalPlugins = {
        getPluginById: (id: string) => (id === 'daily-notes' ? { instance: { options: { format: 'YYYY-MM-DD', folder: '', template } } } : null),
    };
    const full = { ...DEFAULT_SETTINGS, ...settings };
    return { contents, session, places: new CreatePlaces(session.app, session.ops, () => full, (id) => session.index.getTask(id)) };
}

describe('a daily note as a place', () => {
    it('there, with its heading: the line goes under it, and inherits nothing of the note\'s name', async () => {
        const { places: p } = await places({ [NOTE]: '# day\n## Tasks\n- [ ] 既存\n' });
        const facts = await p.facts(p.dailyNote(DAY));
        expect(facts).toMatchObject({ kind: 'note', path: NOTE, note: 'existing', heading: { kind: 'one' }, ignored: false, inherits: {} });
    });

    it('inherits what the frontmatter and the section give a line put there', async () => {
        const { places: p } = await places({
            [NOTE]: ['---', 'tv-start: "2031-01-15"', '---', '## Tasks', '- tv-start:: 10:00', '- tv-color:: ff0000', '- [ ] 既存', ''].join('\n'),
        });
        const facts = await p.facts(p.dailyNote(DAY));
        expect(facts.inherits).toMatchObject({ startDate: '2031-01-15', startTime: '10:00', color: 'ff0000' });
    });

    it('says where each inherited value comes from, as the reading says it of the line once it is written', async () => {
        const { session, places: p } = await places({
            [NOTE]: ['---', 'tags: [ft]', 'tv-start: "2031-01-15"', '---', '## Tasks', '- tv-color:: ff0000', '- area:: lab', '- [ ] 既存', ''].join('\n'),
        });
        const facts = await p.facts(p.dailyNote(DAY));
        expect(facts.inheritedFrom?.fields.startDate).toMatchObject({ kind: 'frontmatter' });
        expect(facts.inheritedFrom?.fields.color).toMatchObject({ kind: 'section' });
        expect(Object.keys(facts.inheritedFrom?.properties ?? {})).toEqual(['area']);

        await p.create(p.dailyNote(DAY), { line: '- [ ] 新しい' }, { tellRefusal: false });
        const written = session.index.getTasks().find(task => task.content === '新しい')!;
        expect(facts.inheritedFrom).toEqual(written.inheritedFrom);
        expect(facts.inherits).toEqual(written.cascadeContext);
    });

    it('there without the heading: the write makes it at the end, where the line inherits the frontmatter', async () => {
        const { places: p } = await places({ [NOTE]: ['---', 'tv-due: "2031-01-20"', '---', '# day', ''].join('\n') });
        const facts = await p.facts(p.dailyNote(DAY));
        expect(facts).toMatchObject({ note: 'existing', heading: { kind: 'none' }, inherits: { due: '2031-01-20' } });
    });

    it('inherits a value written above the first heading, and none of the frontmatter\'s custom keys', async () => {
        const { places: p } = await places({
            [NOTE]: ['---', 'tv-color: ff0000', '体重[kg]:', 'owner: me', '---', 'Inherit properties:', '- 時給:: 1450', '- tv-color:: 00ff00', '', '## Tasks', '- [ ] 既存', ''].join('\n'),
        });
        const facts = await p.facts(p.dailyNote(DAY));
        if (facts.kind !== 'note') throw new Error(facts.kind);
        expect(facts.inherits.color).toBe('00ff00');
        expect(Object.keys(facts.inherits.properties ?? {})).toEqual(['時給']);
        expect(facts.inherits.properties?.['時給']?.value).toMatchObject({ type: 'number', number: 1450 });
    });

    it('with the heading twice: no one place, and nothing inherited', async () => {
        const { places: p } = await places({ [NOTE]: '## Tasks\n## Tasks\n' });
        const facts = await p.facts(p.dailyNote(DAY));
        expect(facts).toMatchObject({ heading: { kind: 'many', count: 2 }, inherits: {} });
        expect(facts.inheritedFrom).toBeUndefined();
    });

    it('not there: read as its template makes it for the day', async () => {
        const { places: p } = await places({
            [TEMPLATE]: ['# {{title}}', '## Tasks', '- tv-start:: 09:00', ''].join('\n'),
        }, 'Templates/Daily');
        const facts = await p.facts(p.dailyNote(DAY));
        expect(facts).toMatchObject({ kind: 'note', path: NOTE, note: 'new', heading: { kind: 'one' }, inherits: { startTime: '09:00' } });
    });

    it('a note the views do not read (tv-ignore): said as such', async () => {
        const { places: p } = await places({ [NOTE]: ['---', 'tv-ignore: true', '---', '## Tasks', ''].join('\n') });
        const facts = await p.facts(p.dailyNote(DAY));
        expect(facts).toMatchObject({ ignored: true, inherits: {} });
    });

    it('the write puts the line under the heading, the note made when it is not there', async () => {
        const { contents, places: p } = await places({});
        const answer = await p.create(p.dailyNote(DAY), { line: '- [ ] 新しい @10:00' }, { tellRefusal: false });
        expect(answer.written).toBe(true);
        expect(contents.get(NOTE)).toBe('## Tasks\n- [ ] 新しい @10:00\n');
    });

    it('not there, at its end: made of its template for the day, the line put after it', async () => {
        const { contents, places: p } = await places({
            [TEMPLATE]: ['# {{title}}', '## Log', '- tv-color:: ff0000', ''].join('\n'),
        }, 'Templates/Daily');
        const place = { ...p.dailyNote(DAY), spot: 'end' as const };
        const facts = await p.facts(place);
        expect(facts).toMatchObject({ kind: 'note', path: NOTE, spot: 'end', note: 'new', seed: 'daily', heading: null, inherits: { color: 'ff0000' } });
        expect((await p.create(place, { line: '- [ ] 末尾' }, { tellRefusal: false })).written).toBe(true);
        expect(contents.get(NOTE)).toBe(['# 2031-01-15', '## Log', '- tv-color:: ff0000', '- [ ] 末尾', ''].join('\n'));
    });

    it('at the end of its section when the settings say so: the line put after the section\'s last', async () => {
        const { contents, places: p } = await places({ [NOTE]: '## Tasks\n- [ ] 既存\n## Log\n' }, '', { sectionSide: 'end' });
        expect(p.dailyNote(DAY)).toEqual({ kind: 'note', note: { kind: 'daily', date: DAY }, spot: { heading: 'Tasks', level: 2, side: 'end' } });
        await p.create(p.dailyNote(DAY), { line: '- [ ] 新しい' }, { tellRefusal: false });
        expect(contents.get(NOTE)).toBe('## Tasks\n- [ ] 既存\n- [ ] 新しい\n## Log\n');
    });

    it('a write refused is told as the caller asks: by a notice, or to the caller alone', async () => {
        const { places: p } = await places({ [NOTE]: '## Tasks\n## Tasks\n' });
        expect((await p.create(p.dailyNote(DAY), { line: '- [ ] 新しい' }, { tellRefusal: false })).written).toBe(false);
        expect(Notice.messages).toEqual([]);

        expect((await p.create(p.dailyNote(DAY), { line: '- [ ] 新しい' })).written).toBe(false);
        expect(Notice.messages).toHaveLength(1);
    });

    it('is the day\'s note by the daily notes\' settings, its path and its template read off the one day', async () => {
        const { places: p } = await places({});
        expect(p.dailyNote(DAY)).toEqual({ kind: 'note', note: { kind: 'daily', date: DAY }, spot: { heading: 'Tasks', level: 2, side: 'head' } });
        expect(p.noteOf(p.dailyNote(DAY))).toBe(NOTE);
    });
});

describe('a note at a path as a place', () => {
    const TASKS = { heading: 'Tasks', level: 2, side: 'head' } as const;
    const at = (path: string, spot: NoteSpot): CreatePlace => ({ kind: 'note', note: { kind: 'path', path }, spot });

    /** The facts of `place`, and what the index reads of the line once the write puts it there. */
    async function factsAndWritten(files: Record<string, string>, place: CreatePlace) {
        const { contents, session, places: p } = await places(files);
        const facts = await p.facts(place);
        expect((await p.create(place, { line: '- [ ] 新しい' }, { tellRefusal: false })).written).toBe(true);
        const written = session.index.getTasks().find(task => task.content === '新しい')!;
        return { contents, facts, written };
    }

    it('there, with the heading: the line goes at its head, or its end as the section says', async () => {
        const { places: p } = await places({ 'n.md': '# n\n## Tasks\n- [ ] 既存\n' });
        expect(await p.facts(at('n.md', TASKS))).toMatchObject({ kind: 'note', path: 'n.md', spot: TASKS, note: 'existing', seed: 'empty', heading: { kind: 'one' }, ignored: false });
        expect(await p.facts(at('n.md', { ...TASKS, side: 'end' }))).toMatchObject({ spot: { side: 'end' }, heading: { kind: 'one' } });
    });

    it('there without the heading, or with it twice: made by the write, or no one place', async () => {
        const { places: p } = await places({ 'n.md': '# n\n', 'twice.md': '## Tasks\n## Tasks\n' });
        expect(await p.facts(at('n.md', TASKS))).toMatchObject({ note: 'existing', heading: { kind: 'none' } });
        expect(await p.facts(at('twice.md', TASKS))).toMatchObject({ heading: { kind: 'many', count: 2 }, inherits: {} });
    });

    it('there, at its end: inherits what the last section gives, as the index reads the line once written', async () => {
        const { contents, facts, written } = await factsAndWritten(
            { 'n.md': ['---', 'tv-due: "2031-01-20"', '---', '## Work', '- tv-color:: ff0000', '- [ ] 既存', ''].join('\n') },
            at('n.md', 'end'),
        );
        expect(facts).toMatchObject({ spot: 'end', note: 'existing', heading: null, inherits: { due: '2031-01-20', color: 'ff0000' } });
        expect(facts.inherits).toEqual(written.cascadeContext);
        expect(facts.inheritedFrom).toEqual(written.inheritedFrom);
        expect(contents.get('n.md')).toMatch(/- \[ \] 既存\n- \[ \] 新しい\n$/);
    });

    it('there, under a heading among sections that give a line different values: what that section gives, as the index reads the line once written', async () => {
        const { facts, written } = await factsAndWritten(
            { 'n.md': ['## Work', '- tv-color:: ff0000', '- [ ] 既存', '## Tasks', '- tv-color:: 00ff00', '- [ ] 既存', '## Log', '- tv-color:: 0000ff', ''].join('\n') },
            at('n.md', TASKS),
        );
        expect(facts.inherits.color).toBe('00ff00');
        expect(facts.inherits).toEqual(written.cascadeContext);
        expect(facts.inheritedFrom).toEqual(written.inheritedFrom);
    });

    it('not there, under a heading: an empty note made with the heading, as the index reads the line once written', async () => {
        const { contents, facts, written } = await factsAndWritten({}, at('new.md', TASKS));
        expect(facts).toMatchObject({ kind: 'note', path: 'new.md', note: 'new', seed: 'empty', heading: { kind: 'none' }, ignored: false, inherits: {} });
        expect(facts.inherits).toEqual(written.cascadeContext ?? {});
        expect(contents.get('new.md')).toBe('## Tasks\n- [ ] 新しい\n');
    });

    it('not there, at its end: an empty note made with the line alone', async () => {
        const { contents, facts, written } = await factsAndWritten({}, at('new.md', 'end'));
        expect(facts).toMatchObject({ note: 'new', seed: 'empty', heading: null, inherits: {} });
        expect(facts.inherits).toEqual(written.cascadeContext ?? {});
        expect(contents.get('new.md')).toBe('- [ ] 新しい\n');
    });

    it('not there, in folders not there: the note made at its path, the folders with it', async () => {
        const { contents } = await factsAndWritten({}, at('a/b/new.md', 'end'));
        expect(contents.get('a/b/new.md')).toBe('- [ ] 新しい\n');
    });

    it('a note the views do not read (tv-ignore): said as such', async () => {
        const { places: p } = await places({ 'n.md': ['---', 'tv-ignore: true', '---', '## Tasks', ''].join('\n') });
        expect(await p.facts(at('n.md', 'end'))).toMatchObject({ ignored: true, inherits: {} });
    });

    it('a path that is the day\'s note is still a note made empty, not of the template', async () => {
        const { contents, places: p } = await places({
            [TEMPLATE]: ['# {{title}}', ''].join('\n'),
        }, 'Templates/Daily');
        expect(await p.facts(at(NOTE, 'end'))).toMatchObject({ note: 'new', seed: 'empty' });
        await p.create(at(NOTE, 'end'), { line: '- [ ] 空' }, { tellRefusal: false });
        expect(contents.get(NOTE)).toBe('- [ ] 空\n');
    });
});

describe('the place a note and a spot chosen name', () => {
    const TASKS = { heading: 'Tasks', level: 2, side: 'head' } as const;

    it('a note there, under its heading: the line written there', async () => {
        const { contents, places: p } = await places({ 'n.md': '# n\n## Tasks\n- [ ] 既存\n' });
        const place = p.fromDestination({ note: { kind: 'existing', path: 'n.md' }, spot: TASKS });
        expect(place).toEqual({ kind: 'note', note: { kind: 'path', path: 'n.md' }, spot: TASKS });
        await p.create(place, { line: '- [ ] 新しい' }, { tellRefusal: false });
        expect(contents.get('n.md')).toBe('# n\n## Tasks\n- [ ] 新しい\n- [ ] 既存\n');
    });

    it('a note there, at its end: the line written after its last', async () => {
        const { contents, places: p } = await places({ 'n.md': '## Tasks\n- [ ] 既存\n## Other\n' });
        const place = p.fromDestination({ note: { kind: 'existing', path: 'n.md' }, spot: 'end' });
        await p.create(place, { line: '- [ ] 新しい' }, { tellRefusal: false });
        expect(contents.get('n.md')).toBe('## Tasks\n- [ ] 既存\n## Other\n- [ ] 新しい\n');
    });

    it('a note not there: made empty with the heading, even at the path of a daily note not there', async () => {
        const { contents, places: p } = await places({ [TEMPLATE]: '# {{title}}\n' }, 'Templates/Daily');
        const place = p.fromDestination({ note: { kind: 'new', path: NOTE }, spot: TASKS });
        expect(await p.facts(place)).toMatchObject({ note: 'new', seed: 'empty', heading: { kind: 'none' } });
        await p.create(place, { line: '- [ ] 新しい' }, { tellRefusal: false });
        expect(contents.get(NOTE)).toBe('## Tasks\n- [ ] 新しい\n');
    });

    it('in the note a place is in already: that place, its spot alone the answer\'s, a daily note still made of its template', async () => {
        const { contents, places: p } = await places({ [TEMPLATE]: '# {{title}}\n' }, 'Templates/Daily');
        const daily = p.dailyNote(DAY);
        const place = p.fromDestination({ note: { kind: 'new', path: NOTE }, spot: 'end' }, daily);
        expect(place).toEqual({ kind: 'note', note: { kind: 'daily', date: DAY }, spot: 'end' });
        await p.create(place, { line: '- [ ] 新しい' }, { tellRefusal: false });
        expect(contents.get(NOTE)).toBe('# 2031-01-15\n- [ ] 新しい\n');
    });

    it('in another note than a place is in: the note chosen, by its path', async () => {
        const { places: p } = await places({});
        expect(p.fromDestination({ note: { kind: 'new', path: 'other.md' }, spot: 'end' }, p.dailyNote(DAY)))
            .toEqual({ kind: 'note', note: { kind: 'path', path: 'other.md' }, spot: 'end' });
    });
});

describe('the head of a row\'s children as a place', () => {
    const LINES = ['## Work', '- tv-start:: 2031-02-01', '- [ ] 親', '    - [ ] 子', ''].join('\n');

    it('inherits what the parent\'s section gives, not the parent\'s own dates', async () => {
        const { session, places: p } = await places({ 'n.md': LINES.replace('親', '親 @2031-03-01') });
        const parent = session.index.getTasks().find(task => task.content === '親')!;
        const facts = await p.facts({ kind: 'childOf', taskId: parent.id });
        expect(facts).toMatchObject({ kind: 'childOf', parent: '親', inherits: { startDate: '2031-02-01' } });
        expect(Object.keys(facts.inherits)).toEqual(['startDate']);
    });

    it('says where each inherited value comes from as the reading says it of the children there', async () => {
        const { session, places: p } = await places({ 'n.md': LINES });
        const parent = session.index.getTasks().find(task => task.content === '親')!;
        const child = session.index.getTasks().find(task => task.content === '子')!;
        const facts = await p.facts({ kind: 'childOf', taskId: parent.id });
        expect(facts.inheritedFrom?.fields.startDate).toMatchObject({ kind: 'section', line: 1 });
        expect(facts.inheritedFrom).toEqual(child.inheritedFrom);
    });

    it('a row no longer in the index: gone', async () => {
        const { places: p } = await places({ 'n.md': LINES });
        expect(await p.facts({ kind: 'childOf', taskId: 'nothing' })).toEqual({ kind: 'gone', inherits: {} });
    });

    it('the write puts the line first among the children', async () => {
        const { contents, session, places: p } = await places({ 'n.md': LINES });
        const parent = session.index.getTasks().find(task => task.content === '親')!;
        expect((await p.create({ kind: 'childOf', taskId: parent.id }, { line: '- [ ] 先頭' })).written).toBe(true);
        expect(contents.get('n.md')).toBe(['## Work', '- tv-start:: 2031-02-01', '- [ ] 親', '    - [ ] 先頭', '    - [ ] 子', ''].join('\n'));
    });
});
