import { describe, it, expect } from 'vitest';
import {
    applyIdentity,
    assertDistinctRuntimeIds,
    assertNoProvisionalIds,
} from '../../../../../src/services/core/identity/IdentityApplier';
import type { FileParseResult } from '../../../../../src/services/parsing/FileParsePipeline';
import { makeTask } from '../../../helpers/makeTask';
import type { Task } from '../../../../../src/types';

function parseResult(tasks: Task[]): FileParseResult {
    return { ignored: false, tasks, genBlocks: new Map() };
}

describe('applyIdentity', () => {
    it('rewrites id, parentId and childIds together', () => {
        const root = makeTask({ id: 'prov:root', line: 0, childIds: ['prov:a'] });
        const a = makeTask({ id: 'prov:a', line: 1, parentId: 'prov:root', childIds: ['prov:b'] });
        const b = makeTask({ id: 'prov:b', line: 2, parentId: 'prov:a' });
        const parsed = parseResult([root, a, b]);

        applyIdentity(parsed, new Map([['prov:root', 'rt:root'], ['prov:a', 'rt:a'], ['prov:b', 'rt:b']]));

        // Mutation: rewrite only `task.id` and the cross-references dangle — the
        // card silently loses its children, with nothing to point at the cause.
        expect([root.id, a.id, b.id]).toEqual(['rt:root', 'rt:a', 'rt:b']);
        expect(root.childIds).toEqual(['rt:a']);
        expect(a.childIds).toEqual(['rt:b']);
        expect(a.parentId).toBe('rt:root');
        expect(b.parentId).toBe('rt:a');
    });

    it('rewrites each object exactly once', () => {
        // `rt:a` is also somebody's old ID. A second visit would map it on to
        // `rt:z`, so the single pass is what keeps the result correct.
        const root = makeTask({ id: 'prov:root', line: 0, childIds: ['prov:a'] });
        const parsed = parseResult([root]);

        applyIdentity(parsed, new Map([['prov:root', 'rt:a'], ['rt:a', 'rt:z'], ['prov:a', 'rt:a']]));

        expect(root.id).toBe('rt:a');
        expect(root.childIds).toEqual(['rt:a']);
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

describe('assertDistinctRuntimeIds', () => {
    it('lets a file whose rows each have their own ID through', () => {
        expect(() => assertDistinctRuntimeIds([
            { runtimeId: 'r1' }, { runtimeId: 'r2' },
        ])).not.toThrow();
    });

    it('stops one ID being handed to two rows', () => {
        // Observed on a build without the check, from a claim that named one
        // row twice: the store lost a task (it is keyed by ID), the ledger kept
        // two positions and one entry, and no later scan put it back. The task
        // whose ID went missing then refused every write as "not found".
        expect(() => assertDistinctRuntimeIds([
            { runtimeId: 'r1' }, { runtimeId: 'r1' }, { runtimeId: 'r2' },
        ])).toThrow(/r1/);
    });
});
