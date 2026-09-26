import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Notice, type TFile } from 'obsidian';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import en from '../../../src/i18n/locales/en.json';

/**
 * `vault.process` が投げたときの updateTask の答え。着地しなかったなら偽を返し、
 * 写しを更新前に戻し、書かなかったことと理由（refusedFailed）を1回だけ言う。書いてから投げたなら、
 * ファイルが書けたと読めるので真を返し、写しは新しい値のまま、何も言わない。
 * 実物の TaskIndex と書き込みの層（processLines）を通す。
 */

const FILE = 'notes/a.md';

function isNotice(message: string, key: keyof typeof en.notice): boolean {
    const pattern = (en.notice[key] as string)
        .split(/\{\{\w+\}\}/)
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
    return new RegExp(`^${pattern}$`, 's').test(message);
}

type Process = (file: TFile, fn: (data: string) => string) => Promise<string>;

describe('updateTask when vault.process throws', () => {
    let contents: Map<string, string>;
    let s: VaultSession;
    let vault: { process: Process };
    let realProcess: Process;

    beforeEach(async () => {
        contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21T10:00', ''].join('\n')]]);
        s = vaultSession(contents);
        await s.scanAll();
        vault = (s.app as unknown as { vault: { process: Process } }).vault;
        realProcess = vault.process;
        Notice.messages.length = 0;
    });
    afterEach(() => { s.dispose(); });

    const target = () => s.index.getTasks().find(task => task.content === '対象')!;

    it('answers false, puts the copy back, and says once that the write failed', async () => {
        const task = target();
        const before = contents.get(FILE);
        vault.process = async () => { throw new Error('disk on fire'); };

        const written = await s.index.updateTask(task.id, { startTime: '11:00', statusChar: 'x' });

        expect(written).toBe(false);
        const copy = s.index.getTask(task.id)!;
        expect(copy.startTime).toBe('10:00');
        expect(copy.statusChar).toBe(' ');
        expect(contents.get(FILE)).toBe(before);
        expect(Notice.messages, Notice.messages.join(' | ')).toHaveLength(1);
        expect(isNotice(Notice.messages[0], 'notWritten'), Notice.messages[0]).toBe(true);
        expect(Notice.messages[0]).toContain(en.notice.refusedFailed);
    });

    it('answers true and keeps the new value when the write landed before it threw', async () => {
        const task = target();
        vault.process = async (file, fn) => {
            await realProcess(file, fn);
            throw new Error('reported late');
        };

        const written = await s.index.updateTask(task.id, { startTime: '11:00', statusChar: 'x' });

        expect(written).toBe(true);
        const copy = s.index.getTasks().find(t => t.content === '対象')!;
        expect(copy.startTime).toBe('11:00');
        expect(copy.statusChar).toBe('x');
        expect(contents.get(FILE)).toContain('- [x] 対象');
        expect(Notice.messages, Notice.messages.join(' | ')).toHaveLength(0);
    });
});
