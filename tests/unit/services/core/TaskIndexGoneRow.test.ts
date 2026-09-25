import { describe, it, expect } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, makeFile } from '../../helpers/vaultSession';
import { t } from '../../../../src/i18n';

/**
 * A write asked of a row the index no longer holds — an earlier write to it
 * took it away, or a scan read the file without it — is refused as `gone`,
 * told once (TaskIndex.copyForWrite). Before, it answered false with nothing
 * said, against the write layer's "a write not made is told once".
 */
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1, clearInterval: () => { },
    addEventListener: () => { }, removeEventListener: () => { },
};
const FILE = 'notes/a.md';

async function session() {
    const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 別の行 @2026-09-21', ''].join('\n')]]);
    const s = vaultSession(contents);
    await s.scanAll();
    const id = s.index.getTasks().find(task => task.content === '対象')!.id;
    Notice.messages.length = 0;
    return { s, contents, id };
}

const gone = (subject: string) => t('notice.writeTargetGone', { subject });

describe('a write whose row the index no longer holds is told once, as gone', () => {
    it('delete then update on one row: the update is refused with one notice', async () => {
        const { s, contents, id } = await session();
        const [deleted, updated] = await Promise.all([
            s.index.deleteTask(id),
            s.index.updateTask(id, { statusChar: 'x' }),
        ]);
        expect(deleted).toBe(true);
        expect(updated).toBe(false);
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toBe(gone('対象'));
        expect(contents.get(FILE)).not.toContain('対象');
        expect(contents.get(FILE)).toContain('- [ ] 別の行 @2026-09-21');
        s.dispose();
    });

    it('delete twice on one row: the second is refused with one notice', async () => {
        const { s, id } = await session();
        const [first, second] = await Promise.all([s.index.deleteTask(id), s.index.deleteTask(id)]);
        expect(first).toBe(true);
        expect(second).toBe(false);
        expect(Notice.messages).toEqual([gone('対象')]);
        s.dispose();
    });

    it('delete then duplicate on one row: the duplicate is refused with one notice', async () => {
        const { s, contents, id } = await session();
        const [, duplicated] = await Promise.all([s.index.deleteTask(id), s.index.duplicateTask(id)]);
        expect(duplicated).toBe(false);
        expect(Notice.messages).toEqual([gone('対象')]);
        expect(contents.get(FILE)).not.toContain('対象');
        s.dispose();
    });

    const ops = [
        { name: 'insertChildTask', call: (s: Awaited<ReturnType<typeof session>>['s'], id: string) => s.index.insertChildTask(id, '- [ ] 子') },
        { name: 'insertRecord (firstChild)', call: (s: Awaited<ReturnType<typeof session>>['s'], id: string) => s.index.insertRecord(id, '- [ ] 子', 'firstChild') },
        { name: 'appendChildTask', call: (s: Awaited<ReturnType<typeof session>>['s'], id: string) => s.index.appendChildTask(id, '- [ ] 子') },
        { name: 'insertRecord (afterSubtree)', call: (s: Awaited<ReturnType<typeof session>>['s'], id: string) => s.index.insertRecord(id, '- [ ] 子', 'afterSubtree') },
    ] as const;

    for (const { name, call } of ops) {
        it(`${name} under a row that is gone: refused with one notice, nothing written`, async () => {
            const { s, contents, id } = await session();
            await s.index.deleteTask(id);
            await s.settle(FILE);
            const before = contents.get(FILE);
            Notice.messages.length = 0;
            expect(await call(s, id)).toBe(false);
            // The store never held it here: the note is named, not the internal id.
            expect(Notice.messages).toEqual([gone(FILE)]);
            expect(contents.get(FILE)).toBe(before);
            s.dispose();
        });
    }

    it('a row a scan read the file without: the update is refused with one notice, nothing written', async () => {
        const { s, contents, id } = await session();
        // 外でその行が消され、index が読み直した。
        contents.set(FILE, ['- [ ] 別の行 @2026-09-21', ''].join('\n'));
        await (s.fireVault('modify', makeFile(FILE)) as Promise<void>);
        await s.settle(FILE);
        expect(s.index.getTask(id)).toBeUndefined();
        const before = contents.get(FILE);
        Notice.messages.length = 0;
        expect(await s.index.updateTask(id, { statusChar: 'x' })).toBe(false);
        expect(Notice.messages).toEqual([gone(FILE)]);
        expect(contents.get(FILE)).toBe(before);
        s.dispose();
    });
});
