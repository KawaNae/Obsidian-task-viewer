import { describe, it, expect, vi, afterEach } from 'vitest';
import realMoment from 'moment';
import { Notice } from '../mocks/obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { DEFAULT_SETTINGS } from '../../../src/types';

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<typeof import('../mocks/obsidian')>('../mocks/obsidian');
    return { ...actual, moment: realMoment };
});

/**
 * A row put in a note (`Operations.putInNote`) and in the daily note
 * (`Operations.putInDailyNote`): a refusal told the user once, or not at all
 * when the caller tells it; and the daily note's section, the one the
 * settings name, at their level and side.
 */

const FILE = 'note.md';
const DAY = '2031-01-15';
const DAILY = `${DAY}.md`;
const TASKS = { heading: 'Tasks', level: 2, side: 'head' } as const;
const TWO = ['## Tasks', '- [ ] a', '## Tasks', ''];

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

async function open(files: Record<string, string[]>) {
    const opened = await openVault(files);
    live = opened.session;
    // The daily notes as the core plugin's options name them.
    (opened.session.app as unknown as { internalPlugins: unknown }).internalPlugins = {
        getPluginById: (id: string) => (id === 'daily-notes' ? { instance: { options: { format: 'YYYY-MM-DD', folder: '' } } } : null),
    };
    Notice.messages.length = 0;
    return opened;
}

describe('a refusal of a row put in a note', () => {
    it('is told once, and not at all when the caller tells it (tellRefusal: false), the refusal answered either way', async () => {
        for (const tellRefusal of [undefined, false]) {
            live?.dispose();
            const { contents, session } = await open({ [FILE]: TWO });
            const before = contents.get(FILE);

            const answer = await session.ops.putInNote(FILE, TASKS, { line: '- [ ] N' }, tellRefusal === false ? { tellRefusal } : {});

            expect(answer).toMatchObject({ written: false, refused: { reason: { kind: 'headings', name: 'Tasks', count: 2 } } });
            expect(Notice.messages).toHaveLength(tellRefusal === false ? 0 : 1);
            expect(contents.get(FILE)).toBe(before);
        }
    });

    it('in the daily note: told once, and not at all when the caller tells it (tellRefusal: false)', async () => {
        for (const tellRefusal of [undefined, false]) {
            live?.dispose();
            const { contents, session } = await open({ [DAILY]: TWO });
            const before = contents.get(DAILY);

            const answer = await session.ops.putInDailyNote(DAY, { line: '- [ ] N' }, tellRefusal === false ? { tellRefusal } : {});

            expect(answer).toMatchObject({ written: false, refused: { reason: { kind: 'headings', name: 'Tasks', count: 2 } } });
            expect(Notice.messages).toHaveLength(tellRefusal === false ? 0 : 1);
            expect(contents.get(DAILY)).toBe(before);
        }
    });
});

describe('a row put in the daily note', () => {
    const LOG = { ...DEFAULT_SETTINGS, taskHeading: 'Log', taskHeadingLevel: 3, sectionSide: 'end' as const };

    it('goes in the section the settings name, at their side, the heading at any level', async () => {
        const { contents, session } = await open({ [DAILY]: ['# d', '## Log', '- [ ] a', '## Tasks', '- [ ] t', ''] });
        session.index.updateSettings(LOG);

        expect(await session.ops.putInDailyNote(DAY, { line: '- [ ] N' })).toEqual({ written: true, path: DAILY });
        await session.settle(DAILY);

        expect(contents.get(DAILY)!.split('\n')).toEqual(['# d', '## Log', '- [ ] a', '- [ ] N', '## Tasks', '- [ ] t', '']);
    });

    it('makes the heading the settings name, at their level, when the note has none by it', async () => {
        const { contents, session } = await open({ [DAILY]: ['# d', '## Tasks', '- [ ] t', ''] });
        session.index.updateSettings(LOG);

        expect(await session.ops.putInDailyNote(DAY, { line: '- [ ] N' })).toEqual({ written: true, path: DAILY });
        await session.settle(DAILY);

        expect(contents.get(DAILY)!.split('\n')).toEqual(['# d', '## Tasks', '- [ ] t', '', '### Log', '- [ ] N', '']);
    });
});
