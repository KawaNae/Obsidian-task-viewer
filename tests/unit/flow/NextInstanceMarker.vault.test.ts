import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';

/**
 * The next instance is spelled as the row that fired: its list marker and
 * the gap after it (L2's H2, handed to stage X). It used to be written from a
 * task with no line of its own (`TaskParser.format` over `originalText: ''`),
 * so `*`, `+` and `1)` came back as `- `; and a row whose content opens far
 * from its marker (`10.   [ ] T`) got a next instance whose content opens
 * two columns in, under which the `==>` lines and a generated child written
 * as the fired row's children read as a paragraph going on, and the series
 * stopped.
 */

// `every` lands on the first grid point after the later of today and the
// row's date: today is held on the Friday the dates below are read from.
beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
});
afterAll(() => {
    vi.useRealTimers();
});

const FILE = 'note.md';
let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
    Notice.messages.length = 0;
});

async function complete(lines: string[], content = 'T'): Promise<{ lines: string[]; session: VaultSession }> {
    const { contents, session } = await openVault({ [FILE]: lines });
    live = session;
    const task = session.index.getTasks().find(each => each.content === content)!;
    expect(await session.index.updateTask(task.id, { statusChar: 'x' })).toBe(true);
    await session.flowSettled(FILE);
    return { lines: contents.get(FILE)!.split('\n'), session };
}

describe('the next instance keeps the marker of the row that fired', () => {
    for (const marker of ['*', '+', '1)', '2.']) {
        it(`${marker}`, async () => {
            const { lines } = await complete(['# note', `${marker} [ ] T @2026-09-21 ==> every mon`, '']);
            expect(lines).toEqual(['# note', `${marker} [ ] T @2026-09-28 ==> every mon`, `${marker} [x] T @2026-09-21`, '']);
            expect(Notice.messages).toEqual([]);
        });
    }

    it('and the gap after it, so its commands are its children and the series goes on', async () => {
        const { lines, session } = await complete(['# note', '10.   [ ] T @2026-09-21', '      - ==> every mon', '']);

        expect(lines).toEqual(['# note', '10.   [ ] T @2026-09-28', '      - ==> every mon', '10.   [x] T @2026-09-21', '']);
        const next = session.index.getTasks().find(task => task.content === 'T' && task.statusChar === ' ')!;
        expect(next.flow?.program).toBeTruthy();
    });

    it('under a row deep in its item, a generated child is a task of the next instance', async () => {
        const { lines, session } = await complete([
            '# note', '10.   [ ] T @2026-09-21', '      - ==> every mon use("w")', '',
            '```tv-gen w', '- [ ] T', '\t- [ ] 生成子', '```', '',
        ]);

        const at = lines.indexOf('10.   [ ] T');
        expect(at).toBeGreaterThan(0);
        const child = session.index.getTasks().find(task => task.content === '生成子' && task.line === at + 2);
        expect(child, lines.join('\n')).toBeDefined();
        expect(child!.parentId).toBe(session.index.getTasks().find(task => task.line === at)!.id);
    });
});
