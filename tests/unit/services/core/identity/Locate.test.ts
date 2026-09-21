import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { TaskScanner } from '../../../../../src/services/core/TaskScanner';
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

    lines(): string[] {
        return (this.contents.get(FILE) ?? '').split('\n');
    }

    async write(lines: string[]): Promise<void> {
        this.contents.set(FILE, lines.join('\n'));
        await this.scan();
    }

    /** A write that reports its lines, with no scan following. */
    report(lines: string[], edits: LineEdit[]): void {
        const before = this.lines();
        this.contents.set(FILE, lines.join('\n'));
        this.scanner.writeSink(FILE)(before, lines, edits);
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

    /** The names the pending claims carry, newest last. */
    claimed(): string[][] {
        const entry = this.scanner.getHintLog().peek().find(candidate => candidate.file === FILE);
        return (entry?.pending ?? []).map(pending => pending.hint.rows.map(row => row.runtimeId));
    }

    locate(ref: TaskRef | string): Located {
        return this.scanner.locate(FILE, this.lines(), typeof ref === 'string' ? { runtimeId: ref } : ref);
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
        harness.report([TASK, TASK, ''], [{ kind: 'inserted', at: 0, count: 1 }]);
        expect(harness.locate(original)).toEqual(at(1));

        // The line the write made has a name of its own already, and the
        // record knows where it is.
        const [made] = harness.claimed()[0];
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

    it('weighs the pending claims the way the next scan will', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);
        const [original] = harness.ids();

        // W1 copies below, W2 removes the upper line; W2 is undone from
        // outside, and a scan reads W1's file and keeps W2 pending.
        harness.report([TASK, TASK, ''], [{ kind: 'inserted', at: 1, count: 1 }]);
        harness.report([TASK, ''], [{ kind: 'removed', at: 0, count: 1 }]);
        harness.edit([TASK, TASK, '']);
        await harness.scan();
        const [, copy] = harness.ids();

        // The file reaches W2's content by another route. Nothing on record
        // describes it (the scan dropped the base), so it comes to matching,
        // and matching adopts W2 as the scan will (E1, see HintedScanning):
        // the one line is the copy's.
        harness.edit([TASK, '']);
        expect(harness.locate(copy)).toEqual(at(0));
        expect(harness.locate(original)).toEqual(gone);
    });

    it('answers gone for a row a write made when the file bears nothing out', async () => {
        const harness = new Harness();
        await harness.write([TASK, '']);

        harness.report([TASK, OTHER, ''], [{ kind: 'inserted', at: 1, count: 1 }]);
        const made = harness.claimed()[0][1];
        expect(harness.locate(made)).toEqual(at(1));

        // Something else edits the file before any scan. The made row's name
        // is on no record the file matches, and its text is all that is left.
        harness.edit([TASK, OTHER, 'synced']);
        expect(harness.locate(made)).toEqual(gone);
    });
});

describe('locate writes nothing down', () => {
    it('leaves the ledger, the claims and the next scan as they were', async () => {
        const harness = new Harness();
        await harness.write([TASK, TASK, '']);
        harness.report([TASK, TASK, TASK, ''], [{ kind: 'inserted', at: 0, count: 1 }]);
        harness.edit(['メモ', TASK, TASK, TASK, '']);
        const claimed = harness.claimed();
        const ids = harness.ids();

        for (const id of ids) harness.locate(id);

        expect(harness.claimed()).toEqual(claimed);
        expect(harness.ids()).toEqual(ids);
    });
});
