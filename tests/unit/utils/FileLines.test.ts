import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { appendLines, joinLines, processLines, splitLines } from '../../../src/utils/FileLines';
import type { Hint } from '../../../src/services/core/identity/IdentityHints';

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

/**
 * Stands in for HintLog: every batch handed over can be taken back, and
 * `standing` is what would still be waiting for the next scan.
 */
function hintLog() {
    const batches: Hint[][] = [];
    const live = new Set<number>();
    return {
        sink: (hints: readonly Hint[]) => {
            const at = batches.length;
            batches.push([...hints]);
            live.add(at);
            return () => { live.delete(at); };
        },
        standing: () => [...live].flatMap(at => batches[at]),
    };
}

const TICKED: Hint = { kind: 'rewrite', runtimeId: 'r1', before: '- [ ] a', after: '- [x] a' };
const COPY: Hint = { kind: 'insert', text: '- [ ] a', anchor: 'r1', side: 'before' };

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

    it('hands over the hints a write raised', async () => {
        const h = harness('- [ ] a\n');
        const log = hintLog();

        await processLines(h.app, h.file, (lines, _eol, hint) => {
            lines[0] = '- [x] a';
            hint(TICKED);
            return lines;
        }, log.sink);

        expect(log.standing()).toEqual([TICKED]);
    });

    it('drops the hints of a write that changed nothing', async () => {
        // Same bytes out as in: Obsidian fires no `modify`, so no scan follows,
        // and a hint filed here would sit until it expired.
        const h = harness('- [ ] a\n');
        const log = hintLog();

        const written = await processLines(h.app, h.file, (lines, _eol, hint) => {
            hint(COPY);
            return lines;
        }, log.sink);

        // The line was found, which is what the caller asked.
        expect(written).toBe(true);
        expect(log.standing()).toEqual([]);
    });

    it('drops the hints of a write that declined', async () => {
        const h = harness('- [ ] a\n');
        const log = hintLog();

        await processLines(h.app, h.file, (_lines, _eol, hint) => {
            hint(COPY);
            return null;
        }, log.sink);

        expect(log.standing()).toEqual([]);
    });

    it('takes the hints back when the write throws after the callback', async () => {
        // The file never changed, so the claims describe a state that never
        // existed. Left standing, they would be matched against whatever the
        // next scan happens to read.
        const h = harness('- [ ] a\n', { throwAfterCallback: true });
        const log = hintLog();

        await expect(processLines(h.app, h.file, (lines, _eol, hint) => {
            lines[0] = '- [x] a';
            hint(TICKED);
            return lines;
        }, log.sink)).rejects.toThrow('write failed');

        expect(log.standing()).toEqual([]);
    });

    it('takes back the first attempt\'s hints when the callback runs again', async () => {
        // Obsidian retries the callback on a conflicting write. Only the
        // attempt that actually reached disk may leave claims behind.
        const h = harness('- [ ] a\n', { callbackRuns: 2 });
        const log = hintLog();
        let run = 0;

        await processLines(h.app, h.file, (lines, _eol, hint) => {
            run++;
            lines[0] = `- [x] a (${run})`;
            hint({ kind: 'rewrite', runtimeId: 'r1', before: '- [ ] a', after: `- [x] a (${run})` });
            return lines;
        }, log.sink);

        expect(log.standing()).toEqual([
            { kind: 'rewrite', runtimeId: 'r1', before: '- [ ] a', after: '- [x] a (2)' },
        ]);
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
