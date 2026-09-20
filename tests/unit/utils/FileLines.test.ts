import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { appendLines, joinLines, processLines, splitLines } from '../../../src/utils/FileLines';

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

function harness(initial: string) {
    let content = initial;
    let calls = 0;
    const file = new TFile();
    const app = {
        vault: {
            process: async (_f: TFile, fn: (data: string) => string) => {
                calls++;
                content = fn(content);
            },
        },
    } as never;
    return { app, file, text: () => content, calls: () => calls };
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
