import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { appendLines, joinLines, processLines, splitLines } from '../../../src/utils/FileLines';
import type { LineEdit } from '../../../src/utils/FileLines';

/**
 * The one place that decides what a line is and how the file gets put back
 * together. Every reader and every writer goes through here, so the answers
 * pinned below are the answers the whole plugin gives (#176).
 */

describe('splitLines', () => {
    it('drops the CR of a CRLF terminator', () => {
        expect(splitLines('a\r\nb\r\n')).toEqual({ lines: ['a', 'b', ''], eol: '\r\n' });
    });

    it('leaves an LF file alone', () => {
        expect(splitLines('a\nb\n')).toEqual({ lines: ['a', 'b', ''], eol: '\n' });
    });

    it('reads a file with no terminator at all as LF', () => {
        expect(splitLines('a')).toEqual({ lines: ['a'], eol: '\n' });
        expect(splitLines('')).toEqual({ lines: [''], eol: '\n' });
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

describe('appendLines', () => {
    it('replaces the empty last element of a terminated file', () => {
        const lines = ['a', ''];
        expect(appendLines(lines, ['b'])).toBe(1);
        expect(lines).toEqual(['a', 'b']);
    });

    it('follows the last line of an unterminated file', () => {
        const lines = ['a'];
        expect(appendLines(lines, ['b'])).toBe(1);
        expect(lines).toEqual(['a', 'b']);
    });

    it('fills an empty file', () => {
        const lines = [''];
        expect(appendLines(lines, ['a', 'b'])).toBe(0);
        expect(lines).toEqual(['a', 'b']);
    });
});

function harness(initial: string, opts: { throwAfterCallback?: boolean; callbackRuns?: number } = {}) {
    let content = initial;
    let calls = 0;
    const file = new TFile();
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
    edits: readonly LineEdit[];
}

/**
 * Stands in for the index's side of a write: every report handed over can be
 * taken back, and `standing` is what would still be waiting for the next scan.
 */
function writeSink() {
    const reports: Reported[] = [];
    const live = new Set<number>();
    return {
        sink: (before: readonly string[], after: readonly string[], edits: readonly LineEdit[]) => {
            const at = reports.length;
            reports.push({ before: [...before], after: [...after], edits: [...edits] });
            live.add(at);
            return () => { live.delete(at); };
        },
        standing: (): Reported[] => [...live].map(at => reports[at]),
    };
}

describe('processLines', () => {
    it('writes the edited lines back with the file\'s own terminator', async () => {
        const h = harness('- [ ] a\r\n- [ ] b\r\n');
        const written = await processLines(h.app, h.file, (lines) => {
            lines[0] = '- [x] a';
            return lines;
        });

        expect(written).toBe(true);
        expect(h.text()).toBe('- [x] a\r\n- [ ] b\r\n');
    });

    it('hands the edit lines with no CR on them', async () => {
        const h = harness('- [ ] a\r\n');
        let seen: string[] = [];
        await processLines(h.app, h.file, (lines) => { seen = [...lines]; return lines; });

        expect(seen).toEqual(['- [ ] a', '']);
    });

    it('hands over what a write reported, with the lines either side of it', async () => {
        const h = harness('- [ ] a\n');
        const log = writeSink();

        await processLines(h.app, h.file, (lines, _eol, edits) => {
            lines[0] = '- [x] a';
            edits.replaced(0);
            return lines;
        }, log.sink);

        expect(log.standing()).toEqual([{
            before: ['- [ ] a', ''],
            after: ['- [x] a', ''],
            edits: [{ kind: 'replaced', at: 0 }],
        }]);
    });

    it('says nothing about a write that reported nothing', async () => {
        // Reporting is per write site. A write that does not report is a write
        // the scan works out for itself, which is every write before stage 2.
        const h = harness('- [ ] a\n');
        const log = writeSink();

        const written = await processLines(h.app, h.file, (lines) => {
            lines[0] = '- [x] a';
            return lines;
        }, log.sink);

        expect(written).toBe(true);
        expect(h.text()).toBe('- [x] a\n');
        expect(log.standing()).toEqual([]);
    });

    it('drops a report that does not account for the lines it wrote', async () => {
        // The write moved a line it never mentioned. The report is bookkeeping
        // and the write is the user's, so the write lands and the report goes.
        const h = harness('- [ ] a\n- [ ] b\n');
        const log = writeSink();

        const written = await processLines(h.app, h.file, (lines, _eol, edits) => {
            lines[0] = '- [x] a';
            lines[1] = '- [x] b';
            edits.replaced(0);
            return lines;
        }, log.sink);

        expect(written).toBe(true);
        expect(h.text()).toBe('- [x] a\n- [x] b\n');
        expect(log.standing()).toEqual([]);
    });

    it('drops a report whose indexes are not in the file', async () => {
        const h = harness('- [ ] a\n');
        const log = writeSink();

        await processLines(h.app, h.file, (lines, _eol, edits) => {
            lines[0] = '- [x] a';
            edits.replaced(0);
            edits.removed(9, 1);
            return lines;
        }, log.sink);

        expect(log.standing()).toEqual([]);
    });

    it('reads a run of reports in the order they were made', async () => {
        // Each one is in the line numbers of its own moment, so an insert
        // shifts what the next one is talking about.
        const h = harness('x\ny\n');
        const log = writeSink();

        await processLines(h.app, h.file, (lines, _eol, edits) => {
            lines.splice(0, 0, 'new');
            edits.inserted(0, 1);
            lines[1] = 'X';
            edits.replaced(1);
            return lines;
        }, log.sink);

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

        const written = await processLines(h.app, h.file, (lines, _eol, edits) => {
            edits.replaced(0);
            return lines;
        }, log.sink);

        // The line was found, which is what the caller asked.
        expect(written).toBe(true);
        expect(log.standing()).toEqual([]);
    });

    it('drops the report of a write that declined', async () => {
        const h = harness('- [ ] a\n');
        const log = writeSink();

        await processLines(h.app, h.file, (_lines, _eol, edits) => {
            edits.replaced(0);
            return null;
        }, log.sink);

        expect(log.standing()).toEqual([]);
    });

    it('takes the report back when the write throws after the callback', async () => {
        // The file never changed, so the claim describes a state that never
        // existed. Left standing, it would be weighed against whatever the
        // next scan happens to read.
        const h = harness('- [ ] a\n', { throwAfterCallback: true });
        const log = writeSink();

        await expect(processLines(h.app, h.file, (lines, _eol, edits) => {
            lines[0] = '- [x] a';
            edits.replaced(0);
            return lines;
        }, log.sink)).rejects.toThrow('write failed');

        expect(log.standing()).toEqual([]);
    });

    it('takes back the first attempt\'s report when the callback runs again', async () => {
        // Obsidian retries the callback on a conflicting write. Only the
        // attempt that actually reached disk may leave a claim behind.
        const h = harness('- [ ] a\n', { callbackRuns: 2 });
        const log = writeSink();
        let run = 0;

        await processLines(h.app, h.file, (lines, _eol, edits) => {
            run++;
            lines[0] = `- [x] a (${run})`;
            edits.replaced(0);
            return lines;
        }, log.sink);

        const standing = log.standing();
        expect(standing).toHaveLength(1);
        expect(standing[0].after).toEqual(['- [x] a (2)', '']);
    });

    it('leaves the file byte-identical when the edit declines', async () => {
        const original = '- [ ] a\r\n- [ ] b\n';
        const h = harness(original);
        const written = await processLines(h.app, h.file, () => null);

        expect(written).toBe(false);
        // Not even the mixed terminators are unified: a write that could not be
        // placed must leave no trace, or Obsidian fires a modify for it and a
        // rescan follows a change nobody made.
        expect(h.text()).toBe(original);
    });
});
