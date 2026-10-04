import { describe, it, expect, vi, afterEach } from 'vitest';
import realMoment from 'moment';
import { CreatePlaces } from '../../../src/services/data/CreatePlaces';
import { DEFAULT_SETTINGS, type TaskViewerSettings } from '../../../src/types';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../mocks/obsidian')>('../mocks/obsidian');
    return { ...actual, moment: realMoment };
});

/**
 * What the create dialog is told of a place before the line is written
 * (`CreatePlaces.facts`): where the line goes, and what it inherits there —
 * what the reading gives the line once it is written, and nothing else (the
 * decision of 2026-10-04, 論点1: a daily note's day is not given).
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
        const facts = await p.facts({ kind: 'dailyNote', date: DAY });
        expect(facts).toMatchObject({ kind: 'dailyNote', path: NOTE, note: 'existing', heading: { kind: 'one' }, ignored: false, inherits: {} });
    });

    it('inherits what the frontmatter and the section give a line put there', async () => {
        const { places: p } = await places({
            [NOTE]: ['---', 'tv-start: "2031-01-15"', '---', '## Tasks', '- tv-start:: 10:00', '- tv-color:: ff0000', '- [ ] 既存', ''].join('\n'),
        });
        const facts = await p.facts({ kind: 'dailyNote', date: DAY });
        expect(facts.inherits).toMatchObject({ startDate: '2031-01-15', startTime: '10:00', color: 'ff0000' });
    });

    it('there without the heading: the write makes it at the end, where the line inherits the frontmatter', async () => {
        const { places: p } = await places({ [NOTE]: ['---', 'tv-due: "2031-01-20"', '---', '# day', ''].join('\n') });
        const facts = await p.facts({ kind: 'dailyNote', date: DAY });
        expect(facts).toMatchObject({ note: 'existing', heading: { kind: 'none' }, inherits: { due: '2031-01-20' } });
    });

    it('with the heading twice: no one place, and nothing inherited', async () => {
        const { places: p } = await places({ [NOTE]: '## Tasks\n## Tasks\n' });
        const facts = await p.facts({ kind: 'dailyNote', date: DAY });
        expect(facts).toMatchObject({ heading: { kind: 'many', count: 2 }, inherits: {} });
    });

    it('not there: read as its template makes it for the day', async () => {
        const { places: p } = await places({
            [TEMPLATE]: ['# {{title}}', '## Tasks', '- tv-start:: 09:00', ''].join('\n'),
        }, 'Templates/Daily');
        const facts = await p.facts({ kind: 'dailyNote', date: DAY });
        expect(facts).toMatchObject({ kind: 'dailyNote', path: NOTE, note: 'new', heading: { kind: 'one' }, inherits: { startTime: '09:00' } });
    });

    it('a note the views do not read (tv-ignore): said as such', async () => {
        const { places: p } = await places({ [NOTE]: ['---', 'tv-ignore: true', '---', '## Tasks', ''].join('\n') });
        const facts = await p.facts({ kind: 'dailyNote', date: DAY });
        expect(facts).toMatchObject({ ignored: true, inherits: {} });
    });

    it('the write puts the line under the heading, the note made when it is not there', async () => {
        const { contents, places: p } = await places({});
        const answer = await p.create({ kind: 'dailyNote', date: DAY }, '- [ ] 新しい @10:00', { tellRefusal: false });
        expect(answer.written).toBe(true);
        expect(contents.get(NOTE)).toBe('## Tasks\n- [ ] 新しい @10:00\n');
    });
});

describe('the head of a row\'s children as a place', () => {
    const LINES = ['## Work', '- tv-start:: 2031-02-01', '- [ ] 親', '    - [ ] 子', ''].join('\n');

    it('inherits what the parent\'s section gives, not the parent\'s own dates', async () => {
        const { session, places: p } = await places({ 'n.md': LINES.replace('親', '親 @2031-03-01') });
        const parent = session.index.getTasks().find(task => task.content === '親')!;
        const facts = await p.facts({ kind: 'childOf', taskId: parent.id });
        expect(facts).toEqual({ kind: 'childOf', parent: '親', inherits: { startDate: '2031-02-01' } });
    });

    it('a row no longer in the index: gone', async () => {
        const { places: p } = await places({ 'n.md': LINES });
        expect(await p.facts({ kind: 'childOf', taskId: 'nothing' })).toEqual({ kind: 'gone', inherits: {} });
    });

    it('the write puts the line first among the children', async () => {
        const { contents, session, places: p } = await places({ 'n.md': LINES });
        const parent = session.index.getTasks().find(task => task.content === '親')!;
        expect((await p.create({ kind: 'childOf', taskId: parent.id }, '- [ ] 先頭')).written).toBe(true);
        expect(contents.get('n.md')).toBe(['## Work', '- tv-start:: 2031-02-01', '- [ ] 親', '    - [ ] 先頭', '    - [ ] 子', ''].join('\n'));
    });
});
