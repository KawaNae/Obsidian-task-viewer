import { describe, it, expect, afterEach, vi } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';
import { t } from '../../../src/i18n';

/**
 * A fire does not write a plan made from a copy the file has moved on from.
 *
 * A fire is planned from the index's copy of the row: the next instance, the
 * text the strip or the archive writes, where a move goes. The write used to
 * check only that the row's line read as *something* on record for it — a
 * write of ours included — and never looked at the command lines. So a row
 * rewritten since the copy was taken came back to its older text, a command
 * line edited from outside was consumed by the plan it no longer said, and a
 * child edited between the two writes of a move away went with the removal
 * and was kept nowhere (the first F3 counterexample run: CE1, CE2, CE3), and
 * a generation block edited from outside was written as it no longer read
 * (the second run: CX1). All are older than F3. Each is refused now, whole,
 * with one notice.
 */

const FILE = 'note.md';
const OTHER = 'other.md';

let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
    Notice.messages.length = 0;
});

async function open(files: Record<string, string[]>): Promise<{ contents: Map<string, string>; session: VaultSession }> {
    const contents = new Map(Object.entries(files).map(([path, lines]) => [path, lines.join('\n')]));
    live = vaultSession(contents);
    await live.scanAll();
    return { contents, session: live };
}

function executor(session: VaultSession) {
    return (session.index as unknown as {
        commandExecutor: { handleTaskCompletion(task: unknown): Promise<void>; isProcessing: boolean; taskQueue: unknown[] };
    }).commandExecutor;
}

async function flowSettled(session: VaultSession, ...paths: string[]): Promise<void> {
    await vi.waitFor(() => {
        expect(executor(session).isProcessing).toBe(false);
        expect(executor(session).taskQueue).toHaveLength(0);
    });
    for (const path of [FILE, ...paths]) await session.settle(path);
}

function idOf(session: VaultSession, content: string): string {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.content === content);
    expect(found).toHaveLength(1);
    return found[0].id;
}

const CHANGED = t('notice.writeTargetChanged', { subject: 'A' });

describe('CE1: a row a write of ours rewrote, before any scan read it', () => {
    // The editor's menu rewrites the row (`updateLine`) and leaves the store as
    // it was; the drag holds the scan that would catch up. The fire then runs
    // on the store's copy, whose text is on record as the last scan read it.
    const COMMANDS: Array<[string, string]> = [
        ['a strip', 'every 1d'],
        ['a move within the file', 'move([[note]])'],
        ['a move to another file', 'move([[other]])'],
    ];

    for (const [name, command] of COMMANDS) {
        it(`${name} writes nothing over it`, async () => {
            const { contents, session } = await open({
                [FILE]: ['# note', '- [x] A @2026-09-21', `\t- ==> ${command}`, '- [ ] Z', ''],
                [OTHER]: ['# other', ''],
            });
            const id = idOf(session, 'A');
            session.index.setDraggingFile(FILE);
            await session.index.updateLine(FILE, { line: 1, text: '- [x] A @2026-09-21' }, '- [x] A renamed @2026-09-21');
            const renamed = contents.get(FILE);

            await executor(session).handleTaskCompletion(session.index.getTask(id)!);
            await vi.waitFor(() => expect(executor(session).isProcessing).toBe(false));

            expect(contents.get(FILE)).toBe(renamed);
            expect(contents.get(OTHER)).toBe(['# other', ''].join('\n'));
            expect(Notice.messages).toEqual([CHANGED]);
        });
    }
});

describe('CE2: a command line edited from outside, before any scan read it', () => {
    it('a completion fire does not consume it by the plan it no longer says', async () => {
        const { contents, session } = await open({ [FILE]: ['# note', '- [x] A @2026-09-21', '\t- ==> every 1d', ''] });
        const task = session.index.getTask(idOf(session, 'A'))!;
        const edited = contents.get(FILE)!.replace('every 1d', 'every 1w');
        contents.set(FILE, edited);

        await executor(session).handleTaskCompletion(task);
        await flowSettled(session);

        expect(contents.get(FILE)).toBe(edited);
        expect(Notice.messages).toEqual([CHANGED]);
    });

    it('a deletion fire neither deletes the row nor writes the old plan\'s instance', async () => {
        const { contents, session } = await open({ [FILE]: ['# note', '- [ ] A @2026-09-21', '\t- ==> every 1d', '\t- [ ] c', ''] });
        const id = idOf(session, 'A');
        const edited = contents.get(FILE)!.replace('every 1d', 'every 1w');
        contents.set(FILE, edited);

        expect(await session.index.deleteTask(id, { fireFlow: true })).toBe(false);

        expect(contents.get(FILE)).toBe(edited);
        expect(Notice.messages).toEqual([CHANGED]);
    });

    it('a move goes nowhere the command no longer names', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [x] A @2026-09-21', '\t- ==> move([[note]])', '\t- [ ] c', '- [ ] Z', ''],
        });
        const task = session.index.getTask(idOf(session, 'A'))!;
        const edited = contents.get(FILE)!.replace('move([[note]])', 'move([[other]])');
        contents.set(FILE, edited);

        await executor(session).handleTaskCompletion(task);
        await flowSettled(session);

        expect(contents.get(FILE)).toBe(edited);
        expect(contents.has(OTHER)).toBe(false);
        expect(Notice.messages).toEqual([CHANGED]);
    });
});

describe('CE3: a child edited between the archive and the source\'s write', () => {
    /** A vault in which the first write to `trigger` is followed by an outside edit of `victim`. */
    class RacingMap extends Map<string, string> {
        armed = false;
        constructor(entries: Array<[string, string]>, private trigger: string, private victim: string, private edit: (s: string) => string) {
            super(entries);
        }
        set(key: string, value: string): this {
            super.set(key, value);
            if (this.armed && key === this.trigger) {
                this.armed = false;
                super.set(this.victim, this.edit(super.get(this.victim)!));
            }
            return this;
        }
    }

    it('is not taken away unseen: the task stays in both, and one notice says so', async () => {
        const source = ['# note', '- [x] A @2026-09-21', '\t- ==> every 1d move([[other]])', '\t- [ ] c', '- [ ] Z', ''].join('\n');
        const contents = new RacingMap([[FILE, source], [OTHER, '# other\n']], OTHER, FILE,
            text => text.replace('\t- [ ] c', '\t- [ ] c edited'));
        live = vaultSession(contents);
        await live.scanAll();
        const task = live.index.getTask(idOf(live, 'A'))!;
        contents.armed = true;

        await executor(live).handleTaskCompletion(task);
        await flowSettled(live, OTHER);

        expect(contents.get(FILE)).toBe(source.replace('\t- [ ] c', '\t- [ ] c edited'));
        expect(contents.get(OTHER)).toBe(['# other', '- [x] A @2026-09-21', '\t- [ ] c', ''].join('\n'));
        expect(Notice.messages).toEqual([t('notice.moveOriginKept', {
            dest: 'other', reason: t('notice.moveOriginChanged'), subject: 'A',
        })]);
    });
});

describe('CX1: a generation block edited from outside, before any scan read it', () => {
    const NOTE = [
        '# note', '- [ ] Z', '',
        '```tv-gen w', '- [ ] A ${dates}', '\t- [ ] old child', '```', '',
    ];

    it('a completion fire does not write the block as it no longer reads', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [x] A @2026-09-21', '\t- ==> every mon use("w")', ...NOTE.slice(1)],
        });
        const task = session.index.getTask(idOf(session, 'A'))!;
        const edited = contents.get(FILE)!.replace('old child', 'new child');
        contents.set(FILE, edited);

        await executor(session).handleTaskCompletion(task);
        await flowSettled(session);

        expect(contents.get(FILE)).toBe(edited);
        expect(Notice.messages).toEqual([CHANGED]);
    });

    it('a deletion fire neither deletes the row nor writes the old block', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [ ] A @2026-09-21', '\t- ==> every mon use("w")', ...NOTE.slice(1)],
        });
        const id = idOf(session, 'A');
        const edited = contents.get(FILE)!.replace('old child', 'new child');
        contents.set(FILE, edited);

        expect(await session.index.deleteTask(id, { fireFlow: true })).toBe(false);

        expect(contents.get(FILE)).toBe(edited);
        expect(Notice.messages).toEqual([CHANGED]);
    });

    it('a block left as it was does not stop the fire', async () => {
        const { contents, session } = await open({
            [FILE]: ['# note', '- [x] A @2026-09-21', '\t- ==> every mon use("w")', ...NOTE.slice(1)],
        });
        const task = session.index.getTask(idOf(session, 'A'))!;

        await executor(session).handleTaskCompletion(task);
        await flowSettled(session);

        expect(contents.get(FILE)).toContain('- [x] A @2026-09-21');
        expect(contents.get(FILE)).not.toContain('- [x] A @2026-09-21 ==>');
        expect(contents.get(FILE)!.split('\n').filter(line => line === '\t- [ ] old child')).toHaveLength(2);
        expect(Notice.messages).toEqual([]);
    });
});
