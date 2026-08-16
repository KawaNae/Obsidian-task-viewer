import { describe, it, expect } from 'vitest';
import { declaredCells } from '../../../src/services/parsing/gen/GenCellScan';

/**
 * What a block is allowed to call a cell.
 *
 * Every reader of a block asks this, because a block is written apart from the
 * command that fires it and the names come from outside. A reader that skips
 * it reports each cell as a name nobody declared — the shape the rendered
 * preview shipped with until it was given this.
 */

const types = (lines: string[]) => Object.fromEntries(declaredCells(lines));

describe('declaredCells', () => {
    it('reads a command on a task line', () => {
        expect(types(['- [ ] 週報 @2026-08-20 ==> every 1w let(n: 3) use("週報")']))
            .toEqual({ n: 'number' });
    });

    it('reads a clause written on a flow child line', () => {
        // 子行だけでは program にならない（スケジュールが無い）。宣言は真。
        expect(types([
            '- [ ] 週報 @2026-08-20',
            '\t- ==> every 1w',
            '\t- ==> let(n: 3) use("週報")',
        ])).toEqual({ n: 'number' });
    });

    it('takes every command of the file, whatever the order', () => {
        expect(types([
            '```tv-gen A',
            '- [ ] ${a}',
            '```',
            '- [ ] x @2026-08-20 ==> every 1w let(a: 3) use("A")',
            '- [ ] y @2026-08-21 ==> every 1w let(b: "序盤") use("A")',
        ])).toEqual({ a: 'number', b: 'string' });
    });

    it('says nothing about a name two commands disagree on', () => {
        // 型を 1 つ選ぶと、選ばなかった側のブロックに嘘の型エラーが出る。
        expect(types([
            '- [ ] x @2026-08-20 ==> every 1w let(n: 3) use("A")',
            '- [ ] y @2026-08-21 ==> every 1w let(n: "序盤") use("B")',
        ])).toEqual({ n: 'error' });
    });

    it('leaves a command inside a fence alone', () => {
        // 例であってコマンドではない。ブロック本文の見本もここで落ちる。
        expect(types([
            '```markdown',
            '- [ ] 見本 @2026-08-20 ==> every 1w let(n: 3) use("A")',
            '```',
        ])).toEqual({});
        expect(types([
            '- [ ] 親',
            '\t```markdown',
            '\t- [ ] 見本 @2026-08-20 ==> every 1w let(n: 3) use("A")',
            '\t```',
        ])).toEqual({});
    });

    it('has nothing to say about a file with no command', () => {
        expect(types(['- [ ] ただのタスク @2026-08-20', '# 見出し'])).toEqual({});
    });
});
