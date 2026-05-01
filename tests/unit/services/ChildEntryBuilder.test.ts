import { describe, it, expect } from 'vitest';
import { buildChildEntries, extractWikilinkTarget } from '../../../src/services/data/ChildEntryBuilder';
import { makeTask } from '../helpers/makeTask';
import type { Task, ChildLine } from '../../../src/types';

const plainCl = (text: string, checkboxChar: string | null = null): ChildLine => ({
    text,
    indent: '',
    checkboxChar,
    wikilinkTarget: null,
    propertyKey: null,
    propertyValue: null,
});

const wikiCl = (target: string): ChildLine => ({
    text: `- [[${target}]]`,
    indent: '',
    checkboxChar: null,
    wikilinkTarget: target,
    propertyKey: null,
    propertyValue: null,
});

describe('buildChildEntries', () => {
    it('returns plain entries for childLines without sibling tasks', () => {
        const parent = makeTask({
            childIds: [],
            childLines: [plainCl('- [ ] a', ' '), plainCl('- key:: v', null)],
            childLineBodyOffsets: [5, 6],
        });
        const entries = buildChildEntries(parent, () => undefined);
        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatchObject({ kind: 'line', bodyLine: 5 });
        expect(entries[1]).toMatchObject({ kind: 'line', bodyLine: 6 });
    });

    it('emits task entries for childIds and orders them by bodyLine', () => {
        const parent = makeTask({
            id: 'p',
            parserId: 'tv-file',
            line: -1,
            childIds: ['c2', 'c1'],
            childLines: [],
            childLineBodyOffsets: [],
        });
        const c1 = makeTask({ id: 'c1', parserId: 'tv-inline', line: 5, childIds: [], childLines: [], childLineBodyOffsets: [] });
        const c2 = makeTask({ id: 'c2', parserId: 'tv-inline', line: 8, childIds: [], childLines: [], childLineBodyOffsets: [] });
        const lookup = (id: string): Task | undefined => ({ c1, c2 } as any)[id];
        const entries = buildChildEntries(parent, lookup);
        expect(entries.map(e => e.bodyLine)).toEqual([5, 8]);
        expect(entries.every(e => e.kind === 'task')).toBe(true);
    });

    it('drops plain entries whose bodyLine is in a sibling tasks subtree', () => {
        const parent = makeTask({
            id: 'p',
            parserId: 'tv-file',
            line: -1,
            childIds: ['c1'],
            childLines: [
                plainCl('- a', ' '),  // line 5: this is c1's own line
                plainCl('- b', ' '),  // line 6: child of c1
                plainCl('- c', ' '),  // line 7: not in any subtree
            ],
            childLineBodyOffsets: [5, 6, 7],
        });
        const c1 = makeTask({
            id: 'c1',
            parserId: 'tv-inline',
            line: 5,
            childIds: [],
            childLines: [plainCl('- b', ' ')],
            childLineBodyOffsets: [6],
        });
        const lookup = (id: string): Task | undefined => id === 'c1' ? c1 : undefined;
        const entries = buildChildEntries(parent, lookup);
        // line 5: replaced by 'task' entry for c1
        // line 6: dropped (in c1's subtree)
        // line 7: kept as 'plain'
        expect(entries.map(e => ({ kind: e.kind, bodyLine: e.bodyLine }))).toEqual([
            { kind: 'task', bodyLine: 5 },
            { kind: 'line', bodyLine: 7 },
        ]);
    });

    it('emits wikilink entries for childLines with wikilinkTarget', () => {
        const parent = makeTask({
            childIds: [],
            childLines: [wikiCl('Other')],
            childLineBodyOffsets: [3],
        });
        const entries = buildChildEntries(parent, () => undefined);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ kind: 'wikilink', target: 'Other', bodyLine: 3 });
    });

    it('skips childLines with invalid bodyLine offsets', () => {
        const parent = makeTask({
            childIds: [],
            childLines: [plainCl('- a', ' '), plainCl('- b', ' ')],
            childLineBodyOffsets: [5, -1],
        });
        const entries = buildChildEntries(parent, () => undefined);
        expect(entries).toHaveLength(1);
        expect(entries[0].bodyLine).toBe(5);
    });

    it('orders entries by bodyLine when tasks and plain interleave', () => {
        const parent = makeTask({
            id: 'p',
            parserId: 'tv-inline',
            line: 10,
            childIds: ['c'],
            childLines: [
                plainCl('- key:: v', null),  // line 11
                plainCl('- [ ] x', ' '),     // line 13
            ],
            childLineBodyOffsets: [11, 13],
        });
        const c = makeTask({ id: 'c', parserId: 'tv-inline', line: 12, childIds: [], childLines: [], childLineBodyOffsets: [] });
        const lookup = (id: string): Task | undefined => id === 'c' ? c : undefined;
        const entries = buildChildEntries(parent, lookup);
        expect(entries.map(e => ({ kind: e.kind, bodyLine: e.bodyLine }))).toEqual([
            { kind: 'line', bodyLine: 11 },
            { kind: 'task', bodyLine: 12 },
            { kind: 'line', bodyLine: 13 },
        ]);
    });
});

describe('extractWikilinkTarget', () => {
    it('strips alias after pipe', () => {
        expect(extractWikilinkTarget('SomeFile|Display Name')).toBe('SomeFile');
    });

    it('trims whitespace', () => {
        expect(extractWikilinkTarget('  Other  ')).toBe('Other');
    });

    it('returns target unchanged when no alias', () => {
        expect(extractWikilinkTarget('FileName')).toBe('FileName');
    });
});
