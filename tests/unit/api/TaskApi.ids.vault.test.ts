import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { TaskApi } from '../../../src/api/TaskApi';
import { TaskApiError } from '../../../src/api/TaskApiTypes';
import { readApiId } from '../../../src/api/TaskIds';
import { TaskReadService } from '../../../src/services/data/TaskReadService';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { openVault, makeFile, vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * The API's and the CLI's task IDs (the names and IDs decision, 2026-09-25).
 * An anchored row — its line's `^id` carried by no other line of the file —
 * goes out as `path#^id`, and that ID lasts across edits from outside. Any
 * other row goes out under its name, which lasts until its file changes other
 * than by a write of ours. `parentId` and `childIds` go out the same way, and
 * a write by either shape passes the one check every write passes.
 */

const FILE = 'note.md';

let live: VaultSession[] = [];

afterEach(() => {
    for (const session of live) session.dispose();
    live = [];
    Notice.messages.length = 0;
});

async function open(lines: string[]) {
    const { contents, session } = await openVault(lines);
    live.push(session);
    return { contents, session, api: apiOver(session) };
}

function apiOver(session: VaultSession): TaskApi {
    const plugin = {
        app: session.app,
        settings: { startHour: 0 },
        getTaskReadService: () => new TaskReadService(session.index, 0),
        getTaskWriteService: () => new TaskWriteService(session.index),
    };
    return new TaskApi(plugin as never);
}

async function listed(api: TaskApi) {
    const { tasks } = await api.list();
    return new Map(tasks.map(task => [task.content, task]));
}

function nameOf(session: VaultSession, content: string): string {
    const found = session.index.getTasks().filter(task => task.content === content);
    expect(found).toHaveLength(1);
    return found[0].id;
}

describe('the IDs the API hands out', () => {
    it('are path#^id for an anchored row and the name for any other, parent and children included', async () => {
        const { session, api } = await open([
            '- [ ] P ^parent',
            '    - [ ] C1',
            '    - [ ] C2 ^child',
            '- [ ] Q ^twice',
            '- [ ] R ^twice',
            '',
        ]);
        const tasks = await listed(api);

        expect(tasks.get('P')?.id).toBe('note.md#^parent');
        expect(tasks.get('C1')?.id).toBe(nameOf(session, 'C1'));
        expect(tasks.get('C2')?.id).toBe('note.md#^child');
        // A ^id two lines carry anchors neither.
        expect(tasks.get('Q')?.id).toBe(nameOf(session, 'Q'));
        expect(tasks.get('R')?.id).toBe(nameOf(session, 'R'));

        expect(tasks.get('P')?.childIds).toEqual([nameOf(session, 'C1'), 'note.md#^child']);
        expect(tasks.get('C1')?.parentId).toBe('note.md#^parent');
        expect(tasks.get('C2')?.parentId).toBe('note.md#^parent');
        expect(api.get({ id: 'note.md#^child' }).parentId).toBe('note.md#^parent');
    });
});

describe('an anchored ID', () => {
    it('finds its row after an edit from outside the scan has read, and writes it there', async () => {
        const { contents, session, api } = await open(['- [ ] A', '- [ ] A ^keep', '']);
        contents.set(FILE, ['メモ', '- [ ] A ^keep', '- [ ] A', ''].join('\n'));
        await session.scanner.queueScan(makeFile(FILE));

        expect(api.get({ id: 'note.md#^keep' }).line).toBe(1);
        const { task } = await api.update({ id: 'note.md#^keep', status: 'x' });
        expect(task.id).toBe('note.md#^keep');
        expect(contents.get(FILE)).toBe(['メモ', '- [x] A ^keep', '- [ ] A', ''].join('\n'));
    });

    it('is refused, and the file left as it is, while the file holds an edit the scan has not read', async () => {
        const { contents, api } = await open(['- [ ] A ^keep', '- [ ] A', '']);
        const edited = ['- [ ] A ^keep', '- [ ] A', '- [ ] B', ''].join('\n');
        contents.set(FILE, edited);

        await expect(api.update({ id: 'note.md#^keep', status: 'x' })).rejects.toThrow(/could not be written/);
        expect(contents.get(FILE)).toBe(edited);
    });

    it('names nothing once its ^id is gone or no longer alone, and says so', async () => {
        const { contents, session, api } = await open(['- [ ] A ^keep', '']);
        contents.set(FILE, ['- [ ] A ^keep', '- [ ] B ^keep', ''].join('\n'));
        await session.scanner.queueScan(makeFile(FILE));

        expect(() => api.get({ id: 'note.md#^keep' })).toThrow(TaskApiError);
        expect(() => api.get({ id: 'note.md#^keep' })).toThrow('Task not found: note.md#^keep (no line of note.md carries ^keep alone)');
        expect(() => api.get({ id: 'other.md#^keep' })).toThrow(/Task not found/);
    });
});

describe('a name the API handed out', () => {
    it('is refused once the file changed other than by a write of ours', async () => {
        const { contents, session, api } = await open(['- [ ] A', '']);
        const id = (await listed(api)).get('A')!.id;
        contents.set(FILE, ['メモ', '- [ ] A', ''].join('\n'));
        await session.scanner.queueScan(makeFile(FILE));

        await expect(api.update({ id, status: 'x' })).rejects.toThrow(
            `Task not found: ${id} (an ID without a ^id lasts only until its file changes; list the tasks again)`);
        expect(contents.get(FILE)).toBe(['メモ', '- [ ] A', ''].join('\n'));
    });

    it('comes back from an update as the row\'s new name, which the next call takes', async () => {
        const { contents, api } = await open(['- [ ] A', '- [ ] B', '']);
        const first = (await listed(api)).get('B')!.id;

        const { task } = await api.update({ id: first, status: 'x' });
        expect(task.id).not.toBe(first);
        expect(task.status).toBe('x');

        const again = await api.update({ id: task.id, content: 'B2' });
        expect(again.task.content).toBe('B2');
        expect(contents.get(FILE)).toBe(['- [ ] A', '- [x] B2', ''].join('\n'));
    });
});

describe('an ID without a ^id, after our writes brought the file back to a content it had', () => {
    it('goes to its row, not to the copy on its old line: delete the first twin, duplicate the second', async () => {
        const { contents, api } = await open(['- [ ] A', '- [ ] A', '']);
        const [r1, r2] = (await api.list()).tasks.map(task => task.id);

        await api.delete({ id: r1 });
        await api.duplicate({ id: r2 });
        expect(contents.get(FILE)).toBe(['- [ ] A', '- [ ] A', ''].join('\n'));

        await api.update({ id: r2, content: 'A2' });
        expect(contents.get(FILE)).toBe(['- [ ] A2', '- [ ] A', ''].join('\n'));
    });

    it('is refused once the row is gone, though a copy of it stands on its line: duplicate, delete, update', async () => {
        const { contents, api } = await open(['- [ ] B', '- [ ] other', '']);
        const id = (await listed(api)).get('B')!.id;

        await api.duplicate({ id });
        await api.delete({ id });
        const back = contents.get(FILE);
        expect(back).toBe(['- [ ] B', '- [ ] other', ''].join('\n'));

        await expect(api.update({ id, status: 'x' })).rejects.toThrow(TaskApiError);
        expect(contents.get(FILE)).toBe(back);
    });

    it('names nothing after a reload, the content the same', async () => {
        const { contents, api } = await open(['- [ ] A', '']);
        const id = (await api.list()).tasks[0].id;
        const before = contents.get(FILE);

        const reloaded = vaultSession(contents);
        live.push(reloaded);
        await reloaded.scanAll();
        const again = apiOver(reloaded);
        expect((await again.list()).tasks[0].id).not.toBe(id);
        await expect(again.update({ id, status: 'x' })).rejects.toThrow(TaskApiError);
        expect(contents.get(FILE)).toBe(before);
    });
});

describe('readApiId', () => {
    it('tells the two shapes apart, taking the last #^ of a path that holds #', () => {
        expect(readApiId('a#b.md#^x-1')).toEqual({ kind: 'anchor', file: 'a#b.md', anchor: 'x-1' });
        expect(readApiId('tv-inline:note.md:n:mugdzal02.3:0')).toEqual({
            kind: 'name', name: 'tv-inline:note.md:n:mugdzal02.3:0',
        });
    });
});
