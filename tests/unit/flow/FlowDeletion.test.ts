import { describe, it, expect } from 'vitest';
import {
    assessFlowDelete,
    countDescendantFlows,
    planFlowForDeletion,
} from '../../../src/services/flow/FlowDeletion';
import type { FlowPlanDeps } from '../../../src/services/flow/FlowPlanner';
import { singleLineFlow } from '../../../src/services/flow/FlowSegments';
import type { GenBlock } from '../../../src/services/parsing/gen/GenBlockCollector';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

// 2026-07-02 is a Thursday.
const DEPS: FlowPlanDeps = {
    today: '2026-07-02',
    now: { date: '2026-07-02', time: '10:00' },
    weekStartDay: 1,
    host: { formatDate: (_v, tokens) => `[${tokens}]` },
    getBlock: () => undefined,
};

function withBlock(name: string, body: string[]): FlowPlanDeps {
    const block: GenBlock = { name, body, openLine: 0, closeLine: body.length + 1 };
    return { ...DEPS, getBlock: () => block };
}

/** A live task carrying `src`, dated so that every schedule has an anchor. */
function flowTask(src: string, overrides: Partial<Task> = {}): Task {
    return makeTask({
        content: '週報',
        startDate: '2026-06-29',
        originalText: '- [ ] 週報 @2026-06-29',
        flow: singleLineFlow(src),
        ...overrides,
    });
}

describe('planFlowForDeletion', () => {
    describe('what the fire would save', () => {
        it('keeps only the effects that write the next instance', () => {
            const outlook = planFlowForDeletion(flowTask('every mon'), DEPS);

            expect(outlook.kind).toBe('creates');
            if (outlook.kind !== 'creates') return;
            // strip-flow has no place here: the line it would rewrite is the
            // line about to be deleted.
            expect(outlook.effects.map(e => e.kind)).toEqual(['create-next']);
        });

        it('previews the line the writer would put on the page', () => {
            const outlook = planFlowForDeletion(flowTask('every mon x3'), DEPS);

            expect(outlook.kind).toBe('creates');
            if (outlook.kind !== 'creates') return;
            // Next Monday after 2026-07-02, telomere spent down by one.
            expect(outlook.previewLine).toBe('- [ ] 週報 @2026-07-06 ==> every mon x2');
        });

        it('previews the parent line a generation block wrote', () => {
            // `dates` carries the whole block, `@` included.
            const deps = withBlock('週次', ['- [ ] ${content} 第1回 ${dates}']);
            const outlook = planFlowForDeletion(flowTask('every mon use("週次")'), deps);

            expect(outlook.kind).toBe('creates');
            if (outlook.kind !== 'creates') return;
            expect(outlook.effects.map(e => e.kind)).toEqual(['create-generated']);
            expect(outlook.previewLine).toBe('- [ ] 週報 第1回 @2026-07-06 ==> every mon use("週次")');
        });
    });

    describe('nothing to save', () => {
        it('a task with no command', () => {
            expect(planFlowForDeletion(makeTask(), DEPS).kind).toBe('nothing');
        });

        it('until has passed, so no instance follows this one', () => {
            const outlook = planFlowForDeletion(flowTask('every mon until(2026-06-30)'), DEPS);
            expect(outlook.kind).toBe('nothing');
        });

        it('x1 still generates: the last instance is one the delete would lose', () => {
            const outlook = planFlowForDeletion(flowTask('every mon x1'), DEPS);

            expect(outlook.kind).toBe('creates');
            if (outlook.kind !== 'creates') return;
            // The final instance carries no command of its own.
            expect(outlook.previewLine).toBe('- [ ] 週報 @2026-07-06');
        });

        it('move alone: archiving is not what a delete was asked for', () => {
            const outlook = planFlowForDeletion(flowTask('move([[Archive]])'), DEPS);
            expect(outlook.kind).toBe('nothing');
        });

        it('move alongside a schedule: the next instance is kept, the copy is not', () => {
            const outlook = planFlowForDeletion(flowTask('every mon move([[Archive]])'), DEPS);

            expect(outlook.kind).toBe('creates');
            if (outlook.kind !== 'creates') return;
            expect(outlook.effects.map(e => e.kind)).toEqual(['create-next']);
        });
    });

    describe('a command that cannot be planned', () => {
        it('reports the expression failure rather than throwing', () => {
            // `end` is unset on the task, so the setter fails while it runs.
            const outlook = planFlowForDeletion(flowTask('every mon setDue(end + 1d)'), DEPS);

            expect(outlook.kind).toBe('failed');
            if (outlook.kind !== 'failed') return;
            expect(outlook.error.code).toBe('eval.prop-unset');
        });

        it('reports a block that answers to no name', () => {
            const outlook = planFlowForDeletion(flowTask('every mon use("いない")'), DEPS);

            expect(outlook.kind).toBe('failed');
            if (outlook.kind !== 'failed') return;
            expect(outlook.error.code).toBe('eval.no-such-block');
        });

        it('reports a block that cannot generate', () => {
            const deps = withBlock('壊れ', ['- [ ] ${', '- [ ] second root']);
            const outlook = planFlowForDeletion(flowTask('every mon use("壊れ")'), deps);

            expect(outlook.kind).toBe('failed');
        });
    });
});

describe('countDescendantFlows', () => {
    function tree(tasks: Task[]): (id: string) => Task | undefined {
        const byId = new Map(tasks.map(t => [t.id, t]));
        return id => byId.get(id);
    }

    it('counts commands below the task, not the task itself', () => {
        const child = flowTask('every mon', { id: 'child' });
        const parent = flowTask('every tue', { id: 'parent', childIds: ['child'] });

        expect(countDescendantFlows(parent, tree([parent, child]))).toBe(1);
    });

    it('reaches grandchildren', () => {
        const grand = flowTask('every wed', { id: 'grand' });
        const child = makeTask({ id: 'child', childIds: ['grand'] });
        const parent = makeTask({ id: 'parent', childIds: ['child'] });

        expect(countDescendantFlows(parent, tree([parent, child, grand]))).toBe(1);
    });

    it('ignores children without a command', () => {
        const child = makeTask({ id: 'child' });
        const parent = makeTask({ id: 'parent', childIds: ['child'] });

        expect(countDescendantFlows(parent, tree([parent, child]))).toBe(0);
    });

    it('terminates on a cycle rather than hanging the menu that asked', () => {
        const a = flowTask('every mon', { id: 'a', childIds: ['b'] });
        const b = flowTask('every tue', { id: 'b', childIds: ['a'] });

        expect(countDescendantFlows(a, tree([a, b]))).toBe(1);
    });

    it('counts a task reachable by two paths once', () => {
        const shared = flowTask('every mon', { id: 'shared' });
        const left = makeTask({ id: 'left', childIds: ['shared'] });
        const right = makeTask({ id: 'right', childIds: ['shared'] });
        const parent = makeTask({ id: 'parent', childIds: ['left', 'right'] });

        expect(countDescendantFlows(parent, tree([parent, left, right, shared]))).toBe(1);
    });
});

describe('assessFlowDelete', () => {
    it('answers both halves of the question in one call', () => {
        const child = flowTask('every wed', { id: 'child' });
        const parent = flowTask('every mon', { id: 'parent', childIds: ['child'] });
        const byId = new Map([[child.id, child]]);

        const assessment = assessFlowDelete(parent, DEPS, id => byId.get(id));

        expect(assessment.outlook.kind).toBe('creates');
        expect(assessment.descendantFlows).toBe(1);
    });

    it('still counts the descendants when the task itself has nothing to fire', () => {
        const child = flowTask('every wed', { id: 'child' });
        const parent = makeTask({ id: 'parent', childIds: ['child'] });
        const byId = new Map([[child.id, child]]);

        const assessment = assessFlowDelete(parent, DEPS, id => byId.get(id));

        expect(assessment.outlook.kind).toBe('nothing');
        expect(assessment.descendantFlows).toBe(1);
    });
});
