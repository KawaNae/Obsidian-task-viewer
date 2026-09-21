import { describe, it, expect, afterEach, vi } from 'vitest';
import { vaultSession, type VaultSession } from '../../../helpers/vaultSession';

/**
 * Which state a scan read, decided by the whole content — through the real
 * write path and the real scan.
 *
 * The notes are the ones the field runs used (`o2-cases.js`), at 4 lines and
 * at 3000. A deletion fire whose fired line heads its sibling group rewrites
 * the file so that its task rows read exactly as they did before the user
 * deleted anything: the instance is worded like the line it replaces, and only
 * a non-task child (`めじるし`) tells the two files apart. Compared row by row,
 * the claim and the state before it both fit and name different rows, and the
 * scan refused the claim. Compared whole, only the claim fits.
 */

const FILE = 'o2.md';
const TAB = '\t';
const TICK = '```';

let live: VaultSession | undefined;
afterEach(() => {
    live?.dispose();
    live = undefined;
});

/** The note `o2-cases.js` builds, padded the way it pads to `fill` lines. */
function note(rows: string[], fill: number): string {
    const lines = ['# o2', '', ...rows];
    for (let k = lines.length; k < fill; k++) {
        lines.push(k % 3 === 0 ? `- [ ] 詰め物${k} @2026-10-0${1 + (k % 9)}` : `詰め物の段落 ${k}`);
    }
    lines.push('');
    return lines.join('\n');
}

/** The deletion-fire note: `掃除` with a marker child and its gen block. */
function genRows(twinBelow: boolean): string[] {
    return [
        '- [ ] 掃除',
        TAB + '- ==> every 1d use("そうじ")',
        TAB + '- めじるし',
        ...(twinBelow ? ['- [ ] 掃除'] : []),
        '- [ ] 見張り @2026-09-21',
        '',
        TICK + 'tv-gen そうじ',
        '- [ ] 掃除',
        TICK,
    ];
}

/** The IDs of the rows whose content is one of these, in file order. */
function idsOf(session: VaultSession, ...contents: string[]): Array<[string, string]> {
    return session.index.getTasks()
        .filter(task => task.file === FILE && contents.includes(task.content))
        .sort((a, b) => a.line - b.line)
        .map(task => [task.content, task.id]);
}

/** Wait out the move: tick, append, delete — the fired line gone, its copy written. */
async function moved(session: VaultSession, contents: Map<string, string>): Promise<void> {
    await vi.waitFor(() => {
        expect(contents.get(FILE)).not.toContain('==> move');
        expect(contents.get(FILE)).toContain('- [x] 移すタスク');
    });
    await session.settle(FILE);
}

function pendingFor(session: VaultSession): number {
    return session.scanner.getHintLog().peek().find(entry => entry.file === FILE)?.pending.length ?? 0;
}

describe.each([4, 3000])('a deletion fire at the head of its group (%i lines)', (fill) => {
    it('g0: the instance is a task of its own, and the watcher keeps its row', async () => {
        const contents = new Map([[FILE, note(genRows(false), fill)]]);
        live = vaultSession(contents);
        await live.scanAll();
        const [[, fired], [, watcher]] = idsOf(live, '掃除', '見張り');

        await live.index.deleteTask(fired, { fireFlow: true });
        await live.settle(FILE);

        // The marker went with the fired line: this is the file the claim
        // describes, and not the one the previous scan read.
        expect(contents.get(FILE)).not.toContain('めじるし');
        const after = idsOf(live, '掃除', '見張り');
        expect(after.map(([content]) => content)).toEqual(['掃除', '見張り']);
        expect(after[0][1]).not.toBe(fired);
        expect(after[1][1]).toBe(watcher);
        expect(live.index.getTask(fired)).toBeUndefined();
        // Adopted, not left for a later scan.
        expect(pendingFor(live)).toBe(0);
    });

    it('twin: the untouched twin keeps its row, and the instance takes none', async () => {
        const contents = new Map([[FILE, note(genRows(true), fill)]]);
        live = vaultSession(contents);
        await live.scanAll();
        const [[, fired], [, twin], [, watcher]] = idsOf(live, '掃除', '見張り');

        await live.index.deleteTask(fired, { fireFlow: true });
        await live.settle(FILE);

        const after = idsOf(live, '掃除', '見張り');
        expect(after.map(([content]) => content)).toEqual(['掃除', '掃除', '見張り']);
        expect(after[0][1]).not.toBe(fired);
        expect(after[0][1]).not.toBe(twin);
        expect(after[1][1]).toBe(twin);
        expect(after[2][1]).toBe(watcher);
        expect(pendingFor(live)).toBe(0);
    });
});

describe.each([4, 3000])('a same-file move (%i lines)', (fill) => {
    // Not what this change is about: the move's delete files no claim, so its
    // scan falls to the ladder, and where the ladder puts the moved line turns
    // on how many task rows sit between the original and the copy (see
    // structure.md). Pinned so that the answer stays what it was.
    const move = `${TAB}- ==> move([[${FILE.replace(/\.md$/, '')}]])`;

    it('mv-tail: the moved line ends up with the ID it ended up with before', async () => {
        const contents = new Map([[FILE, note([
            '- [ ] 見張り @2026-09-21', '- [ ] 移すタスク @2026-09-21', move,
        ], fill)]]);
        live = vaultSession(contents);
        await live.scanAll();
        const [[, watcher], [, moving]] = idsOf(live, '見張り', '移すタスク');

        await live.index.updateTask(moving, { statusChar: 'x' });
        await moved(live, contents);

        const after = idsOf(live, '見張り', '移すタスク');
        expect(after.map(([content]) => content)).toEqual(['見張り', '移すタスク']);
        expect(after[0][1]).toBe(watcher);
        if (fill <= 4) expect(after[1][1]).toBe(moving);
        else expect(after[1][1]).not.toBe(moving);
    });

    it('mv-twin: the twin and the moved line end up as they did before', async () => {
        const contents = new Map([[FILE, note([
            '- [ ] 見張り @2026-09-21', '- [ ] 移すタスク @2026-09-21', move, '- [ ] 移すタスク @2026-09-21',
        ], fill)]]);
        live = vaultSession(contents);
        await live.scanAll();
        const [[, watcher], [, moving], [, twin]] = idsOf(live, '見張り', '移すタスク');

        await live.index.updateTask(moving, { statusChar: 'x' });
        await moved(live, contents);

        const after = idsOf(live, '見張り', '移すタスク');
        expect(after[0][1]).toBe(watcher);
        expect(after.slice(1).map(([, id]) => id)[0]).toBe(twin);
        if (fill <= 4) expect(after[2][1]).toBe(moving);
        else expect([moving, twin, watcher]).not.toContain(after[2][1]);
    });
});
