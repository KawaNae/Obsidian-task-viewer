import { describe, it, expect } from 'vitest';
import {
    applyIdentity,
    assertNoProvisionalIds,
} from '../../../../../src/services/core/identity/IdentityApplier';
import type { FileParseResult } from '../../../../../src/services/parsing/FileParsePipeline';
import { makeTask } from '../../../helpers/makeTask';
import type { Task } from '../../../../../src/types';

function parseResult(tasks: Task[], fmTask: Task | null = null): FileParseResult {
    return { ignored: false, tasks, fmTask, wikilinkRefs: [], genBlocks: new Map() };
}

describe('applyIdentity', () => {
    it('rewrites id, parentId and childIds together', () => {
        const fm = makeTask({ id: 'prov:fm', parserId: 'tv-file', line: -1, childIds: ['prov:a', 'prov:b'] });
        const a = makeTask({ id: 'prov:a', line: 0, parentId: 'prov:fm', childIds: ['prov:b'] });
        const b = makeTask({ id: 'prov:b', line: 1, parentId: 'prov:a' });
        const parsed = parseResult([fm, a, b], fm);

        applyIdentity(parsed, new Map([['prov:fm', 'rt:fm'], ['prov:a', 'rt:a'], ['prov:b', 'rt:b']]));

        // Mutation: rewrite only `task.id` and the cross-references dangle — the
        // card silently loses its children, with nothing to point at the cause.
        expect([fm.id, a.id, b.id]).toEqual(['rt:fm', 'rt:a', 'rt:b']);
        expect(fm.childIds).toEqual(['rt:a', 'rt:b']);
        expect(a.childIds).toEqual(['rt:b']);
        expect(a.parentId).toBe('rt:fm');
        expect(b.parentId).toBe('rt:a');
    });

    it('rewrites an fm task that the pipeline kept out of `tasks`', () => {
        // An empty container is returned as `fmTask` without being pushed into
        // `tasks`, and `wikilinkRefs` are keyed by its ID downstream.
        const fm = makeTask({ id: 'prov:fm', parserId: 'tv-file', line: -1 });
        const parsed = parseResult([], fm);

        applyIdentity(parsed, new Map([['prov:fm', 'rt:fm']]));

        expect(fm.id).toBe('rt:fm');
    });

    it('rewrites each object exactly once', () => {
        // `rt:a` is also somebody's old ID. A second visit would map it on to
        // `rt:z`, so the single pass is what keeps the result correct.
        const fm = makeTask({ id: 'prov:fm', parserId: 'tv-file', line: -1, childIds: ['prov:a'] });
        const parsed = parseResult([fm], fm);

        applyIdentity(parsed, new Map([['prov:fm', 'rt:a'], ['rt:a', 'rt:z'], ['prov:a', 'rt:a']]));

        expect(fm.id).toBe('rt:a');
        expect(fm.childIds).toEqual(['rt:a']);
    });

    it('leaves IDs it was given no mapping for', () => {
        const task = makeTask({ id: 'prov:a', parentId: 'outside:x', childIds: ['outside:y'] });
        const parsed = parseResult([task]);

        applyIdentity(parsed, new Map([['prov:a', 'rt:a']]));

        expect(task.id).toBe('rt:a');
        expect(task.parentId).toBe('outside:x');
        expect(task.childIds).toEqual(['outside:y']);
    });
});

describe('assertNoProvisionalIds', () => {
    const isProvisional = (id: string) => id.startsWith('prov:');

    it('says nothing when every reference was rewritten', () => {
        const task = makeTask({ id: 'rt:a', parentId: 'rt:fm', childIds: ['rt:b'] });
        expect(() => assertNoProvisionalIds([task], isProvisional)).not.toThrow();
    });

    it('throws with every offending ID, wherever it was hiding', () => {
        const tasks = [
            makeTask({ id: 'prov:a', parentId: 'rt:fm', childIds: [] }),
            makeTask({ id: 'rt:b', parentId: 'prov:p', childIds: ['prov:c', 'rt:d'] }),
        ];

        expect(() => assertNoProvisionalIds(tasks, isProvisional)).toThrow(/prov:a, prov:p, prov:c/);
    });
});
