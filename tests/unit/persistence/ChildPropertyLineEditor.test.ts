import { describe, it, expect } from 'vitest';
import { ChildPropertyLineEditor } from '../../../src/services/persistence/utils/ChildPropertyLineEditor';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { draftOver, type LineEdit } from '../../../src/services/persistence/FileLines';
import type { PropertyOp } from '../../../src/services/persistence/PropertyUpdatePlanner';
import { PropertyLines } from '../../../src/services/parsing/utils/PropertyLines';
import { DEFAULT_SCOPE_KEYS } from '../../../src/types';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';

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
    const refused = ChildPropertyLineEditor.applyOps(draft, taskLineIdx, { ops, keys: DEFAULT_SCOPE_KEYS }, '\t');
    if (refused) throw new Error(`refused: ${JSON.stringify(refused)}`);
    return reported;
}

/** What `applyOps` answers over `lines`, which it leaves as they were when it refuses. */
function refusal(lines: string[], taskLineIdx: number, ops: PropertyOp[]) {
    const { draft } = draftOver(lines);
    return ChildPropertyLineEditor.applyOps(draft, taskLineIdx, { ops, keys: DEFAULT_SCOPE_KEYS }, '\t');
}

/** The task's own property lines as the writer reads them (`PropertyLines.ofTask`). */
const ownLines = (lines: string[], task: number) => PropertyLines.ofTask(Outline.read(lines), task).lines
    .map(line => ({ lineIdx: line.line, key: line.key, value: line.written }));

describe('ChildPropertyLineEditor', () => {
    describe('findOwnPropertyLines', () => {
        it('空値プロパティ行 (`- key ::`) を own として検出する', () => {
            const lines = [
                '- [ ] task @2026-07-18T10:00',
                '    - key ::',
                '    - key2 :: value2',
            ];
            const own = ownLines(lines, 0);
            expect(own).toEqual([
                { lineIdx: 1, key: 'key', value: '' },
                { lineIdx: 2, key: 'key2', value: 'value2' },
            ]);
        });

        it('does not take a child task\'s property lines as its own', () => {
            // The child is a task however its marker is spaced (`-\t[ ]`),
            // so the lines below it are the child's, not the parent's.
            const lines = [
                '- [ ] task',
                '    - [ ] child',
                '        - deep:: of-child',
                '    -\t[ ] tabbed',
                '        - key:: of-tabbed',
                '    - key:: own',
            ];
            expect(ownLines(lines, 0)).toEqual([
                { lineIdx: 5, key: 'key', value: 'own' },
            ]);
        });
    });

    describe('a property line below a blank line inside the children', () => {
        // The parser reads it as the task's property (OutlineReading.subtreeEnd); an
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
            expect(ownLines(lines(), 0)).toEqual([
                { lineIdx: 3, key: 'key', value: 'old' },
            ]);
        });

        it('is updated in place, not declared again', () => {
            const edited = lines();
            apply(edited, 0, [{ op: 'set', key: 'key', value: { text: 'new' } }]);
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
            apply(lines, 0, [{ key: 'key', op: 'set', value: { text: 'v1' } }]);
            expect(lines[1]).toBe('    - key :: v1');
        });

        it('既存値の置換はプレフィックス（インデント・キー表記）を保存する', () => {
            const lines = [
                '- [ ] task',
                '\t- 金額:: 100',
            ];
            apply(lines, 0, [{ key: '金額', op: 'set', value: { text: '200' } }]);
            expect(lines[1]).toBe('\t- 金額:: 200');
        });

        it('writes tags as #tags, over a line written with commas, which Obsidian reads no tag from', () => {
            const lines = [
                '- [ ] task',
                '\t- tags:: a, b',
            ];
            apply(lines, 0, [{ key: 'tags', op: 'set', value: { tags: ['a', 'b', 'c'] } }]);
            expect(lines[1]).toBe('\t- tags:: #a #b #c');
        });

        it('edits the property line the parser reads under any bullet, keeping its bullet', () => {
            const lines = [
                '- [ ] task',
                '    * a:: 1',
                '    1. b:: 2',
            ];
            apply(lines, 0, [{ key: 'a', op: 'set', value: { text: '3' } }, { key: 'b', op: 'delete' }]);
            expect(lines).toEqual(['- [ ] task', '    * a:: 3']);
        });

        it('writes no value with hide, the spaces after `::` dropped', () => {
            const lines = [
                '- [ ] task',
                '    - key:: v1',
            ];
            apply(lines, 0, [{ key: 'key', op: 'hide' }]);
            expect(lines[1]).toBe('    - key::');
        });
    });

    describe('a property\'s block: its line and the items of its list', () => {
        it('writes a value over a list, taking its items out', () => {
            const lines = ['- [ ] task', '\t- k::', '\t\t- a', '\t\t- b', '\t- other:: 1'];
            apply(lines, 0, [{ key: 'k', op: 'set', value: { text: 'x' } }]);
            expect(lines).toEqual(['- [ ] task', '\t- k:: x', '\t- other:: 1']);
        });

        it('takes a list\'s line out with its items', () => {
            const lines = ['- [ ] task', '\t- k::', '\t\t- a', '', '\t\t- b', '\t- other:: 1'];
            apply(lines, 0, [{ key: 'k', op: 'delete' }]);
            expect(lines).toEqual(['- [ ] task', '\t- other:: 1']);
        });

        it('hides with a line of no value, taking a list\'s items out', () => {
            const lines = ['- [ ] task', '\t- k::', '\t\t- a', '\t- other:: 1'];
            apply(lines, 0, [{ key: 'k', op: 'hide' }]);
            expect(lines).toEqual(['- [ ] task', '\t- k::', '\t- other:: 1']);
        });

        it('hides with a new line of no value', () => {
            const lines = ['- [ ] task', '\t- other:: 1'];
            apply(lines, 0, [{ key: 'k', op: 'hide' }]);
            expect(lines).toEqual(['- [ ] task', '\t- other:: 1', '\t- k::']);
        });

        it('writes a new list as its line and its items a level under it', () => {
            const lines = ['- [ ] task', '    - other:: 1', ''];
            apply(lines, 0, [{ key: 'k', op: 'set', value: { items: ['a', '"12"'] } }]);
            expect(lines).toEqual(['- [ ] task', '    - other:: 1', '    - k::', '    \t- a', '    \t- "12"', '']);
        });

        it('writes a list over a value: the line says none, and the items go under it', () => {
            const lines = ['- [ ] task', '\t- k:: x', '\t- other:: 1'];
            apply(lines, 0, [{ key: 'k', op: 'set', value: { items: ['a', 'b'] } }]);
            expect(lines).toEqual(['- [ ] task', '\t- k::', '\t\t- a', '\t\t- b', '\t- other:: 1']);
        });

        it('rewrites a list\'s items one for one, keeping each bullet, and takes the ones past the new list out', () => {
            const lines = ['- [ ] task', '\t- k::', '\t\t* a', '\t\t- b', '\t\t- c', '\t- other:: 1'];
            const reported = apply(lines, 0, [{ key: 'k', op: 'set', value: { items: ['c', 'a'] } }]);
            // Reordered: the lines read in the new order.
            expect(lines).toEqual(['- [ ] task', '\t- k::', '\t\t* c', '\t\t- a', '\t- other:: 1']);
            expect(reported).toEqual([{ kind: 'removed', at: 4, count: 1 }, { kind: 'replaced', at: 2 }, { kind: 'replaced', at: 3 }]);
        });

        it('adds items past the last, spelled as it is', () => {
            const lines = ['- [ ] task', '  - k::', '    - a', '- [ ] next'];
            apply(lines, 0, [{ key: 'k', op: 'set', value: { items: ['a', 'b', 'c'] } }]);
            expect(lines).toEqual(['- [ ] task', '  - k::', '    - a', '    - b', '    - c', '- [ ] next']);
        });

        it('writes tags as items under a line that writes them as a list, and as `#a #b` on any other', () => {
            const list = ['- [ ] task', '\t- tags::', '\t\t- #a'];
            apply(list, 0, [{ key: 'tags', op: 'set', value: { tags: ['a', 'b'] } }]);
            expect(list).toEqual(['- [ ] task', '\t- tags::', '\t\t- #a', '\t\t- #b']);
            const none = ['- [ ] task'];
            apply(none, 0, [{ key: 'tags', op: 'set', value: { tags: ['a', 'b'] } }]);
            expect(none).toEqual(['- [ ] task', '\t- tags:: #a #b']);
        });
    });

    describe('a block the reading finds wrong is written over by no op', () => {
        const CASES: Array<[string, string[], string, number]> = [
            ['a key written twice, its case aside', ['- [ ] task', '\t- a:: 1', '\t- A:: 2'], 'a', 1],
            ['a line under a value', ['- [ ] task', '\t- k:: x', '\t\t- note'], 'k', 2],
            ['a task under a list\'s line', ['- [ ] task', '\t- k::', '\t\t- [ ] sub'], 'k', 2],
            ['an item nested in an item', ['- [ ] task', '\t- k::', '\t\t- a', '\t\t\t- deep'], 'k', 3],
            ['a built-in\'s value it cannot read', ['- [ ] task', '\t- tv-linestyle:: wavy'], 'tv-linestyle', 1],
        ];
        for (const [name, lines, key, line] of CASES) {
            it(name, () => {
                const before = [...lines];
                for (const op of [
                    { key, op: 'set', value: { text: 'v' } },
                    { key, op: 'set', value: { items: ['v'] } },
                    { key, op: 'hide' },
                    { key, op: 'delete' },
                ] as PropertyOp[]) {
                    expect(refusal(lines, 0, [op])).toEqual({ kind: 'property', key: expect.any(String), line });
                    expect(lines).toEqual(before);
                }
            });
        }

        it('writes the other keys of the task', () => {
            const lines = ['- [ ] task', '\t- a:: 1', '\t- A:: 2', '\t- b:: 3'];
            apply(lines, 0, [{ key: 'b', op: 'set', value: { text: '4' } }, { key: 'c', op: 'hide' }]);
            expect(lines).toEqual(['- [ ] task', '\t- a:: 1', '\t- A:: 2', '\t- b:: 4', '\t- c::']);
        });
    });

    describe('applyOps: insert (own プロパティ行なし)', () => {
        it('既存子行のインデント表現を踏襲する（スペース系ファイルで tab 混在させない）', () => {
            const lines = [
                '- [ ] task @2026-07-18T10:00',
                '    - [ ] sub',
            ];
            apply(lines, 0, [{ key: 'key2', op: 'set', value: { text: 'value2' } }]);
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
            apply(lines, 0, [{ key: 'key2', op: 'set', value: { text: 'value2' } }]);
            expect(lines[1]).toBe('\t- key2:: value2');
        });

        it('own プロパティ行があればその直後・同インデントに挿入する', () => {
            const lines = [
                '- [ ] task',
                '    - key ::',
                '    - [ ] sub',
            ];
            apply(lines, 0, [{ key: 'key2', op: 'set', value: { text: 'v2' } }]);
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
            expect(ownLines(lines, 0)).toEqual([]);
        });

        it('フェンス内の同名宣言を更新の対象にしない', () => {
            const lines = [
                '- [ ] task',
                '    ```md',
                '    - key:: 例',
                '    ```',
                '    - key:: 本物',
            ];
            apply(lines, 0, [{ key: 'key', op: 'set', value: { text: '新' } }]);
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
            apply(lines, 0, [{ key: 'key', op: 'set', value: { text: '新' } }]);
            // No item to copy: a new level, the unit handed in (a tab).
            expect(lines[1]).toBe('\t- key:: 新');
            expect(lines.slice(2)).toEqual([
                '    ```md',
                '    - key:: 例',
                '    ```',
            ]);
        });
    });

    /**
     * The lines a property edit touches are the lines the parser read the
     * task's properties from (`PropertyLines.ofTask`), for
     * every shape here: an edit of a line the parser does not read as the
     * task's writes where the index says nothing is.
     */
    describe('the parser and the writer read one set of own property lines', () => {
        const SHAPES: Array<[string, string[], Record<string, string>]> = [
            ['a fence under the task', ['- [ ] task', '    ```md', '    - key:: 例', '    ```', '    - key:: 本物'], { key: '本物' }],
            ['a tab-indented fence', ['- [ ] task', '\t```', '\t- key:: 例', '\t```', '\t- other:: 本物'], { other: '本物' }],
            ['a property under a note bullet', ['- [ ] task', '    - note', '        - deep:: of-note', '    - key:: own'], { key: 'own' }],
            ['a property under a child task', ['- [ ] task', '    - [ ] child', '        - deep:: of-child', '    - key:: own'], { key: 'own' }],
            // (Obsidian, `OutlineRead.test.ts` q4) eight columns in is the task's
            // paragraph going on, not an item: no property.
            ['a property line in the paragraph going on', ['- [ ] task', '        - key:: deep', '    - other:: own'], { other: 'own' }],
            ['a blank line between', ['- [ ] task', '    - [ ] child', '', '    - key:: own', ''], { key: 'own' }],
            ['a fence at column 0 that holds a property line', ['- [ ] task', '```', '- key:: 例', '```'], {}],
        ];

        for (const [name, lines, expected] of SHAPES) {
            it(name, () => {
                const parsed = FileParsePipeline.parse('note.md', [...lines], DEFAULT_SETTINGS, namesOutsideIndex('note.md'));
                if (parsed.ignored) throw new Error('ignored');
                const task = parsed.tasks.find(candidate => candidate.line === 0)!;
                const written = Object.fromEntries(
                    ownLines(lines, 0).map(line => [line.key, line.value]),
                );
                const read = Object.fromEntries(
                    Object.values(task.properties).map(({ key, value }) => [key, PropertyValues.spelling(value)]),
                );
                expect(read).toEqual(written);
                expect(written).toEqual(expected);
            });
        }
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
            const reported = apply(lines, 0, [{ key: '金額', op: 'set', value: { text: '200' } }]);
            expect(reported).toEqual([{ kind: 'replaced', at: 1 }]);
            expect(lines[1]).toBe('\t- 金額:: 200');
        });

        it('新規の宣言行は insert として申告する', () => {
            const lines = [
                '- [ ] task',
                '',
            ];
            const reported = apply(lines, 0, [{ key: '金額', op: 'set', value: { text: '200' } }]);
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

        it('takes a list\'s line and its items out as one removal', () => {
            const lines = [
                '- [ ] task',
                '\t- 金額::',
                '\t\t- 100',
                '\t\t- 300',
            ];
            const reported = apply(lines, 0, [{ key: '金額', op: 'delete' }]);
            expect(reported).toEqual([{ kind: 'removed', at: 1, count: 3 }]);
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
                { key: 'c', op: 'set', value: { text: '3' } },
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
            const reported = apply(lines, 0, [{ key: '金額', op: 'set', value: { text: '200' } }]);
            expect(reported).toEqual([{ kind: 'replaced', at: 1 }]);
            expect(lines[3]).toBe('\t- 金額:: 999');
        });
    });
});
