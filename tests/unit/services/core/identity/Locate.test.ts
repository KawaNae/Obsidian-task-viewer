import { NoticedFiles } from '../../../helpers/noticedFiles';
import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { TaskScanner } from '../../../../../src/services/core/TaskScanner';
import { EditorSignal } from '../../../../../src/services/core/EditorSignal';
import { TaskStore } from '../../../../../src/services/core/TaskStore';
import { TaskValidator } from '../../../../../src/services/core/TaskValidator';
import { TaskParser } from '../../../../../src/services/parsing/TaskParser';
import { DEFAULT_SETTINGS } from '../../../../../src/types';
import type { Task } from '../../../../../src/types';
import type { LineEdit, Located, TaskRef } from '../../../../../src/utils/FileLines';
import { makeTask } from '../../../helpers/makeTask';

/**
 * `TaskScanner.locate`: where the row a write names stands in the lines the
 * write was handed.
 *
 * Every case is a file the scanner has really read, a write that really
 * reported, or both, so the ledger, the claim log and the write's base are the
 * ones a running plugin would hold.
 */

function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.basename = file.name.replace(/\.md$/, '');
    return file;
}

const FILE = 'a.md';
const line = (content: string, statusChar = ' ') => TaskParser.format(makeTask({ content, statusChar }));
const TASK = line('ポモドーロ');
const OTHER = line('資料集め');

class Harness {
    readonly contents = new NoticedFiles();
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
            app as never, this.store, new TaskValidator(), new EditorSignal(), flow as never, DEFAULT_SETTINGS
        );
        this.scanner.setInitializing(false);
        this.contents.listen(path => this.scanner.noteChange(path));
    }

    lines(): string[] {
        return (this.contents.get(FILE) ?? '').split('\n');
    }

    async write(lines: string[]): Promise<void> {
        this.contents.set(FILE, lines.join('\n'));
        await this.scan();
    }

    /** A write that reports its lines, with no scan following. Answers the names it made. */
    report(lines: string[], edits: LineEdit[]): string[] {
        const before = this.lines();
        // Filed before the bytes land, as from inside `vault.process`.
        const receipt = this.scanner.writeSink(FILE, 'user')(before, lines, edits, null);
        this.contents.set(FILE, lines.join('\n'));
        return receipt.made.map(row => row.runtimeId);
    }

    /** Something other than the plugin changed the file. */
    edit(lines: string[]): void {
        this.contents.set(FILE, lines.join('\n'));
    }

    async scan(): Promise<void> {
        await this.scanner.requestScan(makeFile(FILE));
    }

    tasks(): Task[] {
        return this.store.getTasks().filter(task => task.file === FILE).sort((a, b) => a.line - b.line);
    }

    ids(): string[] {
        return this.tasks().map(task => task.id);
    }


    locate(ref: TaskRef | string): Located {
        return this.scanner.locate(FILE, this.lines(), typeof ref === 'string' ? { runtimeId: ref } : ref);
    }

    /** Whether the line reads as a text on record for the row (`TaskScanner.onRecord`). */
    onRecord(ref: TaskRef | string, line: number): boolean {
        return this.scanner.onRecord(FILE, this.lines(), typeof ref === 'string' ? { runtimeId: ref } : ref, line);
    }
}

const at = (line: number): Located => ({ kind: 'at', line });
const ambiguous = (count: number): Located => ({ kind: 'ambiguous', count });
const gone: Located = { kind: 'gone' };

describe('locate by ^id', () => {
    it('answers the one line that carries the id, where matching could only guess', async () => {
        const harness = new Harness();
        // The line was copied along with its id, so the last scan read two.
        await harness.write([`${TASK} ^keep`, `${TASK} ^keep`, '']);
        const [, lower] = harness.ids();

        // One copy goes and a line comes in above, from outside. Matching has
        // two identical rows on record against one line — a guess by
        // position — but the id now names exactly one line.
        harness.edit(['メモ', `${TASK} ^keep`, '']);
        expect(harness.locate({ runtimeId: lower, blockId: 'keep' })).toEqual(at(1));
        // Without the id to go on, the same question is a guess.
        expect(harness.locate(lower)).toEqual(ambiguous(2));
    });

    it('is not taken when the id names two lines', async () => {
        const harness = new Harness();
        await harness.write([`${TASK} ^keep`, `${OTHER} ^keep`, '']);
        const [first, second] = harness.ids();

        // The copy carried the id along. The file is still the one the scan
        // read, so the record answers — and answers each name separately.
        expect(harness.locate({ runtimeId: second, blockId: 'keep' })).toEqual(at(1));
        expect(harness.locate({ runtimeId: first, blockId: 'keep' })).toEqual(at(0));
    });

    it('does not count an id inside a code fence', async () => {
        const harness = new Harness();
        await harness.write([`${TASK} ^keep`, `${TASK} ^keep`, '']);
        const [, lower] = harness.ids();

        // A quoted sample of the line sits in a fence above the real one.
        harness.edit(['```', `${TASK} ^keep`, '```', `${TASK} ^keep`, '']);
        expect(harness.locate({ runtimeId: lower, blockId: 'keep' })).toEqual(at(3));
    });
});

describe('locate on a content on record', () => {
    it('answers identical rows apart when the file is the one the scan read', async () => {
        const harness = new Harness();
        await harness.write([TASK, TASK, TASK, '']);
        const ids = harness.ids();

        expect(ids.map(id => harness.locate(id))).toEqual([at(0), at(1), at(2)]);
    });

    it('answers from what the last write left before any scan reads it', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);
        const [original] = harness.ids();

        // A copy goes in above. The ledger still says line 0; the write's own
        // record says the original moved down.
        const [made] = harness.report([TASK, TASK, ''], [{ kind: 'inserted', at: 0, count: 1 }]);
        expect(harness.locate(original)).toEqual(at(1));

        // The line the write made has a name of its own already, and the
        // record knows where it is.
        expect(harness.locate(made)).toEqual(at(0));
    });

    it('answers gone for a name the recorded content does not hold', async () => {
        const harness = new Harness();
        await harness.write([TASK, OTHER, '']);
        const [, other] = harness.ids();

        harness.report([TASK, ''], [{ kind: 'removed', at: 1, count: 1 }]);
        expect(harness.locate(other)).toEqual(gone);
    });
});

describe('locate by matching, when the content is not on record', () => {
    it('follows a row that moved under an edit from outside', async () => {
        const harness = new Harness();
        await harness.write([TASK, OTHER, '']);
        const [, other] = harness.ids();

        harness.edit(['# 見出し', '', TASK, OTHER, '']);
        expect(harness.locate(other)).toEqual(at(3));
    });

    it('follows a row whose line above was deleted from outside', async () => {
        const harness = new Harness();
        await harness.write(['メモ', TASK, OTHER, '']);
        const [, other] = harness.ids();

        harness.edit([TASK, OTHER, '']);
        expect(harness.locate(other)).toEqual(at(1));
    });

    it('refuses to choose among identical rows by position', async () => {
        const harness = new Harness();
        await harness.write([TASK, TASK, '']);
        const [upper, lower] = harness.ids();

        // A line inserted above from outside. The two rows still read alike;
        // which is which is now a guess.
        harness.edit(['メモ', TASK, TASK, '']);
        expect(harness.locate(upper)).toEqual(ambiguous(2));
        expect(harness.locate(lower)).toEqual(ambiguous(2));
    });

    it('answers gone for a row deleted from outside', async () => {
        const harness = new Harness();
        await harness.write([TASK, OTHER, '']);
        const [, other] = harness.ids();

        harness.edit(['メモ', TASK, '']);
        expect(harness.locate(other)).toEqual(gone);
    });

    it('weighs what our writes left the way the next scan will (E1, closed in I1)', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);
        const [original] = harness.ids();

        // W1 copies below, W2 removes the upper line; W2 is undone from
        // outside, and a scan reads W1's file. The undo came after W2, so the
        // read is W1's lines put back or a change after W2 that reads the
        // same; the two name both lines differently, and both are new. The
        // scan has seen the undo, so W2 goes with it.
        harness.report([TASK, TASK, ''], [{ kind: 'inserted', at: 1, count: 1 }]);
        harness.report([TASK, ''], [{ kind: 'removed', at: 0, count: 1 }]);
        harness.edit([TASK, TASK, '']);
        await harness.scan();
        const [upper, lower] = harness.ids();
        expect([upper, lower]).not.toContain(original);
        expect(harness.scanner.getWriteClaims().peek(FILE).links).toEqual([]);

        // The file reaches W2's content by another route. W2 is not on record
        // to name the line; the ladder pairs it against the two rows that
        // read alike, by position, and a write refuses on a guess.
        harness.edit([TASK, '']);
        expect(harness.locate(lower)).toEqual({ kind: 'ambiguous', count: 2 });
        expect(harness.locate(upper)).toEqual({ kind: 'ambiguous', count: 2 });
        expect(harness.locate(original)).toEqual(gone);
    });

    it('finds a row a write made after something else edited the file (F5b)', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);

        const [made] = harness.report([TASK, OTHER, ''], [{ kind: 'inserted', at: 1, count: 1 }]);
        expect(harness.locate(made)).toEqual(at(1));

        // Something else edits the file before any scan. No record matches
        // the file, but the edit came after the write, so the next scan
        // pairs against what the write left and gives the row the name the
        // write made (`WriteClaims.ladderFor`). Until F5b the scan paired
        // against the ledger, which never heard the name, and this was gone.
        harness.edit([TASK, OTHER, 'synced']);
        expect(harness.locate(made)).toEqual(at(1));
    });
});

/**
 * Whether the line reads as the write planned is not `locate`'s question: it
 * answers the row's line, and the write checks its basis there
 * (`WriteSession.row`). The weaker question the timer's inserts keep until F9
 * — does the line read as any text on record for the row — is `onRecord`.
 */
describe('locate answers the row\'s line whatever it reads; onRecord says whether that is a text on record', () => {
    it('pairs a row the ladder matched though its text changed, which is not on record', async () => {
        const harness = new Harness();
        const dated = (content: string) => TaskParser.format(makeTask({ content, statusChar: ' ', startDate: '2026-08-15' }));
        await harness.write([dated('設計'), '']);
        const [task] = harness.ids();

        // The name changed, the date did not: still the row, not its text.
        harness.edit([dated('設計書'), '']);
        expect(harness.locate(task)).toEqual(at(0));
        expect(harness.onRecord(task, 0)).toBe(false);
    });

    it('answers a ^id line whose text changed, which is not on record', async () => {
        const harness = new Harness();
        await harness.write([`${TASK} ^keep`, '']);
        const [task] = harness.ids();

        harness.edit([`${OTHER} ^keep`, '']);
        expect(harness.locate({ runtimeId: task, blockId: 'keep' })).toEqual(at(0));
        expect(harness.onRecord({ runtimeId: task, blockId: 'keep' }, 0)).toBe(false);
    });

    it('finds a line only the plugin changed on record', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);
        const [task] = harness.ids();

        // Our own rewrite, then an edit elsewhere from outside, no scan.
        harness.report([OTHER, ''], [{ kind: 'replaced', at: 0 }]);
        harness.edit(['メモ', OTHER, '']);
        expect(harness.locate(task)).toEqual(at(1));
        expect(harness.onRecord(task, 1)).toBe(true);
    });

    it('finds it on record however long the write has waited for its scan: a record does not age (I1)', async () => {
        vi.useFakeTimers();
        try {
            const harness = new Harness();
            await harness.write([TASK, '']);
            const [task] = harness.ids();

            harness.report([OTHER, ''], [{ kind: 'replaced', at: 0 }]);
            vi.advanceTimersByTime(60 * 60 * 1000);
            harness.edit(['メモ', OTHER, '']);
            expect(harness.locate(task)).toEqual(at(1));
            expect(harness.onRecord(task, 1)).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('locate writes nothing down', () => {
    it('leaves the ledger, the claims and the next scan as they were', async () => {
        const harness = new Harness();
        await harness.write([TASK, TASK, '']);
        harness.report([TASK, TASK, TASK, ''], [{ kind: 'inserted', at: 0, count: 1 }]);
        harness.edit(['メモ', TASK, TASK, TASK, '']);
        const chain = harness.scanner.getWriteClaims().peek(FILE);
        const ids = harness.ids();

        for (const id of ids) harness.locate(id);

        expect(harness.scanner.getWriteClaims().peek(FILE)).toEqual(chain);
        expect(harness.ids()).toEqual(ids);
    });
});
