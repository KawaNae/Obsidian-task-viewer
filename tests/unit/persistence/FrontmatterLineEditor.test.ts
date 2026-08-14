import { describe, it, expect } from 'vitest';
import { FrontmatterLineEditor } from '../../../src/services/persistence/utils/FrontmatterLineEditor';

describe('FrontmatterLineEditor', () => {

    // ── findEnd ──
    describe('findEnd', () => {
        it('returns closing --- index', () => {
            const lines = ['---', 'title: foo', '---', 'body'];
            expect(FrontmatterLineEditor.findEnd(lines)).toBe(2);
        });

        it('returns -1 when first line is not ---', () => {
            const lines = ['# heading', 'body'];
            expect(FrontmatterLineEditor.findEnd(lines)).toBe(-1);
        });

        it('returns -1 when closing --- is missing', () => {
            const lines = ['---', 'title: foo', 'tags: bar'];
            expect(FrontmatterLineEditor.findEnd(lines)).toBe(-1);
        });

        it('returns -1 for empty array', () => {
            expect(FrontmatterLineEditor.findEnd([])).toBe(-1);
        });

        it('handles frontmatter with many keys', () => {
            const lines = ['---', 'a: 1', 'b: 2', 'c: 3', '---', 'body'];
            expect(FrontmatterLineEditor.findEnd(lines)).toBe(4);
        });

        it('handles whitespace around ---', () => {
            const lines = ['---', 'title: foo', '  ---  ', 'body'];
            expect(FrontmatterLineEditor.findEnd(lines)).toBe(2);
        });
    });

    // ── findKeyRange ──
    describe('findKeyRange', () => {
        const lines = ['---', 'title: foo', 'tags:', '  - a', '  - b', 'status: open', '---'];
        const fmEnd = 6;

        it('finds single-line key range', () => {
            expect(FrontmatterLineEditor.findKeyRange(lines, fmEnd, 'title')).toEqual([1, 2]);
        });

        it('finds multi-line key range (YAML array)', () => {
            expect(FrontmatterLineEditor.findKeyRange(lines, fmEnd, 'tags')).toEqual([2, 5]);
        });

        it('finds last key before closing ---', () => {
            expect(FrontmatterLineEditor.findKeyRange(lines, fmEnd, 'status')).toEqual([5, 6]);
        });

        it('returns null for missing key', () => {
            expect(FrontmatterLineEditor.findKeyRange(lines, fmEnd, 'nonexistent')).toBeNull();
        });

        it('handles key with continuation lines (block scalar)', () => {
            const blockLines = ['---', 'description: |', '  line 1', '  line 2', 'next: val', '---'];
            expect(FrontmatterLineEditor.findKeyRange(blockLines, 5, 'description')).toEqual([1, 4]);
        });
    });

    // ── applyUpdates ──
    describe('applyUpdates', () => {
        it('updates existing key', () => {
            const lines = ['---', 'title: foo', 'status: open', '---', 'body'];
            const result = FrontmatterLineEditor.applyUpdates(lines, 3, { title: 'bar' });
            expect(result).toBe('---\ntitle: bar\nstatus: open\n---\nbody');
        });

        it('deletes existing key (value: null)', () => {
            const lines = ['---', 'title: foo', 'status: open', '---', 'body'];
            const result = FrontmatterLineEditor.applyUpdates(lines, 3, { title: null });
            expect(result).toBe('---\nstatus: open\n---\nbody');
        });

        it('inserts new key before closing ---', () => {
            const lines = ['---', 'title: foo', '---', 'body'];
            const result = FrontmatterLineEditor.applyUpdates(lines, 2, { status: 'done' });
            expect(result).toBe('---\ntitle: foo\nstatus: done\n---\nbody');
        });

        it('updates multi-line value to single line', () => {
            const lines = ['---', 'tags:', '  - a', '  - b', 'title: foo', '---'];
            const result = FrontmatterLineEditor.applyUpdates(lines, 5, { tags: '[x, y]' });
            expect(result).toBe('---\ntags: [x, y]\ntitle: foo\n---');
        });

        it('deletes multi-line key', () => {
            const lines = ['---', 'tags:', '  - a', '  - b', 'title: foo', '---'];
            const result = FrontmatterLineEditor.applyUpdates(lines, 5, { tags: null });
            expect(result).toBe('---\ntitle: foo\n---');
        });

        it('handles multiple updates at once', () => {
            const lines = ['---', 'title: old', 'status: open', '---'];
            const result = FrontmatterLineEditor.applyUpdates(lines, 3, {
                title: 'new',
                status: 'done',
            });
            expect(result).toBe('---\ntitle: new\nstatus: done\n---');
        });

        it('handles empty value as key-only format', () => {
            const lines = ['---', 'title: foo', '---'];
            const result = FrontmatterLineEditor.applyUpdates(lines, 2, { empty: '' });
            expect(result).toBe('---\ntitle: foo\nempty:\n---');
        });

        it('preserves unrelated keys exactly', () => {
            const lines = ['---', 'keep: this', 'update: old', 'also-keep: that', '---'];
            const result = FrontmatterLineEditor.applyUpdates(lines, 4, { update: 'new' });
            const resultLines = result.split('\n');
            expect(resultLines[1]).toBe('keep: this');
            expect(resultLines[2]).toBe('update: new');
            expect(resultLines[3]).toBe('also-keep: that');
        });

        it('delete non-existent key is a no-op', () => {
            const lines = ['---', 'title: foo', '---'];
            const result = FrontmatterLineEditor.applyUpdates(lines, 2, { ghost: null });
            expect(result).toBe('---\ntitle: foo\n---');
        });

        it('handles update + insert + delete in one call', () => {
            const lines = ['---', 'title: old', 'remove: me', '---'];
            const result = FrontmatterLineEditor.applyUpdates(lines, 3, {
                title: 'new',
                remove: null,
                added: 'value',
            });
            const resultLines = result.split('\n');
            expect(resultLines).toContain('title: new');
            expect(resultLines).not.toContain('remove: me');
            expect(resultLines).toContain('added: value');
        });
    });

    // ── escapeYamlScalar ──
    describe('escapeYamlScalar', () => {
        const esc = (v: string) => FrontmatterLineEditor.escapeYamlScalar(v);

        it('emits empty string as explicit ""', () => {
            expect(esc('')).toBe('""');
        });

        it('leaves a plain safe word unquoted', () => {
            expect(esc('hello')).toBe('hello');
            expect(esc('hello world')).toBe('hello world');
            expect(esc('x')).toBe('x');
            expect(esc('in_progress')).toBe('in_progress');
        });

        // Regression: hyphen status (Cancelled) must not be emitted as a bare `-`.
        it('quotes a leading hyphen (Cancelled status)', () => {
            expect(esc('-')).toBe('"-"');
        });

        it('quotes the tilde / null indicators', () => {
            expect(esc('~')).toBe('"~"');
            expect(esc('null')).toBe('"null"');
            expect(esc('Null')).toBe('"Null"');
        });

        it('quotes a leading backtick', () => {
            expect(esc('`foo')).toBe('"`foo"');
        });

        it('quotes flow / colon indicators', () => {
            expect(esc('a: b')).toBe('"a: b"');
            expect(esc('[a]')).toBe('"[a]"');
            expect(esc('a, b')).toBe('"a, b"');
            expect(esc('# heading')).toBe('"# heading"');
        });

        it('quotes pure numbers (would otherwise re-type as number)', () => {
            expect(esc('123')).toBe('"123"');
            expect(esc('3.14')).toBe('"3.14"');
        });

        it('quotes YAML boolean keywords (case-insensitive)', () => {
            expect(esc('true')).toBe('"true"');
            expect(esc('False')).toBe('"False"');
            expect(esc('yes')).toBe('"yes"');
            expect(esc('off')).toBe('"off"');
        });

        it('quotes date-shaped strings (would re-type as Date)', () => {
            expect(esc('2026-06-09')).toBe('"2026-06-09"');
        });

        it('quotes surrounding whitespace', () => {
            expect(esc(' hi')).toBe('" hi"');
            expect(esc('hi ')).toBe('"hi "');
        });

        it('escapes control characters inside a double-quoted scalar', () => {
            expect(esc('a\nb')).toBe('"a\\nb"');
            expect(esc('a\tb')).toBe('"a\\tb"');
            expect(esc('a\rb')).toBe('"a\\rb"');
        });

        it('escapes backslash and double-quote', () => {
            expect(esc('quote"x')).toBe('"quote\\"x"');
            expect(esc('back\\slash')).toBe('"back\\\\slash"');
        });
    });

    // ── ensureBlock ──
    describe('ensureBlock', () => {
        it('returns the existing block untouched', () => {
            const lines = ['---', 'title: foo', '---', 'body'];
            const r = FrontmatterLineEditor.ensureBlock(lines);
            expect(r.fmEnd).toBe(2);
            expect(r.lines).toBe(lines);
        });

        it('prepends an empty block when the file has none', () => {
            const r = FrontmatterLineEditor.ensureBlock(['# heading', 'body']);
            expect(r.fmEnd).toBe(1);
            expect(r.lines).toEqual(['---', '---', '# heading', 'body']);
        });

        it('prepends an empty block for an empty file', () => {
            const r = FrontmatterLineEditor.ensureBlock(['']);
            expect(r.fmEnd).toBe(1);
            expect(r.lines).toEqual(['---', '---', '']);
        });

        it('treats an unterminated block as absent', () => {
            const r = FrontmatterLineEditor.ensureBlock(['---', 'title: foo']);
            expect(r.fmEnd).toBe(1);
            expect(r.lines).toEqual(['---', '---', '---', 'title: foo']);
        });

        it('a key written into a created block lands inside it', () => {
            const { lines, fmEnd } = FrontmatterLineEditor.ensureBlock(['body']);
            const out = FrontmatterLineEditor.applyUpdates(lines, fmEnd, { 'tv-color': 'ff0000' });
            expect(out).toBe('---\ntv-color: ff0000\n---\nbody');
        });
    });

    // ── readRawScalar ──
    describe('readRawScalar', () => {
        const lines = ['---', 'plain: abc', 'quoted: "a: b"', 'empty:', 'list:', '  - x', '---'];
        const fmEnd = 6;
        const read = (key: string) => FrontmatterLineEditor.readRawScalar(lines, fmEnd, key);

        it('returns the value as written', () => {
            expect(read('plain')).toBe('abc');
        });

        it('keeps quotes rather than interpreting them', () => {
            expect(read('quoted')).toBe('"a: b"');
        });

        it('returns an empty string for a key with no value', () => {
            expect(read('empty')).toBe('');
        });

        it('returns null for a missing key', () => {
            expect(read('nope')).toBeNull();
        });

        it('reads only the key line of a multi-line value', () => {
            expect(read('list')).toBe('');
        });
    });

    // ── surgical edit が保つもの（processFrontMatter との差） ──
    describe('representation is preserved across a key write', () => {
        // processFrontMatter はここでコメントを落とし、引用符を外し、
        // フロー配列をブロックリストへ変える（2026-08-14 実測）。
        const source = [
            '---',
            '# why this file exists',
            'tv-start: 2026-08-14T10:00',
            'tags:',
            '  - work',
            '  - "quoted tag"',
            'memo: \'single quoted\'',
            'tv-content: |',
            '  line one',
            '  line two',
            'aliases: [a, b]',
            '---',
            '',
            'body',
        ];

        it('keeps comments, quotes, flow arrays and block scalars', () => {
            const fmEnd = FrontmatterLineEditor.findEnd(source);
            const out = FrontmatterLineEditor.applyUpdates(source, fmEnd, {
                'tv-timer-target-id': 'tv-t-abc1234',
            });
            const lines = out.split('\n');

            expect(lines).toContain('# why this file exists');
            expect(lines).toContain('  - "quoted tag"');
            expect(lines).toContain("memo: 'single quoted'");
            expect(lines).toContain('aliases: [a, b]');
            expect(lines).toContain('tv-content: |');
            expect(lines).toContain('  line one');
            expect(lines).toContain('tv-timer-target-id: tv-t-abc1234');
        });

        it('removing the key restores the original text', () => {
            const fmEnd = FrontmatterLineEditor.findEnd(source);
            const added = FrontmatterLineEditor.applyUpdates(source, fmEnd, {
                'tv-timer-target-id': 'tv-t-abc1234',
            }).split('\n');
            const back = FrontmatterLineEditor.applyUpdates(
                added, FrontmatterLineEditor.findEnd(added), { 'tv-timer-target-id': null }
            );
            expect(back).toBe(source.join('\n'));
        });
    });
});
