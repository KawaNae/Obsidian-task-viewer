import { describe, it, expect } from 'vitest';
import { ChildPropertyLineEditor } from '../../../src/services/persistence/utils/ChildPropertyLineEditor';
import { draftOver, type LineEdit } from '../../../src/utils/FileLines';
import type { PropertyOp } from '../../../src/services/persistence/PropertyUpdatePlanner';

/**
 * `applyOps` over a draft, the way `processLines` hands it one.
 *
 * Answers the report, so a test can pin what the edit said as well as what it
 * left in the file. The two have to agree: a line these ops rewrite without
 * saying so is a line `explains` refuses, and the whole write's claim is
 * dropped.
 */
function apply(lines: string[], taskLineIdx: number, ops: PropertyOp[]): LineEdit[] {
    const { draft, reported } = draftOver(lines);
    ChildPropertyLineEditor.applyOps(draft, taskLineIdx, ops);
    return reported;
}

describe('ChildPropertyLineEditor', () => {
    describe('findOwnPropertyLines', () => {
        it('空値プロパティ行 (`- key ::`) を own として検出する', () => {
            const lines = [
                '- [ ] task @2026-07-18T10:00',
                '    - key ::',
                '    - key2 :: value2',
            ];
            const own = ChildPropertyLineEditor.findOwnPropertyLines(lines, 0);
            expect(own).toEqual([
                { lineIdx: 1, key: 'key', value: '' },
                { lineIdx: 2, key: 'key2', value: 'value2' },
            ]);
        });
    });

    describe('a property line below a blank line inside the children', () => {
        // The parser reads it as the task's property (Outline.subtreeEnd); an
        // edit that did not would add a second declaration of the key.
        const lines = () => [
            '- [ ] task @2026-07-18T10:00',
            '    - [ ] child',
            '',
            '    - key:: old',
            '',
            '- [ ] next',
        ];

        it('is found as the task\'s own', () => {
            expect(ChildPropertyLineEditor.findOwnPropertyLines(lines(), 0)).toEqual([
                { lineIdx: 3, key: 'key', value: 'old' },
            ]);
        });

        it('is updated in place, not declared again', () => {
            const edited = lines();
            apply(edited, 0, [{ op: 'set', key: 'key', value: 'new' }]);
            expect(edited).toEqual([
                '- [ ] task @2026-07-18T10:00', '    - [ ] child', '', '    - key:: new', '', '- [ ] next',
            ]);
        });
    });

    describe('applyOps: set', () => {
        it('空値行への値設定はセパレータ空白を補ってその場更新する', () => {
            const lines = [
                '- [ ] task @2026-07-18T10:00',
                '    - key ::',
            ];
            apply(lines, 0, [{ key: 'key', op: 'set', value: 'v1' }]);
            expect(lines[1]).toBe('    - key :: v1');
        });

        it('既存値の置換はプレフィックス（インデント・キー表記）を保存する', () => {
            const lines = [
                '- [ ] task',
                '\t- 金額:: 100',
            ];
            apply(lines, 0, [{ key: '金額', op: 'set', value: '200' }]);
            expect(lines[1]).toBe('\t- 金額:: 200');
        });

        it('値を空に設定すると空値プロパティ行として残る', () => {
            const lines = [
                '- [ ] task',
                '    - key:: v1',
            ];
            apply(lines, 0, [{ key: 'key', op: 'set', value: '' }]);
            expect(lines[1]).toBe('    - key:: ');
        });
    });

    describe('applyOps: insert (own プロパティ行なし)', () => {
        it('既存子行のインデント表現を踏襲する（スペース系ファイルで tab 混在させない）', () => {
            const lines = [
                '- [ ] task @2026-07-18T10:00',
                '    - [ ] sub',
            ];
            apply(lines, 0, [{ key: 'key2', op: 'set', value: 'value2' }]);
            expect(lines).toEqual([
                '- [ ] task @2026-07-18T10:00',
                '    - key2:: value2',
                '    - [ ] sub',
            ]);
        });

        it('子行が無い場合はタスク行インデント + タブ 1 で挿入する', () => {
            const lines = [
                '- [ ] task @2026-07-18T10:00',
                '',
            ];
            apply(lines, 0, [{ key: 'key2', op: 'set', value: 'value2' }]);
            expect(lines[1]).toBe('\t- key2:: value2');
        });

        it('own プロパティ行があればその直後・同インデントに挿入する', () => {
            const lines = [
                '- [ ] task',
                '    - key ::',
                '    - [ ] sub',
            ];
            apply(lines, 0, [{ key: 'key2', op: 'set', value: 'v2' }]);
            expect(lines).toEqual([
                '- [ ] task',
                '    - key ::',
                '    - key2:: v2',
                '    - [ ] sub',
            ]);
        });
    });

    describe('applyOps: delete', () => {
        it('空値プロパティ行も delete で除去できる', () => {
            const lines = [
                '- [ ] task',
                '    - key ::',
                '    - [ ] sub',
            ];
            apply(lines, 0, [{ key: 'key', op: 'delete' }]);
            expect(lines).toEqual([
                '- [ ] task',
                '    - [ ] sub',
            ]);
        });
    });

    // ── フェンス内は宣言ではない ──
    //
    // パーサはフェンス内の `- key:: value` をプロパティとして読まない。
    // 書き込み側が own 宣言として扱うと、タスクの編集がユーザーのコード例を
    // 書き換えることになる。
    describe('fenced lines are not declarations', () => {
        it('フェンス内の property 行を own として拾わない', () => {
            const lines = [
                '- [ ] task',
                '    ```md',
                '    - key:: 例',
                '    ```',
            ];
            expect(ChildPropertyLineEditor.findOwnPropertyLines(lines, 0)).toEqual([]);
        });

        it('フェンス内の同名宣言を更新の対象にしない', () => {
            const lines = [
                '- [ ] task',
                '    ```md',
                '    - key:: 例',
                '    ```',
                '    - key:: 本物',
            ];
            apply(lines, 0, [{ key: 'key', op: 'set', value: '新' }]);
            expect(lines).toEqual([
                '- [ ] task',
                '    ```md',
                '    - key:: 例',
                '    ```',
                '    - key:: 新',
            ]);
        });

        it('フェンス内の同名宣言を delete で消さない', () => {
            const lines = [
                '- [ ] task',
                '    ```md',
                '    - key:: 例',
                '    ```',
                '    - key:: 本物',
            ];
            apply(lines, 0, [{ key: 'key', op: 'delete' }]);
            expect(lines).toEqual([
                '- [ ] task',
                '    ```md',
                '    - key:: 例',
                '    ```',
            ]);
        });

        it('フェンスしか無ければ新規挿入はタスク行直下に入る', () => {
            const lines = [
                '- [ ] task',
                '    ```md',
                '    - key:: 例',
                '    ```',
            ];
            apply(lines, 0, [{ key: 'key', op: 'set', value: '新' }]);
            expect(lines[1]).toBe('    - key:: 新');
            expect(lines.slice(2)).toEqual([
                '    ```md',
                '    - key:: 例',
                '    ```',
            ]);
        });
    });

    describe('applyOps: 申告', () => {
        // 行の結果だけでなく、書き込みが何をしたと言うかも固定する。申告を
        // 1経路でも落とすと、その行は「報告されていないのに前後で文字列が
        // 違う行」になり、explains が書き込み全体の主張を捨てる。落ちるのは
        // その経路を踏んだ組み合わせのときだけなので、経路ごとに押さえる。
        it('既存行の値の書き換えは rewrite として申告する', () => {
            const lines = [
                '- [ ] task',
                '\t- 金額:: 100',
            ];
            const reported = apply(lines, 0, [{ key: '金額', op: 'set', value: '200' }]);
            expect(reported).toEqual([{ kind: 'replaced', at: 1 }]);
            expect(lines[1]).toBe('\t- 金額:: 200');
        });

        it('新規の宣言行は insert として申告する', () => {
            const lines = [
                '- [ ] task',
                '',
            ];
            const reported = apply(lines, 0, [{ key: '金額', op: 'set', value: '200' }]);
            expect(reported).toEqual([{ kind: 'inserted', at: 1, count: 1 }]);
        });

        it('削除した宣言行を remove として申告する', () => {
            const lines = [
                '- [ ] task',
                '\t- 金額:: 100',
                '\t- [ ] sub',
            ];
            const reported = apply(lines, 0, [{ key: '金額', op: 'delete' }]);
            expect(reported).toEqual([{ kind: 'removed', at: 1, count: 1 }]);
        });

        it('同じキーの宣言行が複数あるとき、各行が立っていた座標で申告する', () => {
            // 逆順に消すので、どの at もその行が在った位置のまま。上から
            // 消すと残りがずれ、2件目の申告が1つ上の行を指してしまう。
            const lines = [
                '- [ ] task',
                '\t- 金額:: 100',
                '\t- 金額:: 300',
            ];
            const reported = apply(lines, 0, [{ key: '金額', op: 'delete' }]);
            expect(reported).toEqual([
                { kind: 'removed', at: 2, count: 1 },
                { kind: 'removed', at: 1, count: 1 },
            ]);
            expect(lines).toEqual(['- [ ] task']);
        });

        it('op が続くとき、後の申告は前の op が動かしたあとの座標で出る', () => {
            const lines = [
                '- [ ] task',
                '\t- a:: 1',
                '\t- b:: 2',
            ];
            const reported = apply(lines, 0, [
                { key: 'a', op: 'delete' },
                { key: 'c', op: 'set', value: '3' },
            ]);
            expect(reported).toEqual([
                { kind: 'removed', at: 1, count: 1 },
                { kind: 'inserted', at: 2, count: 1 },
            ]);
            expect(lines).toEqual(['- [ ] task', '\t- b:: 2', '\t- c:: 3']);
        });

        it('フェンスの中の宣言行には触れず、申告にも出さない', () => {
            const lines = [
                '- [ ] task',
                '\t- 金額:: 100',
                '\t```',
                '\t- 金額:: 999',
                '\t```',
            ];
            const reported = apply(lines, 0, [{ key: '金額', op: 'set', value: '200' }]);
            expect(reported).toEqual([{ kind: 'replaced', at: 1 }]);
            expect(lines[3]).toBe('\t- 金額:: 999');
        });
    });
});
