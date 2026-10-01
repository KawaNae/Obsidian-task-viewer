import { describe, it, expect, afterEach } from 'vitest';
import { TaskApi } from '../../../src/api/TaskApi';
import { TaskReadService } from '../../../src/services/data/TaskReadService';
import { openVault, type VaultSession } from '../helpers/vaultSession';

/**
 * The date block `update` writes. A due takes a date and, after it, a time,
 * as create's does: the same value gives the same block whichever of the two
 * writes it.
 */

const FILE = 'note.md';

let live: VaultSession[] = [];

afterEach(() => {
    for (const session of live) session.dispose();
    live = [];
});

async function updated(line: string, params: { start?: string; end?: string; due?: string }): Promise<string> {
    const { contents, session } = await openVault([line, '']);
    live.push(session);
    const api = new TaskApi({
        app: session.app,
        settings: { startHour: 0 },
        getTaskReadService: () => new TaskReadService(session.index, 0),
        getIndex: () => session.index,
        getOperations: () => session.ops,
    } as never);
    const id = session.index.getTasks()[0].id;
    await api.update({ id, ...params });
    return contents.get(FILE)!.split('\n')[0];
}

describe('the due update writes', () => {
    it.each([
        ['- [ ] t', { due: '2026-07-25' }, '- [ ] t @>>2026-07-25'],
        ['- [ ] t', { due: '2026-07-25 17:00' }, '- [ ] t @>>2026-07-25T17:00'],
        ['- [ ] t', { due: '2026-07-25T17:00' }, '- [ ] t @>>2026-07-25T17:00'],
        ['- [ ] t @2026-07-18', { due: '2026-07-25 17:00' }, '- [ ] t @2026-07-18>>2026-07-25T17:00'],
        // A due given as a date alone drops the time it had: the value is the whole due.
        ['- [ ] t @>>2026-07-25T17:00', { due: '2026-07-26' }, '- [ ] t @>>2026-07-26'],
        ['- [ ] t @>>2026-07-25T17:00', { due: 'none' }, '- [ ] t'],
    ])('%j given %j -> %j', async (line, params, expected) => {
        expect(await updated(line, params)).toBe(expected);
    });

    it('refuses a time with no date', async () => {
        await expect(updated('- [ ] t', { due: '17:00' })).rejects.toThrow(/due must include a date/);
    });
});
