import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { TaskScanner } from '../../../../../src/services/core/TaskScanner';
import { TaskStore } from '../../../../../src/services/core/TaskStore';
import { TaskValidator } from '../../../../../src/services/core/TaskValidator';
import { TaskParser } from '../../../../../src/services/parsing/TaskParser';
import { DEFAULT_SETTINGS } from '../../../../../src/types';
import type { Task } from '../../../../../src/types';
import type { LineEdit } from '../../../../../src/utils/FileLines';
import { makeTask } from '../../../helpers/makeTask';

/**
 * Counterexamples to comparing whole contents, found by trying to make a row
 * inherit a wrong ID once the evidence changed from the task rows to the whole
 * content. Each test states the correct outcome.
 *
 * Two of them (A and B) were wrong before the fixes they now pin: a claim kept
 * past a scan that adopted nothing, revived when the file later reached its
 * content by another path; and a key that joined an element holding a line
 * break into the same string as the split file, so a base one line out of
 * step was used. The rest pass as they did.
 *
 * Left out on purpose: the shapes where the ladder, with no claim at all,
 * pairs identically worded rows by position. That is the ladder's documented
 * limit, not something a claim did.
 */

function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.basename = file.name.replace(/\.md$/, '');
    return file;
}

const FILE = 'a.md';
const TASK = TaskParser.format(makeTask({ content: 'ポモドーロ', statusChar: ' ' }));
const DONE = TaskParser.format(makeTask({ content: 'ポモドーロ', statusChar: 'x' }));
const CHILD = '    めじるし';

class Harness {
    readonly contents = new Map<string, string>();
    readonly store = new TaskStore(DEFAULT_SETTINGS);
    readonly scanner: TaskScanner;

    constructor() {
        const app = {
            vault: {
                read: async (file: TFile) => this.contents.get(file.path) ?? '',
                getMarkdownFiles: () => [...this.contents.keys()].map(makeFile),
            },
            metadataCache: { getCache: () => null },
        };
        const flow = { handleTaskCompletion: vi.fn(async () => {}) };
        this.scanner = new TaskScanner(
            app as never, this.store, new TaskValidator(), {} as never, flow as never, DEFAULT_SETTINGS
        );
        this.scanner.setInitializing(false);
    }

    async write(lines: string[]): Promise<void> {
        this.contents.set(FILE, lines.join('\n'));
        await this.scan();
    }

    /** A reporting write; no scan follows. `before` is the file split as processLines splits it. */
    report(lines: string[], edits: LineEdit[]): void {
        const raw = this.contents.get(FILE) ?? '';
        const before = raw.split('\n').map(l => (l.endsWith('\r') ? l.slice(0, -1) : l));
        this.contents.set(FILE, lines.join('\n'));
        this.scanner.writeSink(FILE)(before, lines, edits);
    }

    /** An external edit (or an unreported write): contents change, nothing is filed. */
    set(lines: string[], eol = '\n'): void {
        this.contents.set(FILE, lines.join(eol));
    }

    async scan(): Promise<void> {
        await this.scanner.requestScan(makeFile(FILE));
    }

    tasks(): Task[] {
        return this.store.getTasks().filter(t => t.file === FILE).sort((a, b) => a.line - b.line);
    }

    ids(): string[] {
        return this.tasks().map(t => t.id);
    }

    pendingCount(): number {
        return this.scanner.getHintLog().peek().find(e => e.file === FILE)?.pending.length ?? 0;
    }
}

const inserted = (at: number, count: number): LineEdit => ({ kind: 'inserted', at, count });
const removed = (at: number, count: number): LineEdit => ({ kind: 'removed', at, count });
const replaced = (at: number): LineEdit => ({ kind: 'replaced', at });

describe('whole-content evidence: the unchanged candidate drops out on content', () => {
    it('A: a claim reverted before its scan, then matched by an unrelated edit, does not hand out its IDs', async () => {
        // Ledger: twins a, b; b has a non-task child.
        const h = new Harness();
        await h.write([TASK, TASK, CHILD, '']);
        const [a, b] = h.ids();

        // One plugin write: copy above a, delete b with its child. Truth: [copy, a].
        h.report([TASK, TASK, ''], [inserted(0, 1), removed(2, 2)]);
        expect(h.pendingCount()).toBe(1);

        // Before the write's scan reads, an external revert (sync / undo) puts
        // the file back. Truth is [a, b] again. The scan reads that; nothing moved.
        h.set([TASK, TASK, CHILD, '']);
        await h.scan();
        expect(h.ids()).toEqual([a, b]);
        // Adopted nothing, so the claim goes with it.
        expect(h.pendingCount()).toBe(0);

        // The user deletes the child line by hand. Truth: still [a, b].
        // The content is now exactly what the stale claim described.
        h.set([TASK, TASK, '']);
        await h.scan();
        expect(h.ids()).toEqual([a, b]);
    });

});

describe('whole-content evidence: a line break inside an element of next', () => {
    it('B: a base built from an array with an embedded LF is not used on the split file', async () => {
        const h = new Harness();
        await h.write([TASK, TASK, '']);
        const [a, b] = h.ids();

        // W1 inserts one element that is two lines on disk ("note", then a pasted task).
        h.report(['note\n' + TASK, TASK, TASK, ''], [inserted(0, 1)]);
        // On disk: [note, P, a, b, '']. W2 checks a (line 2).
        h.report(['note', TASK, DONE, TASK, ''], [replaced(2)]);
        await h.scan();

        const byLine = new Map(h.tasks().map(t => [t.line, t.id]));
        // Contract 1: b's ID never lands on task a's line.
        expect(byLine.get(2)).not.toBe(b);
    });

});

describe('whole-content evidence: EOL', () => {
    it('E1: a tear-down/rebuild in a CRLF file that the write turns LF is refused, not adopted', async () => {
        const h = new Harness();
        h.set([TASK, TASK, ''], '\r\n');
        await h.scan();
        const [a, b] = h.ids();
        h.report([TASK, TASK, ''], [removed(0, 1), inserted(0, 1)]);
        await h.scan();
        // Same key as the ledger: unchanged and claim both fit and disagree -> ladder.
        expect(h.ids()[1]).toBe(b);
    });

    it('E2: a mixed-EOL file unified by a copy-insert keeps the original under the copy', async () => {
        const h = new Harness();
        h.contents.set(FILE, [TASK, 'x\r', TASK, ''].join('\n'));
        await h.scan();
        const [a, b] = h.ids();
        h.report([TASK, TASK, 'x', TASK, ''], [inserted(0, 1)]);
        await h.scan();
        expect(h.ids().slice(1)).toEqual([a, b]);
    });
});

describe('whole-content evidence: content returning (A->B->A)', () => {
    it('C1: copy, scan, delete original: the copy survives, the original ID is gone', async () => {
        const h = new Harness();
        await h.write([TASK, '']);
        const [a] = h.ids();
        h.report([TASK, TASK, ''], [inserted(0, 1)]);
        await h.scan();
        const [c, a2] = h.ids();
        expect(a2).toBe(a);
        h.report([TASK, ''], [removed(1, 1)]);
        await h.scan();
        expect(h.ids()).toEqual([c]);
    });

    it('C2: copy, delete original, a scan reads the middle state late: the original ID does not survive', async () => {
        const h = new Harness();
        await h.write([TASK, '']);
        const [a] = h.ids();
        const k1 = [TASK, TASK, ''];
        h.report(k1, [inserted(0, 1)]);
        h.report([TASK, ''], [removed(1, 1)]);
        h.set(k1);
        await h.scan();
        const mid = h.ids();
        h.set([TASK, '']);
        await h.scan();
        expect(h.ids()).not.toContain(a);
        expect(h.ids()).toEqual([mid[0]]);
    });

    it('C3: check, uncheck, check across three pending claims, reads in the middle', async () => {
        const h = new Harness();
        await h.write([TASK, TASK, '']);
        const [a, b] = h.ids();
        h.report([DONE, TASK, ''], [replaced(0)]);
        h.report([TASK, TASK, ''], [replaced(0)]);
        h.report([TASK, DONE, ''], [replaced(1)]);
        h.set([TASK, TASK, '']);
        await h.scan();
        expect(h.ids()).toEqual([a, b]);
        h.set([TASK, DONE, '']);
        await h.scan();
        expect(h.ids()).toEqual([a, b]);
    });
});

describe('whole-content evidence: never-scanned file', () => {
    it('D1: two writes before the first scan, first scan reads the middle', async () => {
        const h = new Harness();
        h.set(['本文', '']);
        h.report(['本文', TASK, ''], [inserted(1, 1)]);
        h.report(['本文', TASK, TASK, ''], [inserted(1, 1)]);
        h.set(['本文', TASK, '']);
        await h.scan();
        const [x] = h.ids();
        h.set(['本文', TASK, TASK, '']);
        await h.scan();
        const ids = h.ids();
        expect(ids[1]).toBe(x);
        expect(ids[0]).not.toBe(x);
    });

    it('D3: an external edit between two writes before the first scan', async () => {
        const h = new Harness();
        h.set(['本文', '']);
        h.report(['本文', TASK, ''], [inserted(1, 1)]);
        h.set(['本文', TASK, '手', '']);
        h.report(['本文', TASK, TASK, '手', ''], [inserted(1, 1)]);
        await h.scan();
        expect(new Set(h.ids()).size).toBe(2);
    });
});
