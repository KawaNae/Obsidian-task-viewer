import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import { TaskScanner } from '../../../../../src/services/core/TaskScanner';
import { TaskStore } from '../../../../../src/services/core/TaskStore';
import { TaskValidator } from '../../../../../src/services/core/TaskValidator';
import { TaskIdGenerator } from '../../../../../src/services/display/TaskIdGenerator';
import { refOf } from '../../../../../src/services/persistence/TaskRefs';
import { DEFAULT_SETTINGS } from '../../../../../src/types';
import type { Task } from '../../../../../src/types';

/**
 * Runtime IDs across two scans of the same file, through the real scanner.
 *
 * The matcher's own tests feed it hand-built tasks; these go through
 * `TaskScanner.requestScan` with the real parse pipeline and a real store, so
 * what is pinned is the wiring — the mapping reaching `parentId` and `childIds`,
 * the ledger being replaced in the commit, and nothing provisional reaching the
 * store. The fixtures are the shapes that broke before the ledger: a line
 * inserted above a task (`ln:` shifted), and a flow or a timer writing a new
 * line into the middle of a file.
 */

function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.basename = file.name.replace(/\.md$/, '');
    return file;
}

class Harness {
    readonly contents = new Map<string, string>();
    readonly frontmatters = new Map<string, Record<string, unknown>>();
    readonly store = new TaskStore(DEFAULT_SETTINGS);
    readonly scanner: TaskScanner;

    constructor() {
        const app = {
            vault: {
                read: async (file: TFile) => this.contents.get(file.path) ?? '',
                getMarkdownFiles: () => [...this.contents.keys()].map(makeFile),
            },
            metadataCache: {
                getCache: (path: string) => {
                    const frontmatter = this.frontmatters.get(path);
                    return frontmatter ? { frontmatter } : null;
                },
            },
        };
        const flow = { handleTaskCompletion: vi.fn(async () => {}) };
        this.scanner = new TaskScanner(
            app as never, this.store, new TaskValidator(), {} as never, flow as never, DEFAULT_SETTINGS
        );
        this.scanner.setInitializing(false);
    }

    async write(path: string, lines: string[], frontmatter?: Record<string, unknown>): Promise<void> {
        this.contents.set(path, lines.join('\n'));
        if (frontmatter) this.frontmatters.set(path, frontmatter);
        await this.scanner.requestScan(makeFile(path));
    }

    tasks(path = 'a.md'): Task[] {
        return this.store.getTasks().filter(task => task.file === path).sort((a, b) => a.line - b.line);
    }

    /** The one task with this content; fails loudly on zero or several. */
    one(content: string, path = 'a.md'): Task {
        const found = this.tasks(path).filter(task => task.content === content);
        if (found.length !== 1) throw new Error(`expected one "${content}", found ${found.length}`);
        return found[0];
    }

    ids(path = 'a.md'): string[] {
        return this.tasks(path).map(task => task.id);
    }
}

/** Every edge points at a task in the store, and every edge has its reverse. */
function expectConsistentTree(store: TaskStore): void {
    for (const task of store.getTasks()) {
        expect(TaskIdGenerator.isRuntimeId(task.id)).toBe(true);
        if (task.parentId !== undefined) {
            const parent = store.getTask(task.parentId);
            expect(parent, `parent of ${task.content}`).toBeDefined();
            expect(parent!.childIds).toContain(task.id);
        }
        for (const childId of task.childIds) {
            const child = store.getTask(childId);
            expect(child, `child ${childId} of ${task.content}`).toBeDefined();
            expect(child!.parentId).toBe(task.id);
        }
    }
}

let h: Harness;
beforeEach(() => {
    h = new Harness();
});

describe('scan identity — flat lists', () => {
    it('hands out seq runtime IDs, never provisional ones', async () => {
        await h.write('a.md', ['- [ ] A @2026-09-21', '- [ ] B @2026-09-21']);

        for (const id of h.ids()) {
            expect(id).toMatch(/^tv-inline:a\.md:seq:\d+$/);
        }
        expectConsistentTree(h.store);
    });

    it('keeps IDs when a line is inserted above', async () => {
        await h.write('a.md', ['- [ ] A @2026-09-21', '- [ ] B @2026-09-21']);
        const before = { a: h.one('A').id, b: h.one('B').id };

        await h.write('a.md', ['- [ ] X @2026-09-21', '- [ ] A @2026-09-21', '- [ ] B @2026-09-21']);

        expect(h.one('A').id).toBe(before.a);
        expect(h.one('B').id).toBe(before.b);
        expect([before.a, before.b]).not.toContain(h.one('X').id);
    });

    it('keeps IDs when a line above is deleted', async () => {
        await h.write('a.md', ['- [ ] A @2026-09-21', '- [ ] B @2026-09-21', '- [ ] C @2026-09-21']);
        const before = { a: h.one('A').id, c: h.one('C').id };

        await h.write('a.md', ['- [ ] A @2026-09-21', '- [ ] C @2026-09-21']);

        expect(h.one('A').id).toBe(before.a);
        expect(h.one('C').id).toBe(before.c);
    });

    it('keeps the ID when only the text, or only the dates, change', async () => {
        await h.write('a.md', ['- [ ] A @2026-09-21', '- [ ] B @2026-09-21']);
        const before = { a: h.one('A').id, b: h.one('B').id };

        await h.write('a.md', ['- [ ] A edited @2026-09-21', '- [ ] B @2026-09-21']);
        await h.write('a.md', ['- [ ] A edited @2026-09-21', '- [ ] B @2026-09-22']);

        expect(h.one('A edited').id).toBe(before.a);
        expect(h.one('B').id).toBe(before.b);
    });

    // The one-against-one rescue needs exactly one leftover on each side, so two
    // such edits landing in one scan (a sync, a bulk replace) renumber both.
    // "When in doubt, mint" — pinned so a change to it is a decision, not a drift.
    it('mints new IDs when two tasks are edited in the same scan', async () => {
        await h.write('a.md', ['- [ ] A @2026-09-21', '- [ ] B @2026-09-21']);
        const before = { a: h.one('A').id, b: h.one('B').id };

        await h.write('a.md', ['- [ ] A edited @2026-09-21', '- [ ] B @2026-09-22']);

        expect([before.a, before.b]).not.toContain(h.one('A edited').id);
        expect([before.a, before.b]).not.toContain(h.one('B').id);
    });

    it('mints a new ID when the text and the dates both change', async () => {
        await h.write('a.md', ['- [ ] A @2026-09-21', '- [ ] B @2026-09-21']);
        const before = { a: h.one('A').id, b: h.one('B').id };

        await h.write('a.md', ['- [ ] Z @2026-10-01', '- [ ] B @2026-09-21']);

        expect(h.one('B').id).toBe(before.b);
        expect(h.one('Z').id).not.toBe(before.a);
        expect(h.store.getTask(before.a)).toBeUndefined();
    });

    it('keeps the original on the first copy when a line is duplicated', async () => {
        await h.write('a.md', ['- [ ] A @2026-09-21']);
        const original = h.one('A').id;

        await h.write('a.md', ['- [ ] A @2026-09-21', '- [ ] A @2026-09-21']);

        const [first, second] = h.tasks();
        expect(first.id).toBe(original);
        expect(second.id).not.toBe(original);
    });
});

describe('scan identity — trees', () => {
    it('rewrites parentId and childIds to runtime IDs after an insertion', async () => {
        await h.write('a.md', [
            '- [ ] P @2026-09-21',
            '    - [ ] c1 @2026-09-21',
            '    - [ ] c2 @2026-09-21',
        ]);
        const before = { p: h.one('P').id, c1: h.one('c1').id, c2: h.one('c2').id };

        await h.write('a.md', [
            '- [ ] X @2026-09-21',
            '- [ ] P @2026-09-21',
            '    - [ ] c1 @2026-09-21',
            '    - [ ] c2 @2026-09-21',
        ]);

        expect(h.one('P').id).toBe(before.p);
        expect(h.one('P').childIds).toEqual([before.c1, before.c2]);
        expect(h.one('c1').parentId).toBe(before.p);
        expect(h.one('c2').parentId).toBe(before.p);
        expectConsistentTree(h.store);
    });

    it('does not trade identically-worded siblings between two parents', async () => {
        const group = (parent: string) => [
            `- [ ] ${parent} @2026-09-21`,
            '    - [ ] x @2026-09-21',
            '    - [ ] x @2026-09-21',
        ];
        await h.write('a.md', [...group('P1'), ...group('P2')]);
        const p1Children = [...h.one('P1').childIds];
        const p2Children = [...h.one('P2').childIds];

        // A new instance at the head of P1's group, the way the flow writer inserts.
        await h.write('a.md', [
            '- [ ] P1 @2026-09-21',
            '    - [ ] x @2026-09-28',
            '    - [ ] x @2026-09-21',
            '    - [ ] x @2026-09-21',
            ...group('P2'),
        ]);

        expect(h.one('P2').childIds).toEqual(p2Children);
        const p1Now = h.one('P1').childIds;
        expect(p1Now.slice(1)).toEqual(p1Children);
        expect(p1Children.concat(p2Children)).not.toContain(p1Now[0]);
        expectConsistentTree(h.store);
    });

    it('rescues a child whose parent was rewritten beyond recognition', async () => {
        await h.write('a.md', ['- [ ] P @2026-09-21', '    - [ ] c @2026-09-21']);
        const before = { p: h.one('P').id, c: h.one('c').id };

        await h.write('a.md', ['- [ ] Q @2026-10-01', '    - [ ] c @2026-09-21']);

        expect(h.one('Q').id).not.toBe(before.p);
        expect(h.one('c').id).toBe(before.c);
        expect(h.one('c').parentId).toBe(h.one('Q').id);
        expectConsistentTree(h.store);
    });

    // Frontmatter makes no task: its dates are inherited by the checkboxes
    // below, which are ordinary top-level tasks with their own runtime IDs.
    it('a note with frontmatter dates yields only its checkboxes, and they keep their IDs', async () => {
        const frontmatter = { 'tv-start': '2026-09-21' };
        await h.write('f.md', ['---', 'tv-start: 2026-09-21', '---', '- [ ] a', '- [ ] b'], frontmatter);
        const before = h.ids('f.md');
        expect(h.tasks('f.md').map(task => task.content)).toEqual(['a', 'b']);
        expect(h.tasks('f.md').every(task => task.parentId === undefined)).toBe(true);
        expect(h.tasks('f.md').every(task => task.cascadeContext?.startDate === '2026-09-21')).toBe(true);
        expect(h.store.getTask('tv-file:f.md:fm-root')).toBeUndefined();

        await h.write('f.md', ['---', 'tv-start: 2026-09-21', '---', '- [ ] c', '- [ ] a', '- [ ] b'], frontmatter);

        expect([h.one('a', 'f.md').id, h.one('b', 'f.md').id]).toEqual(before);
        expectConsistentTree(h.store);
    });
});

describe('scan identity — writes that used to shift ln:', () => {
    // verify-vault's bug-1 fixture: the flow target is not the head of its
    // sibling group, and the next instance is written at the head.
    it('bug 1: a flow instance inserted at the head leaves the fired task its ID', async () => {
        await h.write('a.md', [
            '# verify b1',
            '',
            '- [ ] 前の行 @2026-09-21',
            '- [ ] 週報 @2026-09-21 ==> every mon',
            '- [ ] 後の行 @2026-09-21',
            '',
        ]);
        const before = { prev: h.one('前の行').id, target: h.one('週報').id, next: h.one('後の行').id };

        await h.write('a.md', [
            '# verify b1',
            '',
            '- [ ] 週報 @2026-09-28 ==> every mon',
            '- [ ] 前の行 @2026-09-21',
            '- [x] 週報 @2026-09-21 ==> every mon',
            '- [ ] 後の行 @2026-09-21',
            '',
        ]);

        const weekly = h.tasks().filter(task => task.content === '週報');
        const fired = weekly.find(task => task.startDate === '2026-09-21')!;
        const fresh = weekly.find(task => task.startDate === '2026-09-28')!;
        expect(fired.id).toBe(before.target);
        expect(h.store.getTask(before.target)!.statusChar).toBe('x');
        expect(fresh.id).not.toBe(before.target);
        expect(h.one('前の行').id).toBe(before.prev);
        expect(h.one('後の行').id).toBe(before.next);
    });

    // verify-vault's W2 fixture: a child-mode timer writes its record under the
    // upper task, pushing the lower one down a line.
    it('W2: a timer child record inserted above leaves the lower task its ID', async () => {
        await h.write('a.md', [
            '# verify w2',
            '',
            '- [ ] 上のタスク @2026-09-21',
            '- [ ] 下のタスク @2026-09-21',
            '',
        ]);
        const before = { top: h.one('上のタスク').id, bottom: h.one('下のタスク').id };

        await h.write('a.md', [
            '# verify w2',
            '',
            '- [ ] 上のタスク @2026-09-21',
            '    - [ ] ⏱️ 上のタスク @2026-09-18T14:00 ^tv-t-abc123',
            '- [ ] 下のタスク @2026-09-21',
            '',
        ]);

        expect(h.one('上のタスク').id).toBe(before.top);
        expect(h.one('下のタスク').id).toBe(before.bottom);
        expectConsistentTree(h.store);
    });
});

describe('scan identity — whole-vault rescans', () => {
    it('a settings-driven scanVault keeps every ID', async () => {
        await h.write('a.md', ['- [ ] P @2026-09-21', '    - [ ] c @2026-09-21', '- [ ] Q @2026-09-22']);
        await h.write('b.md', ['- [ ] R @2026-09-21']);
        const before = [...h.ids('a.md'), ...h.ids('b.md')];

        await h.scanner.scanVault();

        expect([...h.ids('a.md'), ...h.ids('b.md')]).toEqual(before);
        expectConsistentTree(h.store);
    });

    it('the ledger mirrors the store after a commit', async () => {
        await h.write('a.md', ['- [ ] P @2026-09-21', '    - [ ] c @2026-09-21']);

        const ledger = h.scanner.getLedger();
        const rows = ledger.snapshotFor('a.md');
        expect(rows.map(row => row.runtimeId)).toEqual(h.ids());
        expect(ledger.get(h.one('c').id)!.parent).toBe(h.one('P').id);
    });
});

describe('scan identity — file lifecycle', () => {
    /** What TaskIndex's md → md rename handler does, in its order. */
    async function rename(oldPath: string, newPath: string): Promise<void> {
        h.contents.set(newPath, h.contents.get(oldPath)!);
        h.contents.delete(oldPath);
        h.store.removeTasksByFile(oldPath);
        h.scanner.handleFileRenamed(oldPath, newPath);
        await h.scanner.requestScan(makeFile(newPath));
    }

    it('a rename swaps only the path part, keeping numbers and edges', async () => {
        await h.write('old.md', ['- [ ] P @2026-09-21', '    - [ ] c @2026-09-21']);
        const before = { p: h.one('P', 'old.md').id, c: h.one('c', 'old.md').id };

        await rename('old.md', 'dir/new.md');

        const rewrite = (id: string) => TaskIdGenerator.renameFile(id, 'old.md', 'dir/new.md');
        expect(h.one('P', 'dir/new.md').id).toBe(rewrite(before.p));
        expect(h.one('c', 'dir/new.md').id).toBe(rewrite(before.c));
        expect(h.one('c', 'dir/new.md').parentId).toBe(rewrite(before.p));
        expect(h.scanner.getLedger().snapshotFor('old.md')).toEqual([]);
        expect(h.scanner.getLedger().snapshotFor('dir/new.md').map(row => row.runtimeId))
            .toEqual(h.ids('dir/new.md'));
        expectConsistentTree(h.store);
    });

    it('a rename onto an occupied path discards the rows that were there', async () => {
        await h.write('a.md', ['- [ ] A @2026-09-21']);
        await h.write('b.md', ['- [ ] B @2026-09-21']);
        const aId = h.one('A', 'a.md').id;
        const bId = h.one('B', 'b.md').id;

        h.store.removeTasksByFile('b.md');
        await rename('a.md', 'b.md');

        expect(h.scanner.getLedger().get(bId)).toBeUndefined();
        expect(h.one('A', 'b.md').id).toBe(TaskIdGenerator.renameFile(aId, 'a.md', 'b.md'));
    });

    it('a delete drops the file from the ledger', async () => {
        await h.write('a.md', ['- [ ] A @2026-09-21']);
        const aId = h.one('A').id;

        h.contents.delete('a.md');
        h.store.removeTasksByFile('a.md');
        h.scanner.handleFileDeleted('a.md');

        expect(h.scanner.getLedger().snapshotFor('a.md')).toEqual([]);
        expect(h.scanner.getLedger().get(aId)).toBeUndefined();
    });

    // "A retired ID never comes back": the design has no revival path, so a file
    // that leaves the index and returns is a new set of tasks.
    it('tv-ignore retires the IDs, and lifting it mints fresh ones', async () => {
        const body = ['- [ ] A @2026-09-21', '- [ ] B @2026-09-21'];
        await h.write('a.md', body);
        const before = h.ids();

        await h.write('a.md', ['---', 'tv-ignore: true', '---', ...body], { 'tv-ignore': true });
        expect(h.tasks()).toEqual([]);
        expect(h.scanner.getLedger().snapshotFor('a.md')).toEqual([]);

        h.frontmatters.delete('a.md');
        await h.write('a.md', body);
        const after = h.ids();
        expect(after).toHaveLength(2);
        for (const id of after) expect(before).not.toContain(id);
    });
});

describe('scan identity — duplicated block IDs', () => {
    // A line copied together with its `^id`. Provisional IDs used to be
    // `blk:<id>`, so the two tasks collided and one of them vanished; line-based
    // provisional IDs keep them apart.
    it('two lines sharing a ^id become two cards, each writing to its own line', async () => {
        const lines = ['- [ ] A @2026-09-21 ^dup', '- [ ] A @2026-09-21 ^dup'];
        await h.write('a.md', lines);

        const [first, second] = h.tasks();
        expect(h.tasks()).toHaveLength(2);
        expect(first.id).not.toBe(second.id);
        expectConsistentTree(h.store);

        // A write asks the scanner where its row stands. The ^id names two
        // lines and proves nothing; the file is the one the scan read, and
        // each name is answered with the line it was read from.
        expect(h.scanner.locate('a.md', lines, refOf(second))).toEqual({ kind: 'at', line: 1, edited: false });
        expect(h.scanner.locate('a.md', lines, refOf(first))).toEqual({ kind: 'at', line: 0, edited: false });
    });

    it('keeps both IDs when a line is inserted above them', async () => {
        await h.write('a.md', ['- [ ] A @2026-09-21 ^dup', '- [ ] A @2026-09-21 ^dup']);
        const before = h.ids();

        await h.write('a.md', ['- [ ] X @2026-09-21', '- [ ] A @2026-09-21 ^dup', '- [ ] A @2026-09-21 ^dup']);

        expect(h.tasks().filter(task => task.content === 'A').map(task => task.id)).toEqual(before);
    });
});
