import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { vaultSession, makeFile, type VaultSession } from '../helpers/vaultSession';
import { processLines, replaceWhole } from '../../../src/utils/FileLines';
import { HeadingInserter } from '../../../src/utils/HeadingInserter';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import type { Task } from '../../../src/types';

/**
 * Every write of ours that changes a file leaves a record of what the file now
 * is, or a mark that the chain of records broke there (F5). A write that left
 * neither would leave the last record looking current: F5b is to take the
 * newest record as the state to match against, and an unmarked gap would
 * hand it a state the file is no longer in.
 *
 * Two halves. The static half pins where a file can be changed at all, so a
 * write that goes around `processLines` and `replaceWhole` cannot appear
 * unseen. The dynamic half drives each write path and reads what it left,
 * with the scans held off (a drag) so no scan has taken the record away.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;
afterEach(() => {
    live?.dispose();
    live = undefined;
});

async function open(text: string): Promise<VaultSession> {
    live = vaultSession(new Map([[FILE, text]]));
    await live.scanAll();
    live.index.setDraggingFile(FILE);
    return live;
}

/** What the last write of ours left: its rows, null for the mark, undefined for nothing. */
function lastWrite(session: VaultSession): { rows: readonly unknown[] | null } | undefined {
    return (session.scanner as unknown as { claims: { lastWrite(path: string): { rows: readonly unknown[] | null } | undefined } })
        .claims.lastWrite(FILE);
}

function task(session: VaultSession, text: string): Task {
    const found = session.index.getTasks().find(t => t.file === FILE && t.originalText.trim() === text);
    if (!found) throw new Error(`no task ${text}`);
    return found;
}

function channel(session: VaultSession) {
    return session.index.getRepository().getWriteObserver().for(FILE);
}

const NOTE = ['- [ ] A', '    - key:: v', '- [ ] B', ''].join('\n');

describe('where a file can be changed at all', () => {
    it('only in processLines and replaceWhole, besides creating files and binary exports', () => {
        const root = join(__dirname, '../../../src');
        const files: string[] = [];
        const walk = (dir: string): void => {
            for (const name of readdirSync(dir)) {
                const path = join(dir, name);
                if (statSync(path).isDirectory()) walk(path);
                else if (path.endsWith('.ts') && !path.endsWith('.d.ts')) files.push(path);
            }
        };
        walk(root);

        const writes = /\bvault\.(process|modify|append)\(|\badapter\.(write|append)\(|\bprocessFrontMatter\(/;
        const creates = /\bvault\.(create|createBinary|modifyBinary)\(/;
        const found: string[] = [];
        const created: string[] = [];
        for (const path of files) {
            const lines = readFileSync(path, 'utf8').split(/\r?\n/);
            lines.forEach((line, i) => {
                if (/^\s*(\*|\/\/)/.test(line)) return;
                const at = `${relative(root, path).replace(/\\/g, '/')}:${i + 1}`;
                if (writes.test(line)) found.push(at.replace(/:\d+$/, ''));
                if (creates.test(line)) created.push(relative(root, path).replace(/\\/g, '/'));
            });
        }

        // processLines and replaceWhole: the two ways a note is changed.
        expect(found).toEqual(['utils/FileLines.ts', 'utils/FileLines.ts']);
        // A created note starts a chain (no record of the path exists to go
        // stale); a binary export is not a note. Each is named here so a new
        // one is looked at, not waved through.
        expect([...new Set(created)].sort()).toEqual([
            'log/log-manager.ts',
            'main.ts',
            'services/export/ExportUtils.ts',
            'services/persistence/writers/InlineTaskWriter.ts',
            'services/template/ViewTemplateWriter.ts',
            'timer/IntervalTemplateWriter.ts',
            'utils/DailyNoteUtils.ts',
        ]);
    });
});

describe('every write of ours leaves a record or the mark', () => {
    const recorded = (session: VaultSession): void => {
        const left = lastWrite(session);
        expect(left).toBeDefined();
        expect(left!.rows).not.toBeNull();
    };
    const marked = (session: VaultSession): void => {
        const left = lastWrite(session);
        expect(left).toBeDefined();
        expect(left!.rows).toBeNull();
    };

    it('nothing is left before any write', async () => {
        const session = await open(NOTE);
        expect(lastWrite(session)).toBeUndefined();
    });

    it.each([
        ['updateTaskInFile', async (s: VaultSession) => {
            const a = task(s, '- [ ] A');
            await s.index.getRepository().updateTaskInFile(plannedOn(a), { ...a, statusChar: 'x' }, [{ op: 'set', key: 'key', value: 'w' }] as never);
        }],
        ['deleteTaskFromFile', async (s: VaultSession) => { await s.index.getRepository().deleteTaskFromFile(plannedOn(task(s, '- [ ] B'), { subtree: true })); }],
        ['duplicateInlineTask', async (s: VaultSession) => { await s.index.getRepository().duplicateInlineTask(plannedOn(task(s, '- [ ] B')), { dayOffset: 1 }); }],
        ['duplicateInlineTaskInPlace', async (s: VaultSession) => {
            await s.index.getRepository().duplicateInlineTaskInPlace(plannedOn(task(s, '- [ ] B')), { kind: 'verbatim', count: 1 });
        }],
        ['insertLineAfterTask', async (s: VaultSession) => { await s.index.getRepository().insertLineAfterTask(task(s, '- [ ] A'), '- [ ] c'); }],
        ['insertSiblingAfterTask', async (s: VaultSession) => { await s.index.getRepository().insertSiblingAfterTask(task(s, '- [ ] A'), '- [ ] c'); }],
        ['insertLineAsFirstChild', async (s: VaultSession) => { await s.index.getRepository().insertLineAsFirstChild(task(s, '- [ ] A'), '- [ ] c'); }],
        ['appendTaskToFile', async (s: VaultSession) => { await s.index.getRepository().appendTaskToFile(FILE, '- [ ] C'); }],
        ['updateLine (editor)', async (s: VaultSession) => { await s.index.getRepository().updateLine(FILE, { line: 0, text: '- [ ] A' }, '- [x] A'); }],
        ['insertLineAfterLine (editor)', async (s: VaultSession) => { await s.index.getRepository().insertLineAfterLine(FILE, { line: 0, text: '- [ ] A' }, '- [ ] A'); }],
        ['deleteLine (editor)', async (s: VaultSession) => { await s.index.getRepository().deleteLine(FILE, { line: 2, text: '- [ ] B' }); }],
        ['applyToTask (flow)', async (s: VaultSession) => {
            await s.index.getRepository().applyToTask(plannedOn(task(s, '- [ ] B')), [{ kind: 'remove' }]);
        }],
        ['setFrontmatterKeys', async (s: VaultSession) => { await s.index.getRepository().setFrontmatterKeys(FILE, { 'tv-color': 'ff0000' }); }],
        ['insertLineUnderHeading', async (s: VaultSession) => { await s.index.getRepository().insertLineUnderHeading(FILE, '- [ ] N', 'Tasks', 2); }],
        ['writeUnderHeading (daily note)', async (s: VaultSession) => {
            await HeadingInserter.writeUnderHeading(s.app, makeFile(FILE), channel(s), '- [ ] N', 'Tasks', 2);
        }],
    ] as const)('%s leaves a record', async (_name, write) => {
        const session = await open(NOTE);
        const before = (session.app.vault as unknown as { read(f: unknown): Promise<string> });
        const was = await before.read(makeFile(FILE));
        await write(session);
        expect(await before.read(makeFile(FILE))).not.toBe(was);
        recorded(session);
    });

    it('a write whose report does not account for its lines leaves the mark', async () => {
        const session = await open(NOTE);
        await processLines(session.app, makeFile(FILE), channel(session), (draft) => {
            (draft.lines as string[])[0] = '- [x] A';
            return true;
        });
        marked(session);
    });

    it('a write whose claim throws while it is made leaves the mark', async () => {
        const session = await open(NOTE);
        const claims = (session.scanner as unknown as { claims: { claim: (...args: unknown[]) => unknown } }).claims;
        claims.claim = () => { throw new Error('parse failed'); };
        await session.index.getRepository().appendTaskToFile(FILE, '- [ ] C');
        marked(session);
    });

    it('a note replaced whole (a saved template) leaves the mark', async () => {
        const session = await open(NOTE);
        await replaceWhole(session.app, makeFile(FILE), channel(session), '---\n_tv-name: "t"\n---\n');
        marked(session);
    });

    it('a note replaced by the same bytes is no write, and leaves nothing', async () => {
        const session = await open(NOTE);
        await replaceWhole(session.app, makeFile(FILE), channel(session), NOTE);
        expect(lastWrite(session)).toBeUndefined();
    });
});
