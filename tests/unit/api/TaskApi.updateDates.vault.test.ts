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
        getTaskReadService: () => new TaskReadService(session.index, () => ({ startHour: 0, weekStartDay: 1 })),
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

/**
 * The values are read as typed text (stage 7, input decisions B, C, D):
 * a date names a day that exists, an hour of one digit is written with two,
 * full-width and hyphen-like characters are read as ASCII. What the update
 * writes is what the notation reads back.
 */
describe('the date update reads typed text', () => {
    it.each([
        ['- [ ] t @2026-07-18', { start: '9:40' }, '- [ ] t @2026-07-18T09:40'],
        ['- [ ] t', { start: '2026-07-18 9:40' }, '- [ ] t @2026-07-18T09:40'],
        ['- [ ] t', { start: '２０２６－０７－１８' }, '- [ ] t @2026-07-18'],
        ['- [ ] t', { due: '2026ー07ー25　１７：００' }, '- [ ] t @>>2026-07-25T17:00'],
    ])('%j given %j -> %j', async (line, params, expected) => {
        expect(await updated(line, params)).toBe(expected);
    });

    it.each([
        [{ start: '2026-02-30' }, /start must be a day that exists, got: "2026-02-30"/],
        [{ end: '2026-13-45' }, /end must be a day that exists/],
        [{ start: '2026-07-18T99:99' }, /start must be a date \(YYYY-MM-DD\), a date and a time/],
        [{ due: '2026-04-31 10:00' }, /due must be a day that exists/],
    ])('refuses %j and leaves the line', async (params, message) => {
        await expect(updated('- [ ] t @2026-07-18', params)).rejects.toThrow(message);
    });
});
