import { describe, it, expect, vi } from 'vitest';
import { contentKeyOf } from '../../../src/services/core/ContentKey';
import { writeBench, FILE } from '../helpers/writeBench';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import { FrontmatterWriter } from '../../../src/services/persistence/writers/FrontmatterWriter';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { HeadingInserter } from '../../../src/utils/HeadingInserter';
import { createFile } from '../../../src/utils/FileLines';

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

        const outcome = await b.writer.applyToLine(FILE, { line: 1, text: TASK, key: contentKeyOf([]) }, [{ kind: 'update', text: '- [x] 消える @2026-09-21' }]);

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'gone' });
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'gone' }, subject: '- [ ] 消える @2026-09-21' }]);
        expect(b.filed).toEqual([]);
    });

    it.each(['missing', 'folder'] as const)('%s: deleteTaskFromFile is refused as gone, told once', async (kind) => {
        const { b, task } = await benchWithout(kind);

        const outcome = await b.writer.deleteTaskFromFile(plannedOn(task, { subtree: true }));

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'gone' });
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'gone' }, subject: '消える' }]);
    });

    it.each(['missing', 'folder'] as const)('%s: FrontmatterWriter.setKeys is refused as gone, told once', async (kind) => {
        const { b } = await benchWithout(kind);
        const writer = new FrontmatterWriter(b.app, new FileOperations(b.app), (path) => b.repo.channelOf(path));

        const outcome = await writer.setKeys(FILE, { color: 'red' });

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'gone' });
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'gone' }, subject: FILE }]);
    });

    it('HeadingInserter.writeUnderHeading is refused as gone, told once', async () => {
        const { b } = await benchWithout('missing');

        const outcome = await HeadingInserter.writeUnderHeading(
            b.app, FILE, b.channel(FILE), '- [ ] 新しい', 'Tasks', 2,
        );

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'gone' });
        expect(b.refused).toEqual([{ file: FILE, reason: { kind: 'gone' }, subject: '- [ ] 新しい' }]);
    });
});

describe('creating a note', () => {
    const NEW = 'new.md';
    const CONTENT = '- [ ] 新しいタスク';

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

    it('appendTaskToFile: a note that could not be created is refused as failed, told once', async () => {
        const b = await benchCreateThrows(null);

        const outcome = await b.writer.appendTaskToFile(NEW, CONTENT, 'user');

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'failed' });
        expect(b.refused).toEqual([{ file: NEW, reason: { kind: 'failed' }, subject: CONTENT }]);
    });

    it('appendTaskToFile: a create that threw but left the note as asked is written on line 0', async () => {
        const b = await benchCreateThrows(CONTENT);

        const outcome = await b.writer.appendTaskToFile(NEW, CONTENT, 'user');

        expect(outcome.written).toBe(true);
        expect(outcome.written && outcome.line).toBe(0);
        expect(b.refused).toEqual([]);
    });

    it('appendTaskToFile: a create that did not throw is written', async () => {
        const b = await writeBench({ [FILE]: '# note' });

        const outcome = await b.writer.appendTaskToFile(NEW, CONTENT, 'user');

        expect(outcome.written).toBe(true);
        expect(b.text(NEW)).toBe(CONTENT);
        expect(b.refused).toEqual([]);
    });
});
