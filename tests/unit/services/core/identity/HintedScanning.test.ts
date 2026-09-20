import { describe, it, expect, vi, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { TaskScanner } from '../../../../../src/services/core/TaskScanner';
import { TaskStore } from '../../../../../src/services/core/TaskStore';
import { TaskValidator } from '../../../../../src/services/core/TaskValidator';
import { HINT_TTL_MS, type Hint } from '../../../../../src/services/core/identity/IdentityHints';
import { DEFAULT_SETTINGS } from '../../../../../src/types';
import type { Task } from '../../../../../src/types';

/**
 * Hints through the real scanner: raised by a write, verified against what the
 * next scan reads, and retired by that scan's commit.
 *
 * The matcher's tests decide what a believed hint means. These decide which
 * hints a scan gets to believe — the part that depends on the order of writes,
 * reads and commits, and on hints that never found their scan.
 */

function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.basename = file.name.replace(/\.md$/, '');
    return file;
}

const FILE = 'a.md';
const TASK = '- [ ] ポモドーロ';

class Harness {
    readonly contents = new Map<string, string>();
    readonly store = new TaskStore(DEFAULT_SETTINGS);
    readonly scanner: TaskScanner;
    /** Held while a read is in flight, so a scan can be paused mid-flight. */
    private gate: Promise<void> | null = null;

    constructor() {
        const app = {
            vault: {
                read: async (file: TFile) => {
                    if (this.gate) await this.gate;
                    return this.contents.get(file.path) ?? '';
                },
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

    /** A write: the hints go in from inside the callback, as the writer does. */
    async write(lines: string[], ...hints: Hint[]): Promise<void> {
        this.contents.set(FILE, lines.join('\n'));
        if (hints.length > 0) this.scanner.addHints(FILE, hints);
        await this.scanner.requestScan(makeFile(FILE));
    }

    /** Raise hints without a scan following them — a write during a drag. */
    hintOnly(lines: string[], ...hints: Hint[]): void {
        this.contents.set(FILE, lines.join('\n'));
        this.scanner.addHints(FILE, hints);
    }

    async scan(): Promise<void> {
        await this.scanner.requestScan(makeFile(FILE));
    }

    /** Start a scan, hold it at the read, and return a release function. */
    holdRead(): { release: () => void; scanning: Promise<void> } {
        let release!: () => void;
        this.gate = new Promise<void>(resolve => { release = resolve; });
        const scanning = this.scan();
        return {
            release: () => { this.gate = null; release(); },
            scanning,
        };
    }

    tasks(): Task[] {
        return this.store.getTasks()
            .filter(task => task.file === FILE)
            .sort((a, b) => a.line - b.line);
    }

    ids(): string[] {
        return this.tasks().map(task => task.id);
    }
}

let clock: ReturnType<typeof vi.useFakeTimers> | undefined;
afterEach(() => {
    if (clock) vi.useRealTimers();
    clock = undefined;
});

describe('a hint through the scanner', () => {
    it('keeps the original\'s ID when a duplicate is written above it', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        await harness.write(
            [TASK, TASK, ''],
            { kind: 'insert', text: TASK, line: 0 },
        );

        // The copy is the new line; the original kept what it had.
        expect(harness.ids()[1]).toBe(original);
        expect(harness.ids()[0]).not.toBe(original);
    });

    it('is not believed twice', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        await harness.write([TASK, TASK, ''], { kind: 'insert', text: TASK, line: 0 });
        const afterCopy = harness.ids();

        // An unrelated scan of the same file: the hint is spent, so nothing
        // moves.
        await harness.scan();
        expect(harness.ids()).toEqual(afterCopy);
        expect(harness.ids()[1]).toBe(original);
    });
});

describe('a hint that found no scan of its own', () => {
    it('is dropped by the next scan that read past it', async () => {
        // The shape that would otherwise block a file for the whole TTL: a hint
        // goes unverified (an external edit arrived in the same scan), the
        // ledger moves on, and every later hint is measured against a state
        // that hint is already folded into.
        const harness = new Harness();
        await harness.write([TASK, '']);

        // A write whose hint cannot verify, because a hand edit came with it.
        await harness.write(
            [TASK, TASK, '- [ ] 手で書いた行', ''],
            { kind: 'insert', text: TASK, line: 0 },
        );
        const stranded = harness.ids();

        // The next write's hint has to work regardless.
        const secondCopy = [TASK, TASK, TASK, '- [ ] 手で書いた行', ''];
        await harness.write(secondCopy, { kind: 'insert', text: TASK, line: 0 });

        // Two of the three previous IDs survive in the lines below the new one.
        expect(harness.ids().slice(1, 3)).toEqual(stranded.slice(0, 2));
        expect(harness.ids()[0]).not.toBe(stranded[0]);
    });

    it('expires rather than waiting forever', async () => {
        clock = vi.useFakeTimers();
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        // A write made while scans are suppressed (a drag): the hint is filed,
        // but no scan follows it.
        harness.hintOnly([TASK, TASK, ''], { kind: 'insert', text: TASK, line: 0 });
        vi.advanceTimersByTime(HINT_TTL_MS);

        // Whatever finally scans this file gets no help from it.
        await harness.scan();
        expect(harness.ids()[1]).not.toBe(original);
        expect(harness.ids()[0]).toBe(original);
    });

    it('is believed by a scan whose read overlapped the write', async () => {
        // The scan took its position in the log before this write existed, but
        // its read still saw the write's lines. Measured: a scan's read can
        // span a later write. Belief follows the read, not the position — the
        // position only decides what may be retired.
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        const held = harness.holdRead();
        harness.hintOnly([TASK, TASK, ''], { kind: 'insert', text: TASK, line: 0 });
        held.release();
        await held.scanning;

        expect(harness.ids()[1]).toBe(original);
        expect(harness.ids()[0]).not.toBe(original);
    });

    it('is dropped, not trusted, when the scan read the file before the write landed', async () => {
        // The window that stays open: a hint is raised inside the write
        // callback, a moment before the file reaches disk. A scan starting in
        // between takes a position *above* the hint and reads text from
        // *before* it. The hint verifies against nothing and its scan's commit
        // retires it, so the write's own scan falls to the ladder. The
        // mechanism loses here; it does not lie.
        const harness = new Harness();
        await harness.write([TASK, '']);
        const original = harness.ids()[0];

        // Raised, but the file still reads as it did.
        harness.scanner.addHints(FILE, [{ kind: 'insert', text: TASK, line: 0 }]);
        await harness.scan();
        expect(harness.ids()).toEqual([original]);

        // Now the write lands, and its own scan follows.
        await harness.write([TASK, TASK, '']);

        // No hint left: the ladder answers, which is what it did before hints
        // existed — the copy takes the old ID.
        expect(harness.ids()[0]).toBe(original);
        expect(harness.ids()[1]).not.toBe(original);
    });
});
