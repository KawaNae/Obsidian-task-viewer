import { describe, it, expect, vi } from 'vitest';
import { TFolder } from 'obsidian';
import { contentKeyOf } from '../../../src/services/core/ContentKey';
import { writeBench, FILE } from '../helpers/writeBench';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import { FrontmatterWriter } from '../../../src/services/persistence/writers/FrontmatterWriter';
import { putInNote } from '../../../src/services/persistence/Notes';
import { Block } from '../../../src/services/persistence/utils/Placement';
import { editorRow, createFile } from '../../../src/services/persistence/FileLines';

/**
 * The two writes that do not go through `processLines`: one whose file is not
 * there to open, and one that creates the file. Each answers with its outcome
 * and tells a refusal to the channel exactly once — the channel is what puts
 * the reason in front of the user, so a refusal it is not told is a silent one.
 */

describe('a write whose file is not there', () => {
    const TASK = '- [ ] 消える @2026-09-21';

    /** A bench whose note was scanned, then taken away (or replaced by a folder). */
    async function benchWithout(kind: 'missing' | 'folder') {
        const b = await writeBench(['# note', TASK]);
        const task = b.taskAt(1);
        if (kind === 'missing') {
            b.contents.delete(FILE);
        } else {
            // A folder by that name: not a TFile.
            b.app.vault.getAbstractFileByPath = (path: string) =>
                (path === FILE ? { path, children: [] } : null);
        }
        return { b, task };
    }

    it.each(['missing', 'folder'] as const)('%s: a write to the line the editor pointed at is refused as gone, told once', async (kind) => {
        const { b } = await benchWithout(kind);

        const outcome = await b.writer.write(FILE, editorRow(1, TASK, contentKeyOf([])), [{ kind: 'update', text: '- [x] 消える @2026-09-21' }]);

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'gone' });
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'gone' }, subject: '- [ ] 消える @2026-09-21' }]);
        expect(b.filed).toEqual([]);
    });

    it.each(['missing', 'folder'] as const)('%s: a remove is refused as gone, told once', async (kind) => {
        const { b, task } = await benchWithout(kind);

        const outcome = await b.writer.write(task.file, plannedOn(task, { subtree: true }), [{ kind: 'remove' }]);

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'gone' });
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'gone' }, subject: '消える' }]);
    });

    it.each(['missing', 'folder'] as const)('%s: FrontmatterWriter.setKeys is refused as gone, told once', async (kind) => {
        const { b } = await benchWithout(kind);
        const writer = new FrontmatterWriter(b.app, (path) => b.repo.channelOf(path));

        const outcome = await writer.setKeys(FILE, { color: 'red' });

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'gone' });
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'gone' }, subject: FILE }]);
    });

    it('putInNote without a note to make is refused as gone, told once', async () => {
        const { b } = await benchWithout('missing');

        const outcome = await putInNote(b.app, FILE, b.channel(FILE), {
            where: { heading: 'Tasks', level: 2, side: 'head' }, block: Block.line('- [ ] 新しい'),
        });

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'gone' });
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'gone' }, subject: '- [ ] 新しい' }]);
    });
});

describe('creating a note', () => {
    const NEW = 'new.md';
    const CONTENT = '- [ ] 新しいタスク';
    /** A task created with no heading (the API's): at the end, the note made empty when it is not there. */
    const append = (b: { repo: { putInNote: (...args: any[]) => Promise<any> } }, path: string, text: string) =>
        b.repo.putInNote(path, 'end', Block.read([text]), { create: () => '' });

    /** A bench whose `vault.create` throws, having first left `left` at the path (or nothing). */
    async function benchCreateThrows(left: string | null) {
        const b = await writeBench({ [FILE]: '# note' });
        b.app.vault.create = async (path: string) => {
            if (left !== null) b.contents.set(path, left);
            throw new Error('create failed');
        };
        return b;
    }

    it('createFile: a create that threw and left no note is refused as failed, told once', async () => {
        const b = await benchCreateThrows(null);

        const outcome = await createFile(b.app, NEW, b.channel(NEW), '新しいタスク', () => CONTENT);

        expect(outcome.written).toBe(false);
        expect(outcome.refused).toEqual({ file: NEW, reason: { kind: 'failed' }, subject: '新しいタスク' });
        expect(b.refused).toEqual([{ file: NEW, reason: { kind: 'failed' }, subject: '新しいタスク' }]);
    });

    it('createFile: a create that threw and left a note reading otherwise is refused as failed', async () => {
        const b = await benchCreateThrows('別の中身');

        const outcome = await createFile(b.app, NEW, b.channel(NEW), '新しいタスク', () => CONTENT);

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'failed' });
        expect(b.refused).toHaveLength(1);
    });

    it('createFile: a create that threw but left the note as asked is written, nothing told', async () => {
        const b = await benchCreateThrows(CONTENT);

        const outcome = await createFile(b.app, NEW, b.channel(NEW), '新しいタスク', () => CONTENT);

        expect(outcome.written).toBe(true);
        expect(b.refused).toEqual([]);
    });

    it('createFile: content that could not be made (a folder, a template) is refused as failed, told once, and nothing created', async () => {
        const b = await writeBench({ [FILE]: '# note' });
        const create = vi.spyOn(b.app.vault, 'create');

        const outcome = await createFile(b.app, NEW, b.channel(NEW), '新しいタスク', async () => {
            throw new Error('template unreadable');
        });

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'failed' });
        expect(b.refused).toHaveLength(1);
        expect(create).not.toHaveBeenCalled();
    });

    it('an append: a note that could not be created is refused as failed, told once', async () => {
        const b = await benchCreateThrows(null);

        const outcome = await append(b, NEW, CONTENT);

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'failed' });
        expect(b.refused).toEqual([{ file: NEW, reason: { kind: 'failed' }, subject: CONTENT }]);
    });

    it('an append: a create that threw but left the note as asked is written on line 0', async () => {
        const b = await benchCreateThrows(CONTENT + '\n');

        const outcome = await append(b, NEW, CONTENT);

        expect(outcome.written).toBe(true);
        expect(outcome.written && outcome.line).toBe(0);
        expect(b.refused).toEqual([]);
    });

    it('an append: a create that did not throw is written, the note ending with a terminator as a note appended to does', async () => {
        const b = await writeBench({ [FILE]: '# note' });

        const outcome = await append(b, NEW, CONTENT);

        expect(outcome.written).toBe(true);
        // Made of the lines of an empty note, `['']`: until stage 4 it was
        // made of none, and ended without a terminator (decided, 論点5).
        expect(b.text(NEW)).toBe(CONTENT + '\n');
        expect(b.refused).toEqual([]);
    });

    it('an append: a note is made only of lines that read there as put, as when they are appended to an empty note', async () => {
        // By itself, four spaces make the line code; at the top of a note, unindented, it would be a task.
        const CODE = '    - [ ] 字下げ';
        const b = await writeBench({ [FILE]: '' });
        const create = vi.spyOn(b.app.vault, 'create');

        const appended = await append(b, FILE, CODE);
        const made = await append(b, NEW, CODE);

        expect(appended.refused?.reason).toEqual({ kind: 'unplaceable', fence: null });
        expect(made.refused).toEqual({ file: NEW, reason: { kind: 'unplaceable', fence: null }, subject: CODE.trim() });
        expect(create).not.toHaveBeenCalled();
        expect(b.refused).toHaveLength(2);
    });

    describe('createFile makes the folders the path names', () => {
        /** A bench whose vault holds the folders `held`, and records each folder it is asked to create. */
        async function benchWithFolders(held: string[], createFolder?: (path: string) => Promise<void>) {
            const b = await writeBench({ [FILE]: '# note' });
            const folders = new Set(held);
            const asked: string[] = [];
            const lookup = b.app.vault.getAbstractFileByPath;
            b.app.vault.getAbstractFileByPath = (path: string) =>
                (folders.has(path) ? Object.assign(new TFolder(), { path }) : lookup(path));
            b.app.vault.createFolder = async (path: string) => {
                asked.push(path);
                if (createFolder) return createFolder(path);
                folders.add(path);
            };
            return { b, asked, folders };
        }

        it('creates the missing folders from the top, before the note', async () => {
            const { b, asked } = await benchWithFolders(['a']);

            const outcome = await createFile(b.app, 'a/b/c/new.md', b.channel('a/b/c/new.md'), 'new', () => CONTENT);

            expect(outcome.written).toBe(true);
            expect(asked).toEqual(['a/b', 'a/b/c']);
            expect(b.text('a/b/c/new.md')).toBe(CONTENT);
        });

        it('takes a folder another write made meanwhile as there, by the vault holding it', async () => {
            const { b, folders } = await benchWithFolders([], async (path) => {
                folders.add(path);
                throw new Error('Folder already exists.');
            });

            const outcome = await createFile(b.app, 'x/new.md', b.channel('x/new.md'), 'new', () => CONTENT);

            expect(outcome.written).toBe(true);
            expect(b.refused).toEqual([]);
        });

        it('a folder that could not be made fails the write, told once, and nothing created', async () => {
            const { b } = await benchWithFolders([], async () => { throw new Error('Folder already exists.'); });
            const create = vi.spyOn(b.app.vault, 'create');

            const outcome = await createFile(b.app, 'x/new.md', b.channel('x/new.md'), 'new', () => CONTENT);

            expect(outcome.refused?.reason).toEqual({ kind: 'failed' });
            expect(b.refused).toHaveLength(1);
            expect(create).not.toHaveBeenCalled();
        });
    });
});
