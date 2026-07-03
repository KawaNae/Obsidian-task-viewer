import { describe, it, expect } from 'vitest';
import { buildChildEntries, extractWikilinkTarget } from '../../../src/services/data/ChildEntryBuilder';
import { makeTask } from '../helpers/makeTask';
import type { Task, ChildLine } from '../../../src/types';

const plainCl = (text: string, bodyLine: number, checkboxChar: string | null = null): ChildLine => ({
    text,
    bodyLine,
    indent: '',
    checkboxChar,
    wikilinkTarget: null,
    propertyKey: null,
    propertyValue: null,
});

const wikiCl = (target: string, bodyLine: number): ChildLine => ({
    text: `- [[${target}]]`,
    bodyLine,
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
            childLines: [plainCl('- [ ] a', 5, ' '), plainCl('- key:: v', 6, null)],
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
        });
        const c1 = makeTask({ id: 'c1', parserId: 'tv-inline', line: 5, childIds: [], childLines: [] });
        const c2 = makeTask({ id: 'c2', parserId: 'tv-inline', line: 8, childIds: [], childLines: [] });
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
                plainCl('- a', 5, ' '),  // line 5: this is c1's own line
                plainCl('- b', 6, ' '),  // line 6: child of c1
                plainCl('- c', 7, ' '),  // line 7: not in any subtree
            ],
        });
        const c1 = makeTask({
            id: 'c1',
            parserId: 'tv-inline',
            line: 5,
            childIds: [],
            childLines: [plainCl('- b', 6, ' ')],
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

    it('drops plain entries occupied by a sibling tasks flow child lines', () => {
        // c1 owns a `- ==>` flow line at line 6; the extractor removes it
        // from c1's childLines (it lives in flow.childSegments), but the
        // parent must still treat it as c1's subtree line.
        const parent = makeTask({
            id: 'p',
            parserId: 'tv-file',
            line: -1,
            childIds: ['c1'],
            childLines: [
                plainCl('- [ ] a', 5, ' '),      // line 5: c1's own line
                plainCl('- ==> every mon', 6),   // line 6: c1's flow child line
                plainCl('- c', 7),               // line 7: parent's own note
            ],
        });
        const c1 = makeTask({
            id: 'c1',
            parserId: 'tv-inline',
            line: 5,
            childIds: [],
            childLines: [],
            flow: {
                raw: '',
                childSegments: [{ raw: 'every mon', bodyLine: 6 }],
                program: null,
                diagnostics: [],
            },
        });
        const lookup = (id: string): Task | undefined => id === 'c1' ? c1 : undefined;
        const entries = buildChildEntries(parent, lookup);
        expect(entries.map(e => ({ kind: e.kind, bodyLine: e.bodyLine }))).toEqual([
            { kind: 'task', bodyLine: 5 },
            { kind: 'line', bodyLine: 7 },
        ]);
    });

    it('keeps a plain entry whose bodyLine collides with a cross-file sibling subtree', () => {
        // parent (A.md) has a plain note at absolute line 5 plus a cross-file
        // tv-file child B whose own subtree occupies line 5 *in B.md*. The
        // collision is only on the raw line number; file-qualified subtree
        // keys (A.md:5 vs B.md:5) must keep A.md's plain entry from dropping.
        const parent = makeTask({
            id: 'p', file: 'A.md', parserId: 'tv-file', line: -1,
            childIds: ['b'],
            childLines: [plainCl('- note', 5, null)],
        });
        const b = makeTask({
            id: 'b', file: 'B.md', parserId: 'tv-file', line: -1,
            childIds: [],
            childLines: [plainCl('- sub', 5, ' ')],
        });
        const lookup = (id: string): Task | undefined => id === 'b' ? b : undefined;
        const entries = buildChildEntries(parent, lookup);
        expect(entries.some(e => e.kind === 'line' && e.bodyLine === 5)).toBe(true);
    });

    it('emits wikilink entries for childLines with wikilinkTarget', () => {
        const parent = makeTask({
            childIds: [],
            childLines: [wikiCl('Other', 3)],
        });
        const entries = buildChildEntries(parent, () => undefined);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ kind: 'wikilink', target: 'Other', bodyLine: 3 });
    });

    it('skips childLines with invalid bodyLine (-1 sentinel)', () => {
        const parent = makeTask({
            childIds: [],
            childLines: [plainCl('- a', 5, ' '), plainCl('- b', -1, ' ')],
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
                plainCl('- key:: v', 11, null),
                plainCl('- [ ] x', 13, ' '),
            ],
        });
        const c = makeTask({ id: 'c', parserId: 'tv-inline', line: 12, childIds: [], childLines: [] });
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
