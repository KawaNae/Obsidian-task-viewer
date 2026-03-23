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
});
