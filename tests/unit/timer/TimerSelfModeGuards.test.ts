import { describe, it, expect } from 'vitest';
import { canTriggerFlow } from '../../../src/services/flow/FlowTrigger';
import { singleLineFlow } from '../../../src/services/flow/FlowSegments';
import { DEFAULT_STATUS_DEFINITIONS, TaskFlow } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

// ---------------------------------------------------------------------------
// Issue 1: TimerMenuBuilder guard — completed command tasks must not show Track
// Self. The guard IS canTriggerFlow (single source of truth), so test it directly.
// ---------------------------------------------------------------------------

function repeatFlow(): TaskFlow {
    return singleLineFlow('at(today + 1d)');
}

describe('TimerMenuBuilder guard: completed command task suppression', () => {
    it('完了済みコマンドタスクに Track Self メニューを表示しない', () => {
        const task = makeTask({ statusChar: 'x', flow: repeatFlow() });
        expect(canTriggerFlow(task, DEFAULT_STATUS_DEFINITIONS)).toBe(true);
    });

    it('未完了コマンドタスクでは Track Self を許可する', () => {
        const task = makeTask({ statusChar: ' ', flow: repeatFlow() });
        expect(canTriggerFlow(task, DEFAULT_STATUS_DEFINITIONS)).toBe(false);
    });

    it('完了済みだがコマンドなしタスクでは Track Self を許可する', () => {
        const task = makeTask({ statusChar: 'x' });
        expect(canTriggerFlow(task, DEFAULT_STATUS_DEFINITIONS)).toBe(false);
    });

    it('未完了でコマンドなしタスクでは Track Self を許可する', () => {
        const task = makeTask({ statusChar: ' ' });
        expect(canTriggerFlow(task, DEFAULT_STATUS_DEFINITIONS)).toBe(false);
    });

    it('壊れたフロー（program=null）は発火しない', () => {
        const task = makeTask({ statusChar: 'x', flow: singleLineFlow('evry mon') });
        expect(canTriggerFlow(task, DEFAULT_STATUS_DEFINITIONS)).toBe(false);
    });

    it('Doing(/) は完了扱いでないため発火しない', () => {
        const task = makeTask({ statusChar: '/', flow: repeatFlow() });
        expect(canTriggerFlow(task, DEFAULT_STATUS_DEFINITIONS)).toBe(false);
    });

    it('Cancelled(-) は完了扱いのため発火する', () => {
        const task = makeTask({ statusChar: '-', flow: repeatFlow() });
        expect(canTriggerFlow(task, DEFAULT_STATUS_DEFINITIONS)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Issue 2 の blockId 判定はここには置かない。
//
// かつてこのファイルは updateTaskDirectly の blockId ロジックを**書き写した**
// 純関数を検証していた。写しは本体の変更に付いてこられず、実コードが「記録して
// も id を残す」に変わった後も古い規則を緑のまま主張していた（テストが嘘をつく
// 状態）。現在の規則 — 記録では残す / 再開で前のレコードから外す / widget close
// で 0 個 / ユーザーの手書き id は触らない — は実物を呼ぶテストが持っている:
//   tests/unit/timer/TimerSessionPlacement.test.ts
//   tests/unit/timer/TimerRecordRouting.test.ts
// ---------------------------------------------------------------------------
