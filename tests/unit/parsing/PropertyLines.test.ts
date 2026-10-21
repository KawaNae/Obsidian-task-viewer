import { describe, it, expect } from 'vitest';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { PropertyLines, type PropertyFinding } from '../../../src/services/parsing/utils/PropertyLines';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SCOPE_KEYS, DEFAULT_SETTINGS, type Task } from '../../../src/types';
import { valuesOf } from '../helpers/properties';

const text = (t: string) => ({ type: 'text', text: t, spelling: t });

/** The reading of the task on line 0 of `lines`. */
function ofTask(lines: string[]) {
    const own = PropertyLines.ofTask(Outline.read(lines), 0);
    return { own, read: PropertyLines.read(own, DEFAULT_SCOPE_KEYS) };
}

/** The reading of the root section of `lines` (no heading), over all of them. */
function ofRoot(lines: string[]) {
    const own = PropertyLines.ofSection(Outline.read(lines), null, 0, lines.length);
    return { own, read: PropertyLines.read(own, DEFAULT_SCOPE_KEYS) };
}

/** Findings as `[kind, line, end, key]`. */
const brief = (findings: readonly PropertyFinding[]) => findings.map(f => [f.kind, f.line, f.end, f.key]);

function tasks(lines: string[]): Task[] {
    return FileParsePipeline.parse('n.md', lines, DEFAULT_SETTINGS, namesOutsideIndex('n.md')).tasks;
}

describe('PropertyLines', () => {
    describe('the lines an owner has', () => {
        it('a task has the property items directly under its item, not deeper ones', () => {
            const { own } = ofTask(['- [ ] t', '    - a:: 1', '    - note', '        - b:: 2', '    - [ ] c', '        - d:: 3', '    - e:: 4']);
            expect(own.owner).toEqual({ kind: 'task', line: 0 });
            expect(own.lines.map(line => [line.line, line.key])).toEqual([[1, 'a'], [6, 'e']]);
        });

        it('a section has the property items at the top of its own lines, below a task too', () => {
            const outline = Outline.read(['## S', '- a:: 1', '- [ ] t', '- b:: 2', '  - c:: 3', '```', '- d:: 4', '```', '### Sub', '- e:: 5']);
            const own = PropertyLines.ofSection(outline, 0, 1, 8);
            expect(own.owner).toEqual({ kind: 'section', heading: 0 });
            expect(own.lines.map(line => line.key)).toEqual(['a', 'b']);
        });
    });

    describe('a key', () => {
        const keysOf = (lines: string[]) => ofRoot(lines).own.lines.map(line => [line.key, line.written]);

        it('is what stands between the gap after the bullet and the first `::`, the space around it taken off', () => {
            expect(keysOf(['- area:: lab', '-   a b \t:: 1', '* x::', '1. y:: 2'])).toEqual([['area', 'lab'], ['a b', '1'], ['x', ''], ['y', '2']]);
        });

        it('is read as written, emphasis and a tag\'s `#` included', () => {
            expect(keysOf(['- **k**:: 1', '- #tag:: 2'])).toEqual([['**k**', '1'], ['#tag', '2']]);
        });

        it('ends at the first `::`: `- k::: v` is the key `k` with the value `: v`', () => {
            expect(keysOf(['- k::: v'])).toEqual([['k', ': v']]);
        });

        it('holds no `:`, `[`, `]` or backquote: such a line is no property line', () => {
            expect(keysOf(['- a:b:: 1', '- [ ] t:: 1', '- [[x]]:: 1', '- a]:: 1', '- `k`:: 1', '- 見出し直下のプロパティ行（`- tv-color:: `）でも'])).toEqual([]);
        });

        it('is not empty: a line with none, or with space alone, is no property line', () => {
            expect(keysOf(['- :: x', '-  :: x', '- \t ::', '- 　:: x'])).toEqual([]);
        });

        it('a line that is no property line is an item of a list above it', () => {
            const { read } = ofRoot(['- list::', '    -  :: x', '    - `k`:: v']);
            expect(valuesOf(read.values)).toEqual({ list: { type: 'list', items: [text(':: x'), text('`k`:: v')] } });
            expect(read.findings).toEqual([]);
        });
    });

    describe('a value', () => {
        it('a line with a value reads it as written, and its items are notes, found on the item\'s line', () => {
            const { own, read } = ofTask(['- [ ] t', '    - area:: lab', '        - a', '            - deep', '        - b']);
            expect(valuesOf(read.values)).toEqual({ area: text('lab') });
            expect(own.lines[0].items).toEqual([]);
            expect(brief(read.findings)).toEqual([['lines-under-value', 2, 4, 'area'], ['lines-under-value', 4, 5, 'area']]);
            expect(read.findings[0]).toMatchObject({ severity: 'warning', propertyLine: 1, owner: { kind: 'task', line: 0 } });
        });

        it('a line with no value and no item under it is no value', () => {
            expect(valuesOf(ofTask(['- [ ] t', '    - area::']).read.values)).toEqual({ area: { type: 'null', spelling: '' } });
        });

        it('a line with no value reads the items directly under it as a list, each item typed as a line\'s value is', () => {
            const { own, read } = ofTask(['- [ ] t', '    - list::', '        - a', '', '        - 12', '        - "12"', '        - True', '        * [[x]]', '        1. b']);
            expect(read.values.list.value).toEqual({ type: 'list', items: [
                text('a'),
                { type: 'number', number: 12, spelling: '12' },
                { type: 'text', text: '12', spelling: '"12"' },
                { type: 'boolean', boolean: true, spelling: 'True' },
                text('[[x]]'),
                text('b'),
            ] });
            expect(own.lines[0].items).toEqual([2, 4, 5, 6, 7, 8]);
            expect(read.findings).toEqual([]);
        });

        it('a section reads a list as a task does', () => {
            const { read } = ofRoot(['- list::', '  - a', '  - b', '- [ ] t']);
            expect(read.values.list.value).toEqual({ type: 'list', items: [text('a'), text('b')] });
        });
    });

    describe('the lines under a line with no value', () => {
        it('a task among the items stays a task, no item of the list', () => {
            const lines = ['- [ ] t', '    - list::', '        - a', '        - [ ] x', '            - k:: v', '        - b'];
            const { read } = ofTask(lines);
            expect(read.values.list.value).toEqual({ type: 'list', items: [text('a'), text('b')] });
            expect(brief(read.findings)).toEqual([['not-a-list-item', 3, 5, 'list']]);
            const x = tasks(lines).find(task => task.content === 'x')!;
            expect(valuesOf(x.properties)).toEqual({ k: text('v') });
        });

        it('an item nested in an item is dropped, the item above it read; so is a nested item\'s own nesting', () => {
            const { read } = ofTask(['- [ ] t', '    - list::', '        - a', '            - inner', '                - innermost', '        - b']);
            expect(read.values.list.value).toEqual({ type: 'list', items: [text('a'), text('b')] });
            expect(brief(read.findings)).toEqual([['not-a-list-item', 3, 5, 'list']]);
        });

        it('an item written as a property line is the text `name:: Kawa`, found', () => {
            const { read } = ofTask(['- [ ] t', '    - author::', '        - name:: Kawa', '        - Sato']);
            expect(valuesOf(read.values)).toEqual({ author: { type: 'list', items: [text('name:: Kawa'), text('Sato')] } });
            expect(brief(read.findings)).toEqual([['property-shaped-item', 2, 3, 'author']]);
        });

        it('a line that is no item (text going on, a quote, code) is found, the items read', () => {
            const { read } = ofTask([
                '- [ ] t',
                '    - list::',
                '      going on',
                '        - a',
                '          a goes on',
                '        - b',
                '        ```',
                '        - c',
                '        ```',
            ]);
            expect(read.values.list.value).toEqual({ type: 'list', items: [text('a'), text('b')] });
            expect(brief(read.findings)).toEqual([
                ['not-a-list-item', 2, 3, 'list'],
                ['not-a-list-item', 4, 5, 'list'],
                ['not-a-list-item', 6, 9, 'list'],
            ]);
        });

        it('an empty item and an item that is no value are no items of the list', () => {
            const { read } = ofTask(['- [ ] t', '    - list::', '        -', '        - null', '        - a']);
            expect(read.values.list.value).toEqual({ type: 'list', items: [text('a')] });
            expect(brief(read.findings)).toEqual([['not-a-list-item', 2, 3, 'list'], ['not-a-list-item', 3, 4, 'list']]);
        });

        it('a line with no value whose lines under it hold no item is no value', () => {
            const { read } = ofTask(['- [ ] t', '    - list::', '        - [ ] x']);
            expect(read.values.list.value).toEqual({ type: 'null', spelling: '' });
        });
    });

    describe('a key written twice by one owner', () => {
        it('is read on neither line, an error on each; the other keys are read', () => {
            const { read } = ofTask(['- [ ] t', '    - a:: 1', '    - b:: 2', '    - a:: 3', '        - x']);
            expect(valuesOf(read.values)).toEqual({ b: { type: 'number', number: 2, spelling: '2' } });
            expect(brief(read.findings)).toEqual([['duplicate-key', 1, 2, 'a'], ['duplicate-key', 3, 5, 'a']]);
            expect(read.findings.every(f => f.severity === 'error')).toBe(true);
        });

        it('lets the value above come through, for a task and for a section', () => {
            const [t] = tasks(['---', 'tv-color: red', '---', '- area:: root', '## S', '- area:: s1', '- area:: s2', '- tv-color:: a', '- tv-color:: b', '- [ ] t', '    - k:: 1', '    - k:: 2']);
            expect(t.cascadeContext?.properties?.area?.value).toEqual(text('root'));
            expect(t.cascadeContext?.color).toBe('red');
            expect(t.properties).toEqual({});
        });

        it('on two layers is no duplicate: the nearer one wins', () => {
            const [t] = tasks(['## S', '- area:: s', '- [ ] t', '    - area:: t']);
            expect(t.properties.area.value).toEqual(text('t'));
            expect(t.cascadeContext?.properties?.area?.value).toEqual(text('s'));
        });
    });

    describe('a date key under a task', () => {
        it('is not read, a warning; under a section it is read', () => {
            const { read } = ofTask(['- [ ] t', '    - tv-start:: 2026-01-01', '    - tv-due::', '        - x', '    - tv-color:: red']);
            expect(valuesOf(read.values)).toEqual({ 'tv-color': text('red') });
            expect(brief(read.findings)).toEqual([['date-key-under-task', 1, 2, 'tv-start'], ['date-key-under-task', 2, 4, 'tv-due']]);
            expect(valuesOf(ofRoot(['- tv-start:: 2026-01-01']).read.values)).toEqual({ 'tv-start': text('2026-01-01') });
        });

        it('follows the keys the settings name', () => {
            const keys = { ...DEFAULT_SCOPE_KEYS, start: 'from' };
            const own = PropertyLines.ofTask(Outline.read(['- [ ] t', '    - from:: 2026-01-01', '    - tv-start:: x']), 0);
            const read = PropertyLines.read(own, keys);
            expect(Object.values(read.values).map(p => p.key)).toEqual(['tv-start']);
            expect(brief(read.findings)).toEqual([['date-key-under-task', 1, 2, 'from']]);
        });
    });

    describe('a built-in\'s value it cannot read', () => {
        it('is not read, a warning that covers the lines under it; no value is read', () => {
            const { read } = ofRoot([
                '- tv-start:: 2026-02-30',
                '- tv-linestyle:: wavy',
                '- tv-color::',
                '    - red',
                '- tv-mask::',
                '- tv-due:: 10:00',
                '- tags::',
                '    - b',
                '- area:: 2026-02-30',
            ]);
            expect(brief(read.findings)).toEqual([
                ['unreadable-value', 0, 1, 'tv-start'],
                ['unreadable-value', 1, 2, 'tv-linestyle'],
                ['unreadable-value', 2, 4, 'tv-color'],
                ['unreadable-value', 5, 6, 'tv-due'],
            ]);
            expect(read.findings.every(f => f.severity === 'warning')).toBe(true);
            expect(Object.keys(read.values)).toEqual(['tv-mask', 'tags', 'area']);
            expect(read.lineOf.has('tv-start')).toBe(false);
        });

        it('is found under a task too, by the keys the settings name, its case aside', () => {
            const keys = { ...DEFAULT_SCOPE_KEYS, linestyle: 'line' };
            const own = PropertyLines.ofTask(Outline.read(['- [ ] t', '    - LINE:: wavy', '    - tv-linestyle:: wavy']), 0);
            const read = PropertyLines.read(own, keys);
            expect(brief(read.findings)).toEqual([['unreadable-value', 1, 2, 'LINE']]);
        });

        it('is found on a color CSS does not read as one, and the color above comes through', () => {
            const own = PropertyLines.ofTask(Outline.read(['- [ ] t', '    - tv-color:: rde']), 0);
            expect(brief(PropertyLines.read(own, DEFAULT_SCOPE_KEYS).findings)).toEqual([['unreadable-value', 1, 2, 'tv-color']]);
            const all = tasks(['## S', '- tv-color:: red', '- [ ] a', '    - tv-color:: rde']);
            expect(all.map(task => [task.color, task.cascadeContext?.color])).toEqual([[undefined, 'red']]);
        });
    });

    describe('in a note', () => {
        it('a section\'s property line below its first task reaches every task of the section', () => {
            const all = tasks(['## S', '- [ ] a', '- area:: lab', '- [ ] b', '## T', '- [ ] c']);
            expect(all.map(task => task.cascadeContext?.properties?.area?.value)).toEqual([text('lab'), text('lab'), undefined]);
        });

        it('the root\'s values, above the first heading, reach every task of the note', () => {
            const all = tasks(['- [ ] a', '- area:: lab', '## S', '- [ ] b', '### T', '- [ ] c']);
            expect(all.map(task => task.cascadeContext?.properties?.area?.value)).toEqual([text('lab'), text('lab'), text('lab')]);
        });

        it('`- properties::` is a property of its own, of any owner', () => {
            const [t] = tasks(['## S', '- properties::', '  - tv-color:: red', '- [ ] t', '    - properties::', '        - a']);
            expect(t.cascadeContext?.color).toBeUndefined();
            expect(t.cascadeContext?.properties?.properties?.value).toEqual({ type: 'list', items: [text('tv-color:: red')] });
            expect(t.properties.properties.value).toEqual({ type: 'list', items: [text('a')] });
        });

        it('`- tags::` reads each item as a line\'s `tags::` value: `- #a` is a tag, `- b` none', () => {
            const [t] = tasks(['## S', '- tags::', '  - #a', '  - b', '  - #c #d', '- [ ] t', '    - tags::', '        - #e', '        - f']);
            expect(t.cascadeContext?.tags).toEqual(['a', 'c', 'd']);
            expect(t.tags).toEqual(['e']);
            expect(t.properties).toEqual({});
        });

        it('a task\'s date key gives the task no date', () => {
            const [t] = tasks(['- [ ] t', '    - tv-start:: 2026-01-01']);
            expect(t.startDate).toBeFalsy();
            expect(t.properties).toEqual({});
        });
    });
});
