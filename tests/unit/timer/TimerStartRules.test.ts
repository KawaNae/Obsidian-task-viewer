import { describe, it, expect } from 'vitest';
import { canTriggerFlow } from '../../../src/services/flow/FlowTrigger';
import { singleLineFlow } from '../../../src/services/lang/flow/FlowSegments';
import { DEFAULT_STATUS_DEFINITIONS, type TaskFlow } from '../../../src/types';
import { allowsSelf, decideStart } from '../../../src/timer/TimerStartRules';
import { makeTask } from '../helpers/makeTask';

/**
 * 開始してよいか、self を使えるか（TimerStartRules）。開始の命令とメニュー
 * （TimerMenuBuilder が self の項目を出すか）が同じ関数に問う。
 *
 * - 読み取り専用の記法は始めない
 * - フローを起こしうるタスクは self を使わない（child に落とす）
 * - `[x]` への self は尋ねる
 */

function repeatFlow(): TaskFlow {
    return singleLineFlow('at(today + 1d)');
}

const DEFS = DEFAULT_STATUS_DEFINITIONS;

describe('canTriggerFlow: what keeps a task from self', () => {
    it('完了済みでフローのあるタスクは発火しうる', () => {
        expect(canTriggerFlow(makeTask({ statusChar: 'x', flow: repeatFlow() }), DEFS)).toBe(true);
    });

    it('未完了でフローのあるタスクは発火しない', () => {
        expect(canTriggerFlow(makeTask({ statusChar: ' ', flow: repeatFlow() }), DEFS)).toBe(false);
    });

    it('フローの無いタスクは完了済みでも未完了でも発火しない', () => {
        expect(canTriggerFlow(makeTask({ statusChar: 'x' }), DEFS)).toBe(false);
        expect(canTriggerFlow(makeTask({ statusChar: ' ' }), DEFS)).toBe(false);
    });

    it('壊れたフロー（program=null）は発火しない', () => {
        expect(canTriggerFlow(makeTask({ statusChar: 'x', flow: singleLineFlow('evry mon') }), DEFS)).toBe(false);
    });

    it('Doing(/) は完了扱いでないため発火しない', () => {
        expect(canTriggerFlow(makeTask({ statusChar: '/', flow: repeatFlow() }), DEFS)).toBe(false);
    });

    it('Cancelled(-) は完了扱いのため発火する', () => {
        expect(canTriggerFlow(makeTask({ statusChar: '-', flow: repeatFlow() }), DEFS)).toBe(true);
    });
});

describe('allowsSelf', () => {
    it('フローを起こしうるタスクには self を出さない', () => {
        expect(allowsSelf(makeTask({ statusChar: 'x', flow: repeatFlow() }), DEFS)).toBe(false);
    });

    it('読み取り専用の記法には self を出さない', () => {
        expect(allowsSelf(makeTask({ isReadOnly: true }), DEFS)).toBe(false);
    });

    it('ほかのタスクには self を出す（完了済みでも）', () => {
        expect(allowsSelf(makeTask({ statusChar: ' ' }), DEFS)).toBe(true);
        expect(allowsSelf(makeTask({ statusChar: 'x' }), DEFS)).toBe(true);
        expect(allowsSelf(makeTask({ statusChar: ' ', flow: repeatFlow() }), DEFS)).toBe(true);
    });
});

describe('decideStart', () => {
    it('読み取り専用の記法は、どの mode でも始めない', () => {
        const task = makeTask({ isReadOnly: true, parserId: 'day-planner' });
        for (const mode of ['self', 'child', 'sibling'] as const) {
            expect(decideStart(task, mode, DEFS)).toEqual({ kind: 'refuse' });
        }
    });

    it('フローを起こしうるタスクへの self は child に落とす', () => {
        expect(decideStart(makeTask({ statusChar: 'x', flow: repeatFlow() }), 'self', DEFS))
            .toEqual({ kind: 'start', mode: 'child' });
    });

    it('[x] への self は尋ねる', () => {
        expect(decideStart(makeTask({ statusChar: 'x' }), 'self', DEFS)).toEqual({ kind: 'ask' });
    });

    it('未完了への self と、child と sibling はそのまま始める', () => {
        expect(decideStart(makeTask({ statusChar: ' ' }), 'self', DEFS)).toEqual({ kind: 'start', mode: 'self' });
        expect(decideStart(makeTask({ statusChar: 'x' }), 'child', DEFS)).toEqual({ kind: 'start', mode: 'child' });
        expect(decideStart(makeTask({ statusChar: 'x', flow: repeatFlow() }), 'sibling', DEFS))
            .toEqual({ kind: 'start', mode: 'sibling' });
    });
});
