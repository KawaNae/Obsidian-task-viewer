import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { BrokenWrite, LineBreakInLine, draftOver, joinLines, processLines, replayEdits, splitLines } from '../../../src/utils/FileLines';
import type { LineEdit, Located, NamedRow, Refusal, TaskRef, WriteChannel } from '../../../src/utils/FileLines';
import { holdsLineBreak } from '../../../src/utils/LineBreak';
import { Block } from '../../../src/services/persistence/utils/Placement';
import type { LineDraft } from '../../../src/utils/FileLines';

/**
 * Put `texts` in at `at`, at the top, each to read as it does by itself:
 * how a write adds a line to the body (`LineDraft.put`).
 */
function putAt(draft: LineDraft, at: number, ...texts: string[]): void {
    draft.put({ at, parent: null, indent: '' }, Block.read(texts));
}
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

    it('ends a line at a CR on its own, as the editor does', () => {
        // Obsidian's editor breaks the line there and its metadata counts two
        // lines (R0). Read as one, every line below it has a number the editor
        // does not give it.
        expect(splitLines('a\rb\n').lines).toEqual(['a', 'b', '']);
        expect(splitLines('a\nb\r').lines).toEqual(['a', 'b', '']);
    });

    it('does not let a CR on its own vote for CRLF', () => {
        // Obsidian writes such a note back with LF, and so does a write here:
        // counting it for CRLF would rewrite a whole LF file.
        expect(splitLines('a\rb\rc\r\nd\n').eol).toBe('\n');
        const split = splitLines('a\nb\r');
        expect(joinLines(split.lines, split.eol)).toBe('a\nb\n');
    });

    it('keeps U+2028 and U+2029 inside the line', () => {
        // Obsidian reads neither as a line break: the line is one checkbox (R0).
        expect(splitLines('- [ ] a b\n- [ ] c d').lines).toEqual(['- [ ] a b', '- [ ] c d']);
    });

    it('gives back the lines it was handed, once they are joined', () => {
        // What a write hands over is what the next scan reads, line for line:
        // the claim, the report and the content key all count on it.
        const lines = ['- [ ] a b', '', '\t- [ ] c', ''];
        for (const eol of ['\n', '\r\n'] as const) {
            expect(splitLines(joinLines(lines, eol)).lines).toEqual(lines);
        }
    });
});

describe('holdsLineBreak', () => {
    it('is the set of characters splitLines ends a line at', () => {
        expect(holdsLineBreak('a\nb')).toBe(true);
        expect(holdsLineBreak('a\rb')).toBe(true);
        expect(holdsLineBreak('a b')).toBe(false);
        expect(holdsLineBreak('a b')).toBe(false);
        for (const text of ['a\nb', 'a\rb', 'a\r\nb', 'a b', 'a b']) {
            expect(holdsLineBreak(text)).toBe(splitLines(text).lines.length > 1);
        }
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

/**
 * `failWrite` makes `vault.process` throw once the callback has run: after
 * the bytes reached disk (`landed`), or without them reaching it (`lost`).
 * `unreadable` makes reading the file back throw.
 */
function harness(initial: string, opts: {
    failWrite?: 'landed' | 'lost';
    unreadable?: boolean;
    callbackRuns?: number;
} = {}) {
    let content = initial;
    let calls = 0;
    const file = new TFile();
    file.path = 'note.md';
    const app = {
        vault: {
            process: async (_f: TFile, fn: (data: string) => string) => {
                // Obsidian re-runs the callback when another write landed in
                // between, and throws when the write itself fails.
                let next = content;
                for (let run = 0; run < (opts.callbackRuns ?? 1); run++) {
                    calls++;
                    next = fn(content);
                    if (run < (opts.callbackRuns ?? 1) - 1) content = next;
                }
                if (opts.failWrite !== 'lost') content = next;
                if (opts.failWrite) throw new Error('write failed');
            },
            read: async (_f: TFile) => {
                if (opts.unreadable) throw new Error('read failed');
                // Obsidian hands a read back without the mark at the head.
                return content.replace(/^\uFEFF/, '');
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
            putAt(draft, 0, '- [ ] new');
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

    it('writes nothing when its report is not one a file could follow: the write is checked by it', async () => {
        // The report is what says which lines the write put in and which it
        // kept (`Outline.check`). One no file could follow is a bug in the
        // write, and nothing is written (P1; it used to land, the chain of
        // records marked broken).
        const h = harness('- [ ] a\n');
        const log = writeSink();

        await expect(processLines(h.app, h.file, log.channel, (draft) => {
            draft.rewrite(0, '- [x] a');
            draft.rewrite(9, '- [x] a');
            return true;
        })).rejects.toThrow(BrokenWrite);

        expect(h.text()).toBe('- [ ] a\n');
        expect(log.standing()).toEqual([]);
    });

    it('reads a run of reports in the order they were made', async () => {
        // Each one is in the line numbers of its own moment, so an insert
        // shifts what the next one is talking about.
        const h = harness('x\ny\n');
        const log = writeSink();

        await processLines(h.app, h.file, log.channel, (draft) => {
            putAt(draft, 0, 'new');
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

        await processLines(h.app, h.file, log.channel, (draft, _eol, { refuse }) => {
            draft.rewrite(0, draft.lines[0]);
            return refuse({ kind: 'unplaceable' }, 'a');
        });

        expect(log.standing()).toEqual([]);
    });

    it('takes the report back and answers failed when the write throws and the file never changed', async () => {
        // The file never changed, so the claim describes a state that never
        // existed. Left standing, it would be weighed against whatever the
        // next scan happens to read.
        const h = harness('- [ ] a\n', { failWrite: 'lost' });
        const log = writeSink();

        const outcome = await processLines(h.app, h.file, log.channel, (draft) => {
            draft.rewrite(0, '- [x] a');
            return true;
        });

        expect(outcome).toEqual({ written: false, refused: { file: 'note.md', reason: { kind: 'failed' }, subject: 'note.md' } });
        expect(h.text()).toBe('- [ ] a\n');
        expect(log.standing()).toEqual([]);
        expect(log.refusals).toEqual([outcome.refused]);
    });

    it('keeps the report and answers written when the write throws but the file reads as written', async () => {
        // Obsidian's failure does not say whether the bytes reached disk; the
        // file does. Answering failed here would have the caller write the
        // same thing again (a timer records twice) or put back a value the
        // file already holds.
        const h = harness('\uFEFF- [ ] a\n', { failWrite: 'landed' });
        const log = writeSink();

        const outcome = await processLines(h.app, h.file, log.channel, (draft) => {
            draft.rewrite(0, '- [x] a');
            return true;
        });

        expect(outcome.written).toBe(true);
        expect(h.text()).toBe('\uFEFF- [x] a\n');
        expect(log.standing()).toHaveLength(1);
        expect(log.refusals).toEqual([]);
    });

    it('answers failed when the write throws and the file cannot be read back', async () => {
        const h = harness('- [ ] a\n', { failWrite: 'landed', unreadable: true });
        const log = writeSink();

        const outcome = await processLines(h.app, h.file, log.channel, (draft) => {
            draft.rewrite(0, '- [x] a');
            return true;
        });

        expect(outcome.written).toBe(false);
        expect(outcome.refused?.reason).toEqual({ kind: 'failed' });
        expect(log.standing()).toEqual([]);
        expect(log.refusals).toHaveLength(1);
    });

    it('answers failed, filing nothing, when the callback throws', async () => {
        // A write's own code failing is not a reason to leave the caller
        // without an answer: the card that asked for it puts its value back.
        const h = harness('- [ ] a\n- [ ] b\n', { callbackRuns: 2 });
        const log = writeSink(() => ({ kind: 'at', line: 0 }));
        let run = 0;

        const outcome = await processLines(h.app, h.file, log.channel, (draft, _eol, { row }) => {
            run++;
            row({ ref: { runtimeId: 'a' }, subject: 'a', basis: ON_RECORD });
            putAt(draft, 1, '- [ ] made');
            if (run === 2) throw new Error('boom');
            return true;
        });

        expect(outcome).toEqual({ written: false, refused: { file: 'note.md', reason: { kind: 'failed' }, subject: 'a' } });
        expect(log.standing()).toEqual([]);
        expect(log.refusals).toHaveLength(1);
    });

    it('holds a callback to saying why when it gives a write up', async () => {
        // A false with no refusal would leave the caller a write neither made
        // nor refused. A development build throws; a release build answers failed.
        const h = harness('- [ ] a\n');
        const log = writeSink();

        await expect(processLines(h.app, h.file, log.channel, () => false)).rejects.toThrow(BrokenWrite);
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

    describe('whether a write landed, with the next write to the file close behind', () => {
        /**
         * A file whose first write throws (`landed` or `lost`, as in
         * `harness`) and whose reading back waits until `release`, so a
         * second write can be sent while the first is still being decided.
         * `events` is the order reports were filed and taken back in.
         */
        function race(failFirst: 'landed' | 'lost') {
            let content = '- [ ] a\n';
            let writes = 0;
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const file = new TFile();
            file.path = 'note.md';
            const app = {
                vault: {
                    process: async (_f: TFile, fn: (data: string) => string) => {
                        const first = ++writes === 1;
                        const next = fn(content);
                        if (!(first && failFirst === 'lost')) content = next;
                        if (first) throw new Error('write failed');
                    },
                    read: async () => {
                        await gate;
                        return content;
                    },
                },
            } as never;
            const events: string[] = [];
            let filed = 0;
            const channel: WriteChannel = {
                sink: () => {
                    const n = ++filed;
                    events.push(`file ${n}`);
                    return { withdraw: () => { events.push(`withdraw ${n}`); }, made: [] };
                },
                locate: () => ({ kind: 'gone' }),
                onRecord: () => true,
                refused: () => { },
            };
            const write = (text: string) => processLines(app, file, channel, (draft) => {
                draft.rewrite(0, text);
                return true;
            });
            return { write, release, events, text: () => content };
        }

        it('keeps a write that landed, though the next write changed the file before it was read back', async () => {
            const r = race('landed');

            const first = r.write('- [x] a');
            const second = r.write('- [x] a!');
            r.release();

            expect((await first).written).toBe(true);
            expect((await second).written).toBe(true);
            expect(r.events).toEqual(['file 1', 'file 2']);
            expect(r.text()).toBe('- [x] a!\n');
        });

        it('takes back a write that did not land once, before the next write files its report', async () => {
            const r = race('lost');

            const first = r.write('- [x] a');
            const second = r.write('- [x] a!');
            r.release();

            expect((await first).written).toBe(false);
            expect((await second).written).toBe(true);
            expect(r.events).toEqual(['file 1', 'withdraw 1', 'file 2']);
        });
    });

    it('lets the next write to a file run after one that threw at its caller', async () => {
        // A development build's report of a caller's bug rejects the write;
        // the file's writes queued behind it still run.
        const h = harness('- [ ] a\n');
        const log = writeSink();

        const broken = processLines(h.app, h.file, log.channel, () => false);
        const next = processLines(h.app, h.file, log.channel, (draft) => {
            draft.rewrite(0, '- [x] a');
            return true;
        });

        await expect(broken).rejects.toThrow(BrokenWrite);
        expect((await next).written).toBe(true);
        expect(h.text()).toBe('- [x] a\n');
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
            putAt(draft, 1, `- [ ] b (${run})`);
            return true;
        });
        expect(outcome.made).toEqual([{ line: 1, runtimeId: 'made-2' }]);

        // The second attempt changes nothing, so it files nothing and names nothing.
        const same = harness('- [ ] a\n', { callbackRuns: 2 });
        run = 0;
        const unchanged = await processLines(same.app, same.file, channel, (draft) => {
            run++;
            if (run === 1) putAt(draft, 1, '- [ ] b');
            return true;
        });
        expect(unchanged.made).toEqual([]);
    });

    it('leaves the file byte-identical when the edit declines', async () => {
        const original = '- [ ] a\r\n- [ ] b\n';
        const h = harness(original);
        const outcome = await processLines(h.app, h.file, undefined, (_draft, _eol, { refuse }) => refuse({ kind: 'unplaceable' }, 'a'));

        expect(outcome).toEqual({ written: false, refused: { file: 'note.md', reason: { kind: 'unplaceable' }, subject: 'a' } });
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
        expect(outcome).toEqual({ written: true, refused: null, made: [], rows: new Map([[REF.runtimeId, { read: ['- [ ] b'], left: ['- [x] b'] }]]) });
        expect(h.text()).toBe('- [ ] a\r\n- [x] b\r\n');
        expect(log.refusals).toEqual([]);
    });

    it('writes an editor line on the line the editor numbered, below a CR on its own', async () => {
        // The editor breaks at the CR, so the first `- [ ] b` is its line 2.
        // Read as one line, `a\rX` put the second `- [ ] b` at 2 as well: same
        // text, so the write went to the other row.
        const h = harness('- [ ] a\rX\n- [ ] b\n- [ ] b\n');

        const outcome = await processLines(h.app, h.file, undefined, (draft, _eol, session) => {
            const at = session.row({ line: 2, text: '- [ ] b' });
            if (at === null) return false;
            draft.rewrite(at, '- [x] b');
            return true;
        });

        expect(outcome.written).toBe(true);
        expect(h.text()).toBe('- [ ] a\nX\n- [x] b\n- [ ] b\n');
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
        expect(outcome).toEqual({ written: false, refused: refusal });
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
        });
        expect(h.text()).toBe('- [ ] a\n');
    });

    it('tells the channel of a refusal exactly once', async () => {
        const h = harness('- [ ] a\n');
        const log = writeSink();

        const outcome = await processLines(h.app, h.file, log.channel, (_draft, _eol, session) =>
            session.refuse({ kind: 'changed' }, '- [ ] a'));

        const refusal = { file: 'note.md', reason: { kind: 'changed' }, subject: '- [ ] a' };
        expect(outcome).toEqual({ written: false, refused: refusal });
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

        expect(outcome).toEqual({ written: true, refused: null, made: [], rows: new Map() });
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
            putAt(draft, 0, 'new');
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
            putAt(draft, 0, 'n1', 'n2');
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

    it('says how it left each row it named, where the row ended up, and nothing of one it took away', async () => {
        const h = harness('- [ ] a\n\t- child\n- [ ] b\n');
        const log = writeSink((_lines, ref) => (ref.runtimeId === 'gone' ? at(2) : at(0)));

        const outcome = await processLines(h.app, h.file, log.channel, (draft, _eol, session) => {
            session.row(named('a'));
            session.row({ ref: { runtimeId: 'gone' }, subject: 'b', basis: ON_RECORD });
            putAt(draft, 0, 'new');
            draft.splice(3, 1);
            return true;
        });

        expect(outcome.rows).toEqual(new Map([[REF.runtimeId, { read: ['- [ ] a', '\t- child'], left: ['- [ ] a', '\t- child'] }]]));
        expect(h.text()).toBe('new\n- [ ] a\n\t- child\n');
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
        it(`accounts for the file it wrote: ${name}`, () => {
            const before = ['a', 'b', 'c', 'd', ''];
            const lines = [...before];
            const expected = [...before];
            expected.splice(at, del, ...items);
            const { draft, reported } = draftOver(lines);

            draft.splice(at, del, ...items);

            expect(lines).toEqual(expected);
            // Replayed over the lines as they were, the report leaves as many
            // lines as the splice did, and every line it does not say is new
            // or rewritten reads what it read.
            const replayed = replayEdits(before.length, reported)!;
            expect(replayed.origin).toHaveLength(lines.length);
            replayed.origin.forEach((from, i) => {
                if (from !== null && !replayed.rewritten[i]) expect(lines[i]).toBe(before[from]);
            });
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

        draft.put({ at: 4, parent: null, indent: '' }, [{ from: 1, text: 'row, archived', kind: 'text' }, { from: 2, text: 'child', kind: 'text' }]);
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
        draft.put({ at: 0, parent: null, indent: '' }, [{ from: 1, text: 'a', kind: 'text' }]);
        draft.splice(2, 1);

        expect(lines).toEqual(['a', 'row']);
        expect(replayEdits(2, reported)?.origin).toEqual([1, 0]);
        expect(reported.some(edit => edit.kind === 'replaced')).toBe(false);
    });

    it('is not a report a file could follow while the source still stands', () => {
        // One line in two places would give one name to two rows.
        const lines = ['a', 'row'];
        const { draft, reported } = draftOver(lines);

        draft.put({ at: 2, parent: null, indent: '' }, [{ from: 1, text: 'row', kind: 'text' }]);

        expect(replayEdits(2, reported)).toBeNull();
    });

    it('is not a report a file could follow from a line that is not there', () => {
        const lines = ['a'];
        const { draft, reported } = draftOver(lines);

        draft.put({ at: 1, parent: null, indent: '' }, [{ from: 5, text: 'x', kind: 'text' }]);

        expect(replayEdits(1, reported)).toBeNull();
    });

    it('files a claim for a move that took its source away, and writes nothing for one that did not', async () => {
        for (const takeAway of [true, false]) {
            const h = harness('a\nrow\nb\n');
            const log = writeSink();

            const write = processLines(h.app, h.file, log.channel, (draft) => {
                draft.splice(3, 1);
                draft.put({ at: 3, parent: null, indent: '' }, [{ from: 1, text: 'row, moved', kind: 'text' }]);
                if (takeAway) draft.splice(1, 1);
                return true;
            });

            if (takeAway) {
                await write;
                expect(h.text()).toBe('a\nb\nrow, moved');
                expect(log.standing()).toHaveLength(1);
                expect(log.standing()[0].edits).not.toBeNull();
            } else {
                // One line in two places is no report a file could follow,
                // and the write is checked by its report: a bug, not written.
                await expect(write).rejects.toThrow(BrokenWrite);
                expect(h.text()).toBe('a\nrow\nb\n');
                expect(log.standing()).toEqual([]);
            }
        }
    });
});

describe('one element, one line', () => {
    // An element holding a break is written as two lines while the report,
    // the claim and the content key count one. The draft takes none.
    const breaks = ['a\nb', 'a\rb', 'a\r\nb', '\n'];

    it.each(breaks)('the draft refuses %j through splice, rewrite and put, and changes nothing', (text) => {
        const lines = ['x', 'y'];
        const { draft, reported } = draftOver(lines);
        expect(() => draft.splice(1, 0, 'ok', text)).toThrow(LineBreakInLine);
        expect(() => draft.rewrite(0, text)).toThrow(LineBreakInLine);
        expect(() => draft.put({ at: 2, parent: null, indent: '' }, [{ from: 0, text, kind: 'text' }])).toThrow(LineBreakInLine);
        expect(() => draft.put({ at: 2, parent: null, indent: '' }, [{ text: 'ok', kind: 'text' }, { text, kind: 'text' }])).toThrow(LineBreakInLine);
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
