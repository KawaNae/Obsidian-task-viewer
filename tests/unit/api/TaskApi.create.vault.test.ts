import { describe, it, expect, afterEach } from 'vitest';
import { TaskApi } from '../../../src/api/TaskApi';
import { TaskApiError } from '../../../src/api/TaskApiTypes';
import { TaskReadService } from '../../../src/services/data/TaskReadService';
import { DEFAULT_SETTINGS, type TaskViewerSettings } from '../../../src/types';
import { openVault, type VaultSession } from '../helpers/vaultSession';

/**
 * Where the API's and the CLI's `create` puts a task: under the heading it
 * names, made at the end of the note when the note has none by the name; at
 * the end of the note when it names none. A note that is not there is
 * refused before anything is written.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

async function open(files: string[] | Record<string, string>, settings: Partial<TaskViewerSettings> = {}) {
    const { contents, session } = await openVault(files);
    live = session;
    const plugin = {
        app: session.app,
        settings: { ...DEFAULT_SETTINGS, startHour: 0, ...settings },
        getTaskReadService: () => new TaskReadService(session.index, () => ({ startHour: 0, weekStartDay: 1 })),
        getIndex: () => session.index,
        getOperations: () => session.ops,
    };
    return { contents, session, api: new TaskApi(plugin as never) };
}

const lines = (contents: Map<string, string>, path = FILE) => contents.get(path)!.split('\n');

describe('the API\'s create', () => {
    it('puts the task under the heading it names, at the settings\' side of the section', async () => {
        const { contents, api } = await open(['# n', '## Tasks', '- [ ] 既存', '## Other', '']);

        const { task } = await api.create({ file: FILE, content: '新', heading: 'Tasks' });

        expect(lines(contents)).toEqual(['# n', '## Tasks', '- [ ] 新', '- [ ] 既存', '## Other', '']);
        expect(task.content).toBe('新');
        expect(task.line).toBe(2);
    });

    it('makes the heading at the end of the note when it has none by the name', async () => {
        const { contents, api } = await open(['# n', 'text', '']);

        await api.create({ file: FILE, content: '新', heading: 'Later' });

        expect(lines(contents)).toEqual(['# n', 'text', '', '## Later', '- [ ] 新', '']);
    });

    it('goes where the settings say: the heading at any level, its section\'s end, a heading made at their level', async () => {
        const { contents, api } = await open(['### h', '- [ ] A', '#### Sub', '- [ ] S', ''], { sectionSide: 'end', taskHeadingLevel: 4 });

        await api.create({ file: FILE, content: 'N', heading: 'H' });
        await api.create({ file: FILE, content: 'M', heading: 'Made' });

        expect(lines(contents)).toEqual(['### h', '- [ ] A', '- [ ] N', '#### Sub', '- [ ] S', '', '#### Made', '- [ ] M', '']);
    });

    it('puts the task at the end of the note when it names no heading', async () => {
        const { contents, api } = await open(['# n', '## Tasks', '- [ ] 既存', '', '## Other', 'text', '']);

        const { task } = await api.create({ file: FILE, content: '新' });

        expect(lines(contents)).toEqual(['# n', '## Tasks', '- [ ] 既存', '', '## Other', 'text', '- [ ] 新', '']);
        expect(task.line).toBe(6);
    });

    it('is refused before anything is written when the note is not there, with a heading or without', async () => {
        const { contents, api } = await open(['# n', '']);
        const before = new Map(contents);

        await expect(api.create({ file: 'missing.md', content: '新', heading: 'Tasks' })).rejects.toThrow(TaskApiError);
        await expect(api.create({ file: 'missing.md', content: '新' })).rejects.toThrow(/File not found: missing\.md/);

        expect(contents).toEqual(before);
    });

    it('is refused, the note left as it was, when two headings go by the name', async () => {
        const { contents, api } = await open(['## Tasks', '- [ ] a', '## Tasks', '']);
        const before = contents.get(FILE);

        await expect(api.create({ file: FILE, content: '新', heading: 'Tasks' })).rejects.toThrow(/could not be written/);

        expect(contents.get(FILE)).toBe(before);
    });
});
