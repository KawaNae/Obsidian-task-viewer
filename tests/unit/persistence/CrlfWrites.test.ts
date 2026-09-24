import { describe, it, expect, vi, afterEach } from 'vitest';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { freezeDate } from '../helpers/fakeDate';

// Frozen so `==> every mon` on `@2026-09-21` lands on the `@2026-09-28` these
// tests hard-code, no matter which day the suite runs.
freezeDate(new Date(2026, 8, 25, 12, 0, 0));

/**
 * Writes to notes that are not written in LF, driven through the real scan and
 * the real write path (#176).
 *
 * The scanner dropped the CR of every CRLF line and the writers did not, so
 * `task.originalText` never equalled the line it came from: line resolution
 * missed on every strategy and every write was dropped without a trace. These
 * tests hold both halves of the round trip together — read, write, and read
 * again — because that is where the two readings disagreed.
 *
 * They also pin what the file keeps: a note written in CRLF stays in CRLF,
 * terminators the write never touched included.
 */

const FILE = 'crlf.md';

/** How the file is terminated, counted rather than sampled. */
function terminators(text: string): { crlf: number; lf: number } {
    return {
        crlf: (text.match(/\r\n/g) ?? []).length,
        lf: (text.match(/(?<!\r)\n/g) ?? []).length,
    };
}

function taskLines(contents: Map<string, string>): string[] {
    return contents.get(FILE)!.split(/\r?\n/).filter(line => line.trim().startsWith('- ['));
}

let live: VaultSession | undefined;
afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function openNote(text: string): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    const contents = new Map([[FILE, text]]);
    live = vaultSession(contents);
    await live.scanAll();
    return { contents, session: live };
}

const CRLF_NOTE = ['# crlf', '', '- [ ] タスクA @2026-09-21', '- [ ] タスクB @2026-09-21', ''].join('\r\n');

describe('a note written in CRLF', () => {
    it('takes a status update and keeps every terminator', async () => {
        const { contents, session } = await openNote(CRLF_NOTE);
        const a = session.index.getTasks().find(task => task.content === 'タスクA')!;

        const written = await session.index.updateTask(a.id, { statusChar: 'x' });
        await session.settle(FILE);

        expect(written).toBe(true);
        expect(contents.get(FILE)).toContain('- [x] タスクA @2026-09-21');
        expect(terminators(contents.get(FILE)!)).toEqual({ crlf: 4, lf: 0 });
    });

    it('takes a delete', async () => {
        const { contents, session } = await openNote(CRLF_NOTE);
        const a = session.index.getTasks().find(task => task.content === 'タスクA')!;

        const removed = await session.index.deleteTask(a.id);
        await session.settle(FILE);

        expect(removed).toBe(true);
        expect(taskLines(contents)).toEqual(['- [ ] タスクB @2026-09-21']);
        expect(terminators(contents.get(FILE)!).lf).toBe(0);
    });

    it('takes a duplicate', async () => {
        // Timed, so the copy moves and can be told from the original — an
        // all-day pair would read the same whichever side the copy went.
        const TIMED = ['# crlf', '', '- [ ] タスクA @2026-09-21T10:00>11:00', '- [ ] タスクB @2026-09-21', ''].join('\r\n');
        const { contents, session } = await openNote(TIMED);
        const a = session.index.getTasks().find(task => task.content === 'タスクA')!;

        const written = await session.index.duplicateTask(a.id);
        await session.settle(FILE);

        expect(written).toBe(true);
        expect(taskLines(contents)).toEqual([
            '- [ ] タスクA @2026-09-21T10:00>11:00',
            '- [ ] タスクA @2026-09-21T11:00>12:00',
            '- [ ] タスクB @2026-09-21',
        ]);
        expect(terminators(contents.get(FILE)!).lf).toBe(0);
    });

    it('takes a child insert, at the file\'s own terminator', async () => {
        const { contents, session } = await openNote(CRLF_NOTE);
        const a = session.index.getTasks().find(task => task.content === 'タスクA')!;

        const written = await session.index.insertChildTask(a.id, '- [ ] 子タスク');
        await session.settle(FILE);

        expect(written).toBe(true);
        expect(taskLines(contents)[1]).toMatch(/^\s+- \[ \] 子タスク$/);
        expect(terminators(contents.get(FILE)!).lf).toBe(0);
    });

    it('fires a flow and writes the next instance', async () => {
        const { contents, session } = await openNote(
            ['# crlf flow', '', '- [ ] 週報 @2026-09-21 ==> every mon', ''].join('\r\n')
        );
        const weekly = session.index.getTasks().find(task => task.content === '週報')!;

        await session.index.updateTask(weekly.id, { statusChar: 'x' });
        await vi.waitFor(() => expect(taskLines(contents)).toHaveLength(2));
        await session.settle(FILE);

        expect(taskLines(contents)[0]).toMatch(/^- \[ \] 週報 @2026-09-28/);
        expect(terminators(contents.get(FILE)!).lf).toBe(0);
    });

    it('appends a moved subtree with the destination\'s own terminator', async () => {
        // A move writes the task and its children as one block. Joining that
        // block with LF is how the destination ended up half CRLF and half LF,
        // and it is the only append that spans more than one line.
        const contents = new Map([
            [FILE, [
                '# crlf move',
                '',
                '- [ ] 移すタスク @2026-09-21 ==> move([[archive]])',
                '\t- [ ] 子1 @2026-09-21',
                '\t- [ ] 子2 @2026-09-21',
                '',
            ].join('\r\n')],
            ['archive.md', ['# archive', ''].join('\r\n')],
        ]);
        live = vaultSession(contents);
        await live.scanAll();
        const moving = live.index.getTasks().find(task => task.content === '移すタスク')!;

        await live.index.updateTask(moving.id, { statusChar: 'x' });
        await vi.waitFor(() => expect(contents.get('archive.md')).toContain('子2'));
        await live.settle('archive.md');

        // Heading, task, child, child: four terminators — the append goes in
        // before the note's own trailing terminator, which stays the note's
        // last character, as any append now does.
        expect(terminators(contents.get('archive.md')!)).toEqual({ crlf: 4, lf: 0 });
    });
});

describe('the writes that always landed, but landed in LF', () => {
    // Heading inserts and frontmatter keys never went through line resolution,
    // so they wrote to CRLF notes all along — and left the lines they added
    // terminated in LF, in the middle of a CRLF file.

    it('creates a task under a heading at the file\'s own terminator', async () => {
        const { contents, session } = await openNote(
            ['# crlf heading', '', '## 予定', '- [ ] 既存 @2026-09-21', ''].join('\r\n')
        );

        const line = await session.index.createTask(FILE, '- [ ] 追加 @2026-09-21', '予定');
        await session.settle(FILE);

        expect(line).toBe(3);
        expect(taskLines(contents)[0]).toBe('- [ ] 追加 @2026-09-21');
        expect(terminators(contents.get(FILE)!).lf).toBe(0);
    });

    it('writes a frontmatter key at the file\'s own terminator', async () => {
        const { contents, session } = await openNote(
            ['---', 'title: crlf', '---', '', '- [ ] タスクA @2026-09-21', ''].join('\r\n')
        );

        await session.index.getRepository().setFrontmatterKeys(FILE, { 'tv-color': 'ff0000' });
        await session.settle(FILE);

        expect(contents.get(FILE)).toContain('tv-color: ff0000');
        expect(terminators(contents.get(FILE)!).lf).toBe(0);
    });
});

describe('a note whose terminators disagree', () => {
    it('is unified by majority, and the odd line out is still writable', async () => {
        // Three LF terminators against one CRLF: the file reads as LF, and the
        // CRLF line — the one the old code could never write to — comes along.
        const { contents, session } = await openNote(
            '# mixed\n\n- [ ] 混在A @2026-09-21\r\n- [ ] 混在B @2026-09-21\n'
        );
        const a = session.index.getTasks().find(task => task.content === '混在A')!;

        const written = await session.index.updateTask(a.id, { statusChar: 'x' });
        await session.settle(FILE);

        expect(written).toBe(true);
        expect(contents.get(FILE)).toContain('- [x] 混在A @2026-09-21');
        expect(terminators(contents.get(FILE)!)).toEqual({ crlf: 0, lf: 4 });
    });

    it('keeps CRLF when CRLF is the majority', async () => {
        const { contents, session } = await openNote(
            '# mixed\r\n\r\n- [ ] 混在A @2026-09-21\n- [ ] 混在B @2026-09-21\r\n'
        );
        const b = session.index.getTasks().find(task => task.content === '混在B')!;

        await session.index.updateTask(b.id, { statusChar: 'x' });
        await session.settle(FILE);

        expect(contents.get(FILE)).toContain('- [x] 混在B @2026-09-21');
        expect(terminators(contents.get(FILE)!)).toEqual({ crlf: 4, lf: 0 });
    });
});

describe('a note whose last line ends with a stray CR', () => {
    // Found in Dev: the CR has no LF after it, so it terminates nothing, but it
    // is still a CR on a task line — and the parser's line regex ends at `$`,
    // which a CR is not. Leaving it on the text costs that task its card.
    const STRAY = '# trailing\n- [ ] alpha @2026-09-21\n- [ ] beta @2026-09-21\r';

    it('still indexes the task on that line', async () => {
        const { session } = await openNote(STRAY);

        expect(session.index.getTasks().map(task => task.content)).toEqual(['alpha', 'beta']);
    });

    it('takes a write to it, and the file stays LF', async () => {
        const { contents, session } = await openNote(STRAY);
        const beta = session.index.getTasks().find(task => task.content === 'beta')!;

        const written = await session.index.updateTask(beta.id, { statusChar: 'x' });
        await session.settle(FILE);

        expect(written).toBe(true);
        expect(contents.get(FILE)).toContain('- [x] beta @2026-09-21');
        // The CR ends the line, as the editor reads it, and is written back as
        // the file's own terminator; nothing else changes.
        expect(terminators(contents.get(FILE)!)).toEqual({ crlf: 0, lf: 3 });
        expect(contents.get(FILE)!.endsWith('\r')).toBe(false);
    });

    it('is left alone when nothing is written', async () => {
        const { contents, session } = await openNote(STRAY);
        const beta = session.index.getTasks().find(task => task.content === 'beta')!;

        // A write that cannot find its line must not rewrite the file just
        // because the read normalised it.
        contents.set(FILE, '# trailing\n');
        await session.index.updateTask(beta.id, { statusChar: 'x' });

        expect(contents.get(FILE)).toBe('# trailing\n');
    });
});

describe('a note written in LF', () => {
    it('is left in LF', async () => {
        const { contents, session } = await openNote(
            ['# lf', '', '- [ ] タスクA @2026-09-21', '- [ ] タスクB @2026-09-21', ''].join('\n')
        );
        const a = session.index.getTasks().find(task => task.content === 'タスクA')!;

        const written = await session.index.updateTask(a.id, { statusChar: 'x' });
        await session.settle(FILE);

        expect(written).toBe(true);
        expect(terminators(contents.get(FILE)!)).toEqual({ crlf: 0, lf: 4 });
    });
});
