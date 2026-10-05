import { describe, it, expect } from 'vitest';
import { buildChildEntries } from '../../../src/services/data/ChildEntryBuilder';
import { makeTask } from '../helpers/makeTask';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS, type Task, type ChildLine } from '../../../src/types';

const plainCl = (text: string, bodyLine: number): ChildLine => ({
    text,
    bodyLine,
    indent: '',
    wikilinkTarget: null,
    propertyKey: null,
    propertyValue: null,
});

const wikiCl = (target: string, bodyLine: number): ChildLine => ({
    text: `- [[${target}]]`,
    bodyLine,
    indent: '',
    wikilinkTarget: target,
    propertyKey: null,
    propertyValue: null,
});

describe('buildChildEntries', () => {
    it('returns plain entries for childLines without sibling tasks', () => {
        const parent = makeTask({
            childIds: [],
            childLines: [plainCl('- a', 5), plainCl('- key:: v', 6)],
        });
        const entries = buildChildEntries(parent, () => undefined);
        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatchObject({ kind: 'line', bodyLine: 5 });
        expect(entries[1]).toMatchObject({ kind: 'line', bodyLine: 6 });
    });

    it('emits task entries for childIds and orders them by bodyLine', () => {
        const parent = makeTask({
            id: 'p',
            line: 4,
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

    // Every line is one task's at most: the extraction gives a child task's
    // subtree, its own `- ==>` lines included, to the child and not to the
    // parent (`NoteTasks`), so the entries only merge what it read.
    it('shows a child task once, and none of its subtree or its flow lines as the parent\'s lines', () => {
        const lines = [
            '- [ ] p',                 // 0
            '    - [ ] a',             // 1: a child task
            '        - b',             // 2: a's line
            '        - ==> every mon', // 3: a's flow line
            '    - c',                 // 4: p's own line
        ];
        const { tasks } = FileParsePipeline.parse('A.md', lines, DEFAULT_SETTINGS, namesOutsideIndex('A.md'));
        const byId = new Map(tasks.map(task => [task.id, task]));
        const parent = tasks.find(task => task.line === 0)!;
        const entries = buildChildEntries(parent, id => byId.get(id));
        expect(entries.map(e => ({ kind: e.kind, bodyLine: e.bodyLine }))).toEqual([
            { kind: 'task', bodyLine: 1 },
            { kind: 'line', bodyLine: 4 },
        ]);
    });

    // A `- [[note]]` line links nowhere special: frontmatter makes no task
    // for it to resolve to, so it is an ordinary line.
    it('emits a line entry for a wikilink child line', () => {
        const parent = makeTask({
            childIds: [],
            childLines: [wikiCl('Other', 3)],
        });
        const entries = buildChildEntries(parent, () => undefined);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ kind: 'line', bodyLine: 3 });
        expect(entries[0].kind === 'line' && entries[0].line.wikilinkTarget).toBe('Other');
    });

    it('orders entries by bodyLine when tasks and plain interleave', () => {
        const parent = makeTask({
            id: 'p',
            parserId: 'tv-inline',
            line: 10,
            childIds: ['c'],
            childLines: [
                plainCl('- key:: v', 11),
                plainCl('- note', 13),
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
