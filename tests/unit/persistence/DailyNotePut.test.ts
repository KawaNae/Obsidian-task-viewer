import { describe, it, expect, vi, beforeAll } from 'vitest';
import realMoment from 'moment';
import { TFolder } from 'obsidian';
import { openPeriodicNote, putInPeriodicNote } from '../../../src/services/persistence/Notes';
import { dailyNotes, periodicNotes } from '../../../src/utils/PeriodicNotes';
import { registerWeekStartLocales } from '../../../src/utils/momentWeekLocale';
import { writeBench, FILE } from '../helpers/writeBench';

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../mocks/obsidian')>('../mocks/obsidian');
    return { ...actual, moment: realMoment };
});

beforeAll(() => {
    registerWeekStartLocales();
});

const LOG = { heading: 'Log', level: 2, side: 'end' as const };
const DAY = '2026-10-01';

/** A bench with the daily notes set to `options`, a template at `Templates/Daily.md` holding `template`, and folders made on asking. */
async function dailyBench(options: Record<string, string>, template?: string) {
    const b = await writeBench(template === undefined ? { [FILE]: '# note' } : { [FILE]: '# note', 'Templates/Daily.md': template });
    const folders = new Set<string>();
    const lookup = b.app.vault.getAbstractFileByPath;
    b.app.vault.getAbstractFileByPath = (path: string) =>
        (folders.has(path) ? Object.assign(new TFolder(), { path }) : lookup(path));
    b.app.vault.createFolder = async (path: string) => { folders.add(path); };
    b.app.vault.adapter = { exists: async (path: string) => folders.has(path) };
    b.app.internalPlugins = { getPluginById: (id: string) => (id === 'daily-notes' ? { instance: { options } } : null) };
    return b;
}

const put = (b: Awaited<ReturnType<typeof dailyBench>>, line: string) =>
    putInPeriodicNote(b.app, dailyNotes(b.app), DAY, line, LOG, (path) => b.channel(path));

/** `vault.create` answering a turn later and, as Obsidian's does, throwing for a path taken. */
function createLikeObsidian(b: Awaited<ReturnType<typeof dailyBench>>): void {
    const create = b.app.vault.create;
    b.app.vault.create = async (path: string, data: string) => {
        await Promise.resolve();
        if (b.contents.has(path)) throw new Error('File already exists.');
        return create(path, data);
    };
}

/**
 * The note written is the one a create of the template and a write of the
 * line under the heading wrote before they were one create (checked against
 * DailyNoteUtils.appendLineToDailyNote at b452de0e).
 */
describe('a line put in a daily note not there yet: the note written', () => {
    it('without a template', async () => {
        const b = await dailyBench({ format: 'YYYY-MM-DD', folder: 'Daily' });

        expect(await put(b, '- [x] 記録')).toBe(`Daily/${DAY}.md`);

        expect(b.text(`Daily/${DAY}.md`)).toBe('## Log\n- [x] 記録\n');
        expect(b.refused).toEqual([]);
    });

    it('with a template that has the heading', async () => {
        const b = await dailyBench({ format: 'YYYY-MM-DD', folder: 'Daily', template: 'Templates/Daily' }, '# {{title}}\n\n## Log\n- [ ] 既存\n\n## Notes\n');

        expect(await put(b, '- [x] 記録')).toBe(`Daily/${DAY}.md`);

        expect(b.text(`Daily/${DAY}.md`)).toBe(`# ${DAY}\n\n## Log\n- [ ] 既存\n- [x] 記録\n\n## Notes\n`);
    });

    it('with a template that does not end with a terminator', async () => {
        const b = await dailyBench({ format: 'YYYY-MM-DD', folder: 'Daily', template: 'Templates/Daily' }, '# {{title}}');

        expect(await put(b, '- [x] 記録')).toBe(`Daily/${DAY}.md`);

        expect(b.text(`Daily/${DAY}.md`)).toBe(`# ${DAY}\n\n## Log\n- [x] 記録\n`);
    });

    it('with a CRLF template', async () => {
        const b = await dailyBench({ format: 'YYYY-MM-DD', folder: 'Daily', template: 'Templates/Daily' }, '# {{title}}\r\n## Log\r\n');

        expect(await put(b, '- [x] 記録')).toBe(`Daily/${DAY}.md`);

        expect(b.text(`Daily/${DAY}.md`)).toBe(`# ${DAY}\r\n## Log\r\n- [x] 記録\r\n`);
    });
});

describe('a line put in a daily note: the rest', () => {
    it('in a note there, the line goes under the heading and nothing is created', async () => {
        const b = await dailyBench({ format: 'YYYY-MM-DD', folder: 'Daily' });
        b.contents.set(`Daily/${DAY}.md`, '# day\n');
        await b.scan(`Daily/${DAY}.md`);

        expect(await put(b, '- [x] 記録')).toBe(`Daily/${DAY}.md`);

        expect(b.text(`Daily/${DAY}.md`)).toBe('# day\n\n## Log\n- [x] 記録\n');
    });

    it('two lines at once in a note not there yet: both written, in the order asked, neither refused', async () => {
        // Before the note was made and written in one write, the second
        // create passed as "reads as the template" and the two lines landed
        // the other way round.
        const b = await dailyBench({ format: 'YYYY-MM-DD', folder: 'Daily', template: 'Templates/Daily' }, '# {{title}}\n');
        createLikeObsidian(b);

        expect(await Promise.all([put(b, '- [x] first'), put(b, '- [x] second')])).toEqual([`Daily/${DAY}.md`, `Daily/${DAY}.md`]);

        expect(b.text(`Daily/${DAY}.md`)).toBe(`# ${DAY}\n\n## Log\n- [x] first\n- [x] second\n`);
        expect(b.refused).toEqual([]);
    });

    it('a format with `/` in it: the folders it names are made', async () => {
        const b = await dailyBench({ format: 'YYYY/MM/YYYY-MM-DD', folder: 'Journal' });

        expect(await put(b, '- [x] 記録')).toBe(`Journal/2026/10/${DAY}.md`);

        expect(b.text(`Journal/2026/10/${DAY}.md`)).toBe('## Log\n- [x] 記録\n');
    });
});

describe('openPeriodicNote', () => {
    it('answers the note there, and makes one of its template when there is none', async () => {
        const b = await dailyBench({ format: 'YYYY-MM-DD', folder: 'Daily', template: 'Templates/Daily' }, '# {{title}}');

        const made = await openPeriodicNote(b.app, dailyNotes(b.app), DAY, (path) => b.channel(path));
        const again = await openPeriodicNote(b.app, dailyNotes(b.app), DAY, (path) => b.channel(path));

        expect(made?.path).toBe(`Daily/${DAY}.md`);
        expect(again).toBe(made);
        expect(b.text(`Daily/${DAY}.md`)).toBe(`# ${DAY}\n`);
    });

    it('expands a weekly template in the settings\' week', async () => {
        const b = await dailyBench({}, '{{date:gggg-[W]ww}} {{title}}');
        const settings = { weeklyNoteFormat: 'gggg-[W]ww', weeklyNoteFolder: 'Weekly', weeklyNoteTemplate: 'Templates/Daily', weekStartDay: 1 } as any;

        // A Sunday: the last day of the week starting on Monday 2026-08-17.
        const file = await openPeriodicNote(b.app, periodicNotes(settings, 'weekly'), '2026-08-23', (path) => b.channel(path));

        expect(file?.path).toBe('Weekly/2026-W34.md');
        expect(b.text('Weekly/2026-W34.md')).toBe('2026-W34 2026-W34\n');
    });

    it('answers null when the note could not be made, told once', async () => {
        const b = await dailyBench({ format: 'YYYY-MM-DD', folder: 'Daily' });
        b.app.vault.create = async () => { throw new Error('disk full'); };

        expect(await openPeriodicNote(b.app, dailyNotes(b.app), DAY, (path) => b.channel(path))).toBeNull();
        expect(b.refused).toEqual([{ file: `Daily/${DAY}.md`, reason: { kind: 'failed' }, subject: `Daily/${DAY}.md` }]);
    });
});
