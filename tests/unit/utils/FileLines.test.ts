import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { LineBreakInLine, draftOver, joinLines, processLines, replayEdits, splitLines } from '../../../src/utils/FileLines';
import type { LineEdit, Located, NamedRow, Refusal, TaskRef, WriteChannel } from '../../../src/utils/FileLines';
import { ON_RECORD } from '../../../src/services/persistence/RowBasis';

/**
 * The one place that decides what a line is and how the file gets put back
 * together. Every reader and every writer goes through here, so the answers
 * pinned below are the answers the whole plugin gives (#176).
 */

describe('splitLines', () => {
    it('drops the CR of a CRLF terminator', () => {
        expect(splitLines('a\r\nb\r\n')).toEqual({ lines: ['a', 'b', ''], eol: '\r\n', bom: false });
    });

    it('takes a byte order mark off the first line and says it was there', () => {
        expect(splitLines('\uFEFF- [ ] a\nb\n')).toEqual({ lines: ['- [ ] a', 'b', ''], eol: '\n', bom: true });
        // Only at the very start: a mark further in is text.
        expect(splitLines('a\n\uFEFFb').lines).toEqual(['a', '\uFEFFb']);
    });

    it('leaves an LF file alone', () => {
        expect(splitLines('a\nb\n')).toEqual({ lines: ['a', 'b', ''], eol: '\n', bom: false });
    });

    it('reads a file with no terminator at all as LF', () => {
        expect(splitLines('a')).toEqual({ lines: ['a'], eol: '\n', bom: false });
        expect(splitLines('')).toEqual({ lines: [''], eol: '\n', bom: false });
    });

    it('decides a mixed file by majority', () => {
        // 2 CRLF against 1 LF.
        expect(splitLines('a\r\nb\nc\r\n').eol).toBe('\r\n');
        // 1 CRLF against 2 LF.
        expect(splitLines('a\r\nb\nc\n').eol).toBe('\n');
    });

    it('gives a tie to LF', () => {
        expect(splitLines('a\r\nb\n').eol).toBe('\n');
    });

    it('keeps a CR that is not a terminator', () => {
        expect(splitLines('a\rb\n').lines).toEqual(['a\rb', '']);
    });

    it('does not let the last line\'s trailing CR vote, but still strips it', () => {
        // The file's one terminator is LF, so counting the stray CR would
        // rewrite the whole file to CRLF. Leaving it on the text is no better:
        // the parser's line regex ends at `$`, so a task line carrying a CR is
        // not read as a task — that CR costs the line its card (found in Dev).
        const split = splitLines('a\nb\r');
        expect(split.eol).toBe('\n');
        expect(split.lines).toEqual(['a', 'b']);
        // The fragment of a terminator that was never finished goes with it.
        expect(joinLines(split.lines, split.eol)).toBe('a\nb');
    });
});

describe('joinLines', () => {
    it('round-trips a file through split and join', () => {
        for (const text of ['a\r\nb\r\n', 'a\nb\n', 'a', '', 'a\r\nb\r\nc']) {
            const { lines, eol } = splitLines(text);
            expect(joinLines(lines, eol)).toBe(text);
        }
    });

    it('rewrites a mixed file in one terminator', () => {
        const { lines, eol } = splitLines('a\r\nb\nc\n');
        expect(joinLines(lines, eol)).toBe('a\nb\nc\n');
    });
});

function harness(initial: string, opts: { throwAfterCallback?: boolean; callbackRuns?: number } = {}) {
    let content = initial;
    let calls = 0;
    const file = new TFile();
    file.path = 'note.md';
    const app = {
        vault: {
            process: async (_f: TFile, fn: (data: string) => string) => {
                // Obsidian re-runs the callback when another write landed in
                // between, and throws when the write itself fails.
                for (let run = 0; run < (opts.callbackRuns ?? 1); run++) {
                    calls++;
                    content = fn(content);
                }
                if (opts.throwAfterCallback) throw new Error('write failed');
            },
        },
    } as never;
    return { app, file, text: () => content, calls: () => calls };
}

/** One report that reached the sink. */
interface Reported {
    before: readonly string[];
    after: readonly string[];
    /** Null for a write that changed the file and could not say how: the mark. */
    edits: readonly LineEdit[] | null;
}

/**
 * Stands in for the index's side of a write: every report handed over can be
 * taken back, and `standing` is what would still be waiting for the next scan.
 * `asked` is every question the write put to `locate`, answered by `answer`;
 * `refusals` is every refusal the channel was told.
 */
function writeSink(answer: (lines: readonly string[], ref: TaskRef) => Located = () => ({ kind: 'gone' })) {
    const reports: Reported[] = [];
    const live = new Set<number>();
    const asked: Array<{ lines: string[]; ref: TaskRef }> = [];
    const refusals: Refusal[] = [];
    const channel: WriteChannel = {
        sink: (before, after, edits) => {
            const at = reports.length;
            reports.push({ before: [...before], after: [...after], edits: edits && [...edits] });
            live.add(at);
            return { withdraw: () => { live.delete(at); }, made: [] };
        },
        locate: (lines, ref) => {
            asked.push({ lines: [...lines], ref });
            return answer(lines, ref);
        },
        onRecord: () => true,
        refused: (refusal) => { refusals.push(refusal); },
    };
    return {
        channel,
        standing: (): Reported[] => [...live].map(at => reports[at]),
        asked,
        refusals,
    };
}

describe('processLines', () => {
    it('writes the edited lines back with the file\'s own terminator', async () => {
        const h = harness('- [ ] a\r\n- [ ] b\r\n');
        const { written } = await processLines(h.app, h.file, undefined, (draft) => {
            draft.rewrite(0, '- [x] a');
            return true;
        });

        expect(written).toBe(true);
        expect(h.text()).toBe('- [x] a\r\n- [ ] b\r\n');
    });

    it('hands the edit no byte order mark, and puts the one mark back', async () => {
        const h = harness('\uFEFF- [ ] a\r\n');
        let seen: string[] = [];
        await processLines(h.app, h.file, undefined, (draft) => {
            seen = [...draft.lines];
            draft.splice(0, 0, '- [ ] new');
            return true;
        });

        expect(seen).toEqual(['- [ ] a', '']);
        expect(h.text()).toBe('\uFEFF- [ ] new\r\n- [ ] a\r\n');
    });

    it('hands the edit lines with no CR on them', async () => {
        const h = harness('- [ ] a\r\n');
        let seen: string[] = [];
        await processLines(h.app, h.file, undefined, (draft) => { seen = [...draft.lines]; return true; });

        expect(seen).toEqual(['- [ ] a', '']);
    });

    it('hands over what a write reported, with the lines either side of it', async () => {
        const h = harness('- [ ] a\n');
        const log = writeSink();

        await processLines(h.app, h.file, log.channel, (draft) => {
            draft.rewrite(0, '- [x] a');
            return true;
        });

        expect(log.standing()).toEqual([{
            before: ['- [ ] a', ''],
            after: ['- [x] a', ''],
            edits: [{ kind: 'replaced', at: 0 }],
        }]);
    });

    it('marks the chain broken for a write that reported nothing', async () => {
        // The draft's `lines` are read-only to a write; the cast simulates a
        // write that changed a line without going through `rewrite`/`splice`.
        // It claims nothing, and says it changed the file: a write of ours
        // that left neither would leave the last record looking current.
        const h = harness('- [ ] a\n');
        const log = writeSink();

        const { written } = await processLines(h.app, h.file, log.channel, (draft) => {
            (draft.lines as string[])[0] = '- [x] a';
            return true;
        });

        expect(written).toBe(true);
        expect(h.text()).toBe('- [x] a\n');
        expect(log.standing().map(report => report.edits)).toEqual([null]);
    });

    it('drops a report that does not account for the lines it wrote, and marks the chain broken', async () => {
        // The write moved a line it never mentioned. The report is bookkeeping
        // and the write is the user's, so the write lands and the report goes.
        // What is left in its place is the mark, not nothing.
        const h = harness('- [ ] a\n- [ ] b\n');
        const log = writeSink();

        const { written } = await processLines(h.app, h.file, log.channel, (draft) => {
            draft.rewrite(0, '- [x] a');
            (draft.lines as string[])[1] = '- [x] b';
            return true;
        });

        expect(written).toBe(true);
        expect(h.text()).toBe('- [x] a\n- [x] b\n');
        expect(log.standing().map(report => report.edits)).toEqual([null]);
    });

    it('drops a report whose indexes are not in the file, and marks the chain broken', async () => {
        const h = harness('- [ ] a\n');
        const log = writeSink();

        await processLines(h.app, h.file, log.channel, (draft) => {
            draft.rewrite(0, '- [x] a');
            draft.rewrite(9, '- [x] a');
            return true;
        });

        expect(log.standing().map(report => report.edits)).toEqual([null]);
    });

    it('reads a run of reports in the order they were made', async () => {
        // Each one is in the line numbers of its own moment, so an insert
        // shifts what the next one is talking about.
        const h = harness('x\ny\n');
        const log = writeSink();

        await processLines(h.app, h.file, log.channel, (draft) => {
            draft.splice(0, 0, 'new');
            draft.rewrite(1, 'X');
            return true;
        });

        expect(h.text()).toBe('new\nX\ny\n');
        expect(log.standing()[0].edits).toEqual([
            { kind: 'inserted', at: 0, count: 1 },
            { kind: 'replaced', at: 1 },
        ]);
    });

    it('drops the report of a write that changed nothing', async () => {
        // Same bytes out as in: Obsidian fires no `modify`, so no scan follows,
        // and a claim filed here would sit until it expired.
        const h = harness('- [ ] a\n');
        const log = writeSink();

        const { written } = await processLines(h.app, h.file, log.channel, (draft) => {
            draft.rewrite(0, draft.lines[0]);
            return true;
        });

        // The line was found, which is what the caller asked.
        expect(written).toBe(true);
        expect(log.standing()).toEqual([]);
    });

    it('drops the report of a write that declined', async () => {
        const h = harness('- [ ] a\n');
        const log = writeSink();

        await processLines(h.app, h.file, log.channel, (draft) => {
            draft.rewrite(0, draft.lines[0]);
            return false;
        });

        expect(log.standing()).toEqual([]);
    });

    it('takes the report back when the write throws after the callback', async () => {
        // The file never changed, so the claim describes a state that never
        // existed. Left standing, it would be weighed against whatever the
        // next scan happens to read.
        const h = harness('- [ ] a\n', { throwAfterCallback: true });
        const log = writeSink();

        await expect(processLines(h.app, h.file, log.channel, (draft) => {
            draft.rewrite(0, '- [x] a');
            return true;
        })).rejects.toThrow('write failed');

        expect(log.standing()).toEqual([]);
    });

    it('takes back the first attempt\'s report when the callback runs again', async () => {
        // Obsidian retries the callback on a conflicting write. Only the
        // attempt that actually reached disk may leave a claim behind.
        const h = harness('- [ ] a\n', { callbackRuns: 2 });
        const log = writeSink();
        let run = 0;

        await processLines(h.app, h.file, log.channel, (draft) => {
            run++;
            draft.rewrite(0, `- [x] a (${run})`);
            return true;
        });

        const standing = log.standing();
        expect(standing).toHaveLength(1);
        expect(standing[0].after).toEqual(['- [x] a (2)', '']);
    });

    it('answers the rows the last attempt made, and none when that attempt claimed nothing', async () => {
        const h = harness('- [ ] a\n', { callbackRuns: 2 });
        let filed = 0;
        const channel: WriteChannel = {
            sink: () => ({ withdraw: () => { }, made: [{ line: 1, runtimeId: `made-${++filed}` }] }),
            locate: () => ({ kind: 'gone' }),
            onRecord: () => true,
            refused: () => { },
        };
        let run = 0;

        const outcome = await processLines(h.app, h.file, channel, (draft) => {
            run++;
            draft.splice(1, 0, `- [ ] b (${run})`);
            return true;
        });
        expect(outcome.made).toEqual([{ line: 1, runtimeId: 'made-2' }]);

        // The second attempt changes nothing, so it files nothing and names nothing.
        const same = harness('- [ ] a\n', { callbackRuns: 2 });
        run = 0;
        const unchanged = await processLines(same.app, same.file, channel, (draft) => {
            run++;
            if (run === 1) draft.splice(1, 0, '- [ ] b');
            return true;
        });
        expect(unchanged.made).toEqual([]);
    });

    it('leaves the file byte-identical when the edit declines', async () => {
        const original = '- [ ] a\r\n- [ ] b\n';
        const h = harness(original);
        const outcome = await processLines(h.app, h.file, undefined, () => false);

        // Declining without a reason is not a refusal: nobody is told.
        expect(outcome).toEqual({ written: false, refused: null, made: [], left: new Map() });
        // Not even the mixed terminators are unified: a write that could not be
        // placed must leave no trace, or Obsidian fires a modify for it and a
        // rescan follows a change nobody made.
        expect(h.text()).toBe(original);
    });
});

const REF: TaskRef = { runtimeId: 'tv-inline:note.md:1' };
/** The row `REF` names, on a basis the stand-in channel always vouches for. */
const named = (subject: string): NamedRow => ({ ref: REF, subject, basis: ON_RECORD });

describe('processLines: asking where a row stands, and giving up', () => {

    it('asks the channel about the lines as they were handed in', async () => {
        const h = harness('- [ ] a\r\n- [ ] b\r\n');
        const log = writeSink(() => ({ kind: 'at', line: 1 }));

        const outcome = await processLines(h.app, h.file, log.channel, (draft, _eol, session) => {
            const at = session.row(named('b'));
            if (at === null) return false;
            draft.rewrite(at, '- [x] b');
            return true;
        });

        expect(log.asked).toEqual([{ lines: ['- [ ] a', '- [ ] b', ''], ref: REF }]);
        expect(outcome).toEqual({ written: true, refused: null, made: [], left: new Map([[REF.runtimeId, ['- [x] b']]]) });
        expect(h.text()).toBe('- [ ] a\r\n- [x] b\r\n');
        expect(log.refusals).toEqual([]);
    });

    it('refuses through row when the channel has no line to give', async () => {
        const h = harness('- [ ] a\n');
        const log = writeSink(() => ({ kind: 'ambiguous', count: 2 }));

        const outcome = await processLines(h.app, h.file, log.channel, (draft, _eol, session) => {
            const at = session.row(named('a'));
            if (at === null) return false;
            draft.rewrite(at, '- [x] a');
            return true;
        });

        const refusal = { file: 'note.md', reason: { kind: 'ambiguous', count: 2 }, subject: 'a' };
        expect(outcome).toEqual({ written: false, refused: refusal, made: [], left: new Map() });
        expect(log.refusals).toEqual([refusal]);
        expect(h.text()).toBe('- [ ] a\n');
    });

    it('finds every target gone when there is no channel to ask', async () => {
        const h = harness('- [ ] a\n');

        const outcome = await processLines(h.app, h.file, undefined, (_draft, _eol, session) => {
            return session.row(named('a')) !== null;
        });

        expect(outcome).toEqual({
            written: false,
            refused: { file: 'note.md', reason: { kind: 'gone' }, subject: 'a' },
            made: [],
            left: new Map(),
        });
        expect(h.text()).toBe('- [ ] a\n');
    });

    it('tells the channel of a refusal exactly once', async () => {
        const h = harness('- [ ] a\n');
        const log = writeSink();

        const outcome = await processLines(h.app, h.file, log.channel, (_draft, _eol, session) =>
            session.refuse({ kind: 'changed' }, '- [ ] a'));

        const refusal = { file: 'note.md', reason: { kind: 'changed' }, subject: '- [ ] a' };
        expect(outcome).toEqual({ written: false, refused: refusal, made: [], left: new Map() });
        expect(log.refusals).toEqual([refusal]);
        expect(h.text()).toBe('- [ ] a\n');
    });

    it('tells the channel once even when the callback runs again', async () => {
        // Obsidian may run the callback twice. Each run refuses, and the user
        // hears about the write once — after `vault.process`, not from inside.
        const h = harness('- [ ] a\n', { callbackRuns: 2 });
        const log = writeSink();

        const outcome = await processLines(h.app, h.file, log.channel, (_draft, _eol, session) =>
            session.refuse({ kind: 'changed' }, '- [ ] a'));

        expect(h.calls()).toBe(2);
        expect(log.refusals).toEqual([{ file: 'note.md', reason: { kind: 'changed' }, subject: '- [ ] a' }]);
        expect(outcome.refused).toEqual(log.refusals[0]);
    });

    it('tells nobody of a refusal the second run took back by writing', async () => {
        // The first run gave up; the run that reached disk wrote. The outcome
        // is the second run's.
        const h = harness('- [ ] a\n', { callbackRuns: 2 });
        const log = writeSink();
        let run = 0;

        const outcome = await processLines(h.app, h.file, log.channel, (draft, _eol, session) => {
            run++;
            if (run === 1) return session.refuse({ kind: 'gone' }, 'a');
            draft.rewrite(0, '- [x] a');
            return true;
        });

        expect(outcome).toEqual({ written: true, refused: null, made: [], left: new Map() });
        expect(log.refusals).toEqual([]);
        expect(h.text()).toBe('- [x] a\n');
    });

});

describe('a coordinate carried across a write\'s own edits', () => {
    const at = (line: number): Located => ({ kind: 'at', line });

    it('asks the channel once per name, about the lines as they were handed in', async () => {
        const h = harness('- [ ] a\n- [ ] b\n');
        const log = writeSink(() => at(1));

        await processLines(h.app, h.file, log.channel, (draft, _eol, session) => {
            session.row(named('b'));
            draft.splice(0, 0, 'new');
            session.row(named('b'));
            session.row(named('b'));
            return true;
        });

        expect(log.asked).toEqual([{ lines: ['- [ ] a', '- [ ] b', ''], ref: REF }]);
    });

    it('follows the row down past lines the write put above it, and up past lines it took away', async () => {
        const h = harness('x\ny\n- [ ] b\nz\n');
        const log = writeSink(() => at(2));
        const seen: Array<number | null> = [];

        await processLines(h.app, h.file, log.channel, (draft, _eol, session) => {
            draft.splice(0, 0, 'n1', 'n2');
            seen.push(session.row(named('b')));
            draft.splice(0, 3);
            seen.push(session.row(named('b')));
            // Below the row: it stays where it is.
            draft.splice(2, 1);
            seen.push(session.row(named('b')));
            return true;
        });

        expect(seen).toEqual([4, 1, 1]);
        expect(h.text()).toBe('y\n- [ ] b\n');
    });

    it('keeps a row the write rewrote, and loses one it took away', async () => {
        const h = harness('- [ ] a\n- [ ] b\n');
        const log = writeSink(() => at(0));
        const seen: Array<number | null> = [];

        await processLines(h.app, h.file, log.channel, (draft, _eol, session) => {
            draft.rewrite(0, '- [x] a');
            seen.push(session.row(named('a')));
            draft.splice(0, 1);
            return session.row(named('a')) !== null;
        });

        expect(seen).toEqual([0]);
        expect(h.text()).toBe('- [ ] a\n- [ ] b\n');
        expect(log.refusals).toEqual([{ file: 'note.md', reason: { kind: 'gone' }, subject: 'a' }]);
    });

    it('refuses the write when a splice went round the report and moved the row', async () => {
        const h = harness('- [ ] a\n- [ ] b\n');
        const log = writeSink(() => at(1));

        await expect(processLines(h.app, h.file, log.channel, (draft, _eol, session) => {
            draft.splice(0, 0, 'reported');
            // Bypasses the draft's own bookkeeping — the same array, mutated
            // without going through `splice`, to simulate an edit that never
            // reported itself.
            (draft.lines as string[]).splice(0, 0, 'not reported');
            session.row(named('b'));
            return true;
        })).rejects.toThrow('does not read what it read');
        expect(h.text()).toBe('- [ ] a\n- [ ] b\n');
    });

    it('refuses the write when an unreported splice left the row reading the same', async () => {
        // Twins: the line the carried coordinate lands on reads like the row,
        // so only the report's account of the whole file can say it moved.
        const h = harness('- [ ] a\n- [ ] a\n- [ ] a\n');
        const log = writeSink(() => at(1));

        await expect(processLines(h.app, h.file, log.channel, (draft, _eol, session) => {
            draft.splice(3, 0, 'reported');
            (draft.lines as string[]).splice(0, 1);
            const line = session.row(named('a'));
            if (line === null) return false;
            draft.rewrite(line, '- [x] a');
            return true;
        })).rejects.toThrow('does not account for the lines it wrote');
        expect(h.text()).toBe('- [ ] a\n- [ ] a\n- [ ] a\n');
    });
});

describe('LineEdits.splice', () => {
    // `Array.prototype.splice` normalizes what it is handed: a negative index
    // counts back from the end, an index past the end is clamped to it, a
    // count past the end takes what is there, and a count that is not a
    // number takes nothing. A report of the *arguments* would describe a file
    // that was never written, so what is reported is what happened.
    const cases: Array<{ name: string; at: number; del: number; items: string[] }> = [
        { name: 'an ordinary insert', at: 1, del: 0, items: ['new'] },
        { name: 'an index past the end', at: 9, del: 0, items: ['new'] },
        { name: 'an index counted from the end', at: -1, del: 0, items: ['new'] },
        { name: 'an index before the start', at: -9, del: 0, items: ['new'] },
        { name: 'an index of Infinity', at: Infinity, del: 0, items: ['new'] },
        { name: 'a removal', at: 1, del: 2, items: [] },
        { name: 'a removal past the end', at: 1, del: 99, items: [] },
        { name: 'a negative count', at: 1, del: -3, items: ['new'] },
        { name: 'a count that is not a number', at: 1, del: NaN, items: ['new'] },
        { name: 'a removal and an insert at once', at: 0, del: 1, items: ['x', 'y'] },
    ];

    for (const { name, at, del, items } of cases) {
        it(`accounts for the file it wrote: ${name}`, async () => {
            const h = harness('a\nb\nc\nd\n');
            const log = writeSink();
            const expected = ['a', 'b', 'c', 'd', ''];
            expected.splice(at, del, ...items);

            await processLines(h.app, h.file, log.channel, (draft) => {
                draft.splice(at, del, ...items);
                return true;
            });

            expect(h.text()).toBe(expected.join('\n'));
            // A report that does not account for the file it produced is
            // dropped, so a report still standing is a report that was right.
            expect(log.standing()).toHaveLength(1);
        });
    }

    it('says where the lines landed, not where it was asked to put them', () => {
        const lines = ['a', 'b'];
        const { draft, reported } = draftOver(lines);

        draft.splice(9, 0, 'new');
        draft.splice(-1, 1);

        expect(lines).toEqual(['a', 'b']);
        expect(reported).toEqual([
            { kind: 'inserted', at: 2, count: 1 },
            { kind: 'removed', at: 2, count: 1 },
        ]);
    });

    it('splices the lines the write was handed', () => {
        // Not an argument: the array is the one `processLines` is about to
        // write, so a report cannot end up describing some other array.
        const lines = ['a'];
        const { draft } = draftOver(lines);

        draft.splice(1, 0, 'b');

        expect(lines).toEqual(['a', 'b']);
    });

});

describe('LineEdits.carry', () => {
    // A splice puts in new lines only. A move within one file puts a line in
    // at the end and takes it away from where it stood, and without a way to
    // say "this is that line" the report calls the moved row new.

    it('says the carried line is the one it was, wherever it lands', () => {
        const lines = ['a', 'row', 'child', 'b'];
        const { draft, reported } = draftOver(lines);

        draft.carry(4, [{ from: 1, text: 'row, archived' }, { from: 2, text: 'child' }]);
        draft.splice(1, 2);

        expect(lines).toEqual(['a', 'b', 'row, archived', 'child']);
        const replayed = replayEdits(4, reported);
        expect(replayed?.origin).toEqual([0, 3, 1, 2]);
        // Only the line whose text changed is reported rewritten.
        expect(replayed?.rewritten).toEqual([false, false, true, false]);
    });

    it('reads its source before the lines move under it', () => {
        const lines = ['row', 'a'];
        const { draft, reported } = draftOver(lines);

        // The source stands past `at`, so the insert moves it down by one.
        draft.carry(0, [{ from: 1, text: 'a' }]);
        draft.splice(2, 1);

        expect(lines).toEqual(['a', 'row']);
        expect(replayEdits(2, reported)?.origin).toEqual([1, 0]);
        expect(reported.some(edit => edit.kind === 'replaced')).toBe(false);
    });

    it('is not a report a file could follow while the source still stands', () => {
        // One line in two places would give one name to two rows.
        const lines = ['a', 'row'];
        const { draft, reported } = draftOver(lines);

        draft.carry(2, [{ from: 1, text: 'row' }]);

        expect(replayEdits(2, reported)).toBeNull();
    });

    it('is not a report a file could follow from a line that is not there', () => {
        const lines = ['a'];
        const { draft, reported } = draftOver(lines);

        draft.carry(1, [{ from: 5, text: 'x' }]);

        expect(replayEdits(1, reported)).toBeNull();
    });

    it('files a claim for a move that took its source away, and only the mark for one that did not', async () => {
        for (const takeAway of [true, false]) {
            const h = harness('a\nrow\nb\n');
            const log = writeSink();

            await processLines(h.app, h.file, log.channel, (draft) => {
                draft.splice(3, 1);
                draft.carry(3, [{ from: 1, text: 'row, moved' }]);
                if (takeAway) draft.splice(1, 1);
                return true;
            });

            expect(h.text()).toBe(takeAway ? 'a\nb\nrow, moved' : 'a\nrow\nb\nrow, moved');
            expect(log.standing()).toHaveLength(1);
            expect(log.standing()[0].edits === null).toBe(!takeAway);
        }
    });
});

describe('one element, one line', () => {
    // An element holding a break is written as two lines while the report,
    // the claim and the content key count one. The draft takes none.
    const breaks = ['a\nb', 'a\rb', 'a\r\nb', '\n'];

    it.each(breaks)('the draft refuses %j through splice, rewrite and carry, and changes nothing', (text) => {
        const lines = ['x', 'y'];
        const { draft, reported } = draftOver(lines);
        expect(() => draft.splice(1, 0, 'ok', text)).toThrow(LineBreakInLine);
        expect(() => draft.rewrite(0, text)).toThrow(LineBreakInLine);
        expect(() => draft.carry(2, [{ from: 0, text }])).toThrow(LineBreakInLine);
        expect(lines).toEqual(['x', 'y']);
        expect(reported).toEqual([]);
    });

    it('a write that hands one over writes nothing and files nothing', async () => {
        const h = harness('- [ ] a\n');
        const log = writeSink();
        // In a development build the write throws, so the bug is seen; a
        // release build logs it and leaves the file as it was.
        await expect(processLines(h.app, h.file, log.channel, (draft) => {
            draft.splice(1, 0, '- [ ] b\n- [ ] c');
            return true;
        })).rejects.toThrow(/line break/);
        expect(h.text()).toBe('- [ ] a\n');
        expect(log.standing()).toEqual([]);
    });
});
