import { describe, it, expect } from 'vitest';
import { DocumentTreeBuilder } from '../../../../src/services/parsing/tree/DocumentTreeBuilder';
import { SectionPropertyResolver } from '../../../../src/services/parsing/tree/SectionPropertyResolver';
import { TreeTaskExtractor, type TaskExtractionContext } from '../../../../src/services/parsing/tree/TreeTaskExtractor';
import { TaskParser } from '../../../../src/services/parsing/TaskParser';
import { DEFAULT_SETTINGS, DEFAULT_TV_FILE_KEYS } from '../../../../src/types';
import {
    getEffectiveColor, getEffectiveLinestyle, getEffectiveMask,
    getEffectiveTags, getEffectiveProperties,
} from '../../../../src/services/data/EffectiveProperties';

const defaultCtx: TaskExtractionContext = {
    filePath: 'test.md',
    tvFileKeys: DEFAULT_TV_FILE_KEYS,
};

function extractTasks(bodyLines: string[], frontmatter?: Record<string, any>, ctx?: Partial<TaskExtractionContext>) {
    const doc = DocumentTreeBuilder.build('test.md', bodyLines, 0);
    SectionPropertyResolver.resolve(doc, frontmatter, DEFAULT_TV_FILE_KEYS);
    return TreeTaskExtractor.extract(doc, { ...defaultCtx, ...ctx });
}

describe('TreeTaskExtractor', () => {
    describe('基本的なタスク抽出', () => {
        it('単一タスクを抽出', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24',
            ]);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].content).toBe('task');
            expect(tasks[0].startDate).toBe('2026-03-24');
        });

        it('日付なしのチェックボックスも独立タスクになる', () => {
            const tasks = extractTasks([
                '- [ ] no date task',
            ]);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].content).toBe('no date task');
            expect(tasks[0].parentId).toBeUndefined();
        });

        it('時刻のみでもデイリーノートなら抽出', () => {
            const tasks = extractTasks([
                '- [ ] time only task @T09:00',
            ], { 'tv-start': '2026-03-24' });
            expect(tasks).toHaveLength(1);
            expect(tasks[0].cascadeContext?.startDate).toBe('2026-03-24');
        });

        it('複数タスクを抽出', () => {
            const tasks = extractTasks([
                '- [ ] task1 @2026-03-24',
                '- [ ] task2 @2026-03-25',
            ]);
            expect(tasks).toHaveLength(2);
        });
    });

    describe('子タスクと親子関係', () => {
        it('インデントされた子タスクの parentId が設定される', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [ ] child @2026-03-25',
            ]);
            expect(tasks).toHaveLength(2);
            const parent = tasks.find(t => t.content === 'parent')!;
            const child = tasks.find(t => t.content === 'child')!;
            expect(child.parentId).toBe(parent.id);
            expect(parent.childIds).toContain(child.id);
        });

        it('孫タスクの階層', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [ ] child @2026-03-25',
                '        - [ ] grandchild @2026-03-26',
            ]);
            expect(tasks).toHaveLength(3);
            const parent = tasks.find(t => t.content === 'parent')!;
            const child = tasks.find(t => t.content === 'child')!;
            const grandchild = tasks.find(t => t.content === 'grandchild')!;
            expect(child.parentId).toBe(parent.id);
            expect(grandchild.parentId).toBe(child.id);
        });
    });

    describe('子行プロパティと BuiltinPropertyExtractor', () => {
        it('子行の tv-color が task.color に反映される', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24',
                '    - tv-color:: 333333',
            ]);
            expect(tasks[0].color).toBe('333333');
            // properties に tv-color が入っていないこと
            expect(tasks[0].properties['tv-color']).toBeUndefined();
        });

        it('子行の tv-linestyle が task.linestyle に反映される', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24',
                '    - tv-linestyle:: dashed',
            ]);
            expect(tasks[0].linestyle).toBe('dashed');
        });

        it('子行のカスタムプロパティは properties に残る', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24',
                '    - note:: something',
                '    - priority:: 1',
            ]);
            expect(tasks[0].properties['note']).toEqual({ value: 'something', type: 'string' });
            expect(tasks[0].properties['priority']).toEqual({ value: '1', type: 'number' });
        });
    });

    describe('セクションプロパティの継承', () => {
        it('セクションの color は cascadeContext に置かれ raw を汚さない', () => {
            const tasks = extractTasks([
                '## Section',
                '- tv-color:: ff0000',
                '- [ ] task @2026-03-24',
            ]);
            expect(tasks[0].color).toBeUndefined();
            expect(tasks[0].cascadeContext?.color).toBe('ff0000');
            expect(getEffectiveColor(tasks[0])).toBe('ff0000');
        });

        it('タスクの子行 color がセクション color をオーバーライド', () => {
            const tasks = extractTasks([
                '## Section',
                '- tv-color:: ff0000',
                '- [ ] task @2026-03-24',
                '    - tv-color:: 00ff00',
            ]);
            expect(tasks[0].color).toBe('00ff00');
        });

        it('セクションのカスタムプロパティは cascadeContext 経由で継承される', () => {
            const tasks = extractTasks([
                '## Section',
                '- category:: work',
                '- [ ] task @2026-03-24',
            ]);
            expect(tasks[0].properties['category']).toBeUndefined();
            expect(tasks[0].cascadeContext?.properties?.['category']).toEqual({ value: 'work', type: 'string' });
            expect(getEffectiveProperties(tasks[0])['category']).toEqual({ value: 'work', type: 'string' });
        });

        it('タスクの子行プロパティがセクションプロパティをオーバーライド', () => {
            const tasks = extractTasks([
                '## Section',
                '- priority:: 1',
                '- [ ] task @2026-03-24',
                '    - priority:: 5',
            ]);
            expect(tasks[0].properties['priority']).toEqual({ value: '5', type: 'number' });
        });
    });

    describe('フルカスケード: frontmatter → section → task', () => {
        it('frontmatter → section → task のカスケード（child-wins）', () => {
            const tasks = extractTasks([
                '## Section',
                '- tv-linestyle:: dashed',
                '- [ ] task @2026-03-24',
                '    - tv-color:: 333333',
            ], { 'tv-color': 'red', 'tv-mask': '***' });

            const task = tasks[0];
            // 子行 > セクション > frontmatter（effective 合成後）
            expect(getEffectiveColor(task)).toBe('333333');      // 子行（最強）
            expect(getEffectiveLinestyle(task)).toBe('dashed');   // セクション
            expect(getEffectiveMask(task)).toBe('***');           // frontmatter（SectionPropertyResolver 経由）
            // raw には子行由来の color だけが残る
            expect(task.color).toBe('333333');
            expect(task.linestyle).toBeUndefined();
            expect(task.mask).toBeUndefined();
        });

        it('ネストセクションからのカスケード', () => {
            const tasks = extractTasks([
                '## Parent',
                '- tv-color:: red',
                '### Child',
                '- tv-linestyle:: dotted',
                '- [ ] task @2026-03-24',
            ]);

            const task = tasks[0];
            expect(getEffectiveColor(task)).toBe('red');          // 親セクションから継承
            expect(getEffectiveLinestyle(task)).toBe('dotted');   // 子セクション
            expect(task.color).toBeUndefined();                    // raw は空のまま
            expect(task.linestyle).toBeUndefined();
        });
    });

    describe('childLines の正しい処理', () => {
        it('子タスク行は childLines から除外される', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [ ] child @2026-03-25',
                '    - note:: parent-note',
            ]);
            const parent = tasks.find(t => t.content === 'parent')!;
            // childLines にはチェックボックス行ではなく note 行のみ
            expect(parent.childLines).toHaveLength(1);
            expect(parent.childLines[0].propertyKey).toBe('note');
        });

        it('日付なしチェックボックスの子 @notation タスクはその子になる', () => {
            const tasks = extractTasks([
                '- [ ] plainCheckBox',
                '    - [ ] inlineTask1 @2026-03-24',
            ]);
            expect(tasks).toHaveLength(2);
            const plain = tasks.find(t => t.content === 'plainCheckBox')!;
            const inline = tasks.find(t => t.content === 'inlineTask1')!;
            expect(inline.startDate).toBe('2026-03-24');
            expect(inline.parentId).toBe(plain.id);
            expect(plain.childIds).toEqual([inline.id]);
        });

        it('セクション色 + 子行オーバーライド + 子タスクの完全シナリオ', () => {
            const tasks = extractTasks([
                '## B: セクションで色を上書き',
                '- tv-color:: ff6b6b',
                '- customProp:: section-B',
                '- [ ] B1 セクション色 @T12:00>13:00',
                '- [ ] B2 同じく @T13:30>14:30',
                '- [ ] B3 子行で色を上書き @T15:00>16:00',
                '\t- tv-color:: 4ecdc4',
                '\t- [ ] B4 @T15:00>16:00',
            ]);

            const b1 = tasks.find(t => t.content.includes('B1'))!;
            const b2 = tasks.find(t => t.content.includes('B2'))!;
            const b3 = tasks.find(t => t.content.includes('B3'))!;
            const b4 = tasks.find(t => t.content.includes('B4'))!;

            // B1, B2: セクション色は cascade 経由（raw は空）
            expect(getEffectiveColor(b1)).toBe('ff6b6b');
            expect(getEffectiveColor(b2)).toBe('ff6b6b');
            expect(b1.color).toBeUndefined();

            // B3: 子行 tv-color がセクション色をオーバーライド（raw に載る）
            expect(b3.color).toBe('4ecdc4');
            expect(getEffectiveColor(b3)).toBe('4ecdc4');

            // B4: 親タスクの色は継承しない（タスク親子間継承は廃止、
            // 日付と同一原則）。セクション色にフォールバックする
            expect(b4.color).toBeUndefined();
            expect(getEffectiveColor(b4)).toBe('ff6b6b');

            // customProp が全タスクに cascade 経由で継承
            expect(getEffectiveProperties(b1)['customProp']).toEqual({ value: 'section-B', type: 'string' });
            expect(getEffectiveProperties(b3)['customProp']).toEqual({ value: 'section-B', type: 'string' });
            expect(b1.properties['customProp']).toBeUndefined();
        });

        it('日付なしの子チェックボックスは子タスクになり childLines に残らない', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [ ] plain checkbox',
                '    - note:: something',
            ]);
            expect(tasks).toHaveLength(2);
            const parent = tasks.find(t => t.content === 'parent')!;
            const plain = tasks.find(t => t.content === 'plain checkbox')!;
            expect(plain.parentId).toBe(parent.id);
            expect(parent.childLines).toHaveLength(1);
            expect(parent.childLines[0].propertyKey).toBe('note');
        });
    });

    describe('ブロック内の子行処理（チェックボックスは子タスク、それ以外は childLines）', () => {
        it('@notation なしの複数 - [x] はすべて子タスクになる', () => {
            const tasks = extractTasks([
                '- [x] 更新 @2026-03-25T12:34>15:20',
                '    - [x] mini-calendarの調整',
                '    - [x] スタイル修正',
                '    - [x] tv-colorの変更',
            ]);
            expect(tasks).toHaveLength(4);
            const parent = tasks[0];
            expect(parent.childLines).toHaveLength(0);
            expect(parent.childIds).toHaveLength(3);
            expect(tasks.slice(1).map(t => t.statusChar)).toEqual(['x', 'x', 'x']);
            expect(tasks.slice(1).every(t => t.parentId === parent.id)).toBe(true);
        });

        it('@notation あり/なし混在: どちらも子タスクになりファイル順に並ぶ', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [x] plain checkbox',
                '    - [ ] child task @2026-03-25',
            ]);
            expect(tasks).toHaveLength(3);
            const parent = tasks.find(t => t.content === 'parent')!;
            const plain = tasks.find(t => t.content === 'plain checkbox')!;
            const child = tasks.find(t => t.content === 'child task')!;
            expect(parent.childLines).toHaveLength(0);
            expect(parent.childIds).toEqual([plain.id, child.id]);
        });

        it('説明行とチェックボックスとプロパティの混在', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    説明テキスト',
                '    - [x] done item',
                '    - priority:: high',
            ]);
            const parent = tasks.find(t => t.content === 'parent')!;
            const done = tasks.find(t => t.content === 'done item')!;
            expect(done.parentId).toBe(parent.id);
            // childLines はチェックボックスでない行だけ（順序は保持）
            expect(parent.childLines).toHaveLength(2);
            expect(parent.childLines[0].checkboxChar).toBeNull();
            expect(parent.childLines[0].text).toContain('説明テキスト');
            expect(parent.childLines[1].propertyKey).toBe('priority');
        });

        it('日付なしのラッパーも子タスクになり、孫はラッパーの子になる', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [x] wrapper without notation',
                '        - [ ] grandchild @2026-03-26',
            ]);
            expect(tasks).toHaveLength(3);
            const parent = tasks.find(t => t.content === 'parent')!;
            const wrapper = tasks.find(t => t.content === 'wrapper without notation')!;
            const grandchild = tasks.find(t => t.content === 'grandchild')!;
            expect(wrapper.parentId).toBe(parent.id);
            expect(grandchild.parentId).toBe(wrapper.id);
            expect(parent.childIds).toEqual([wrapper.id]);
            expect(parent.childLines).toHaveLength(0);
        });
    });

    describe('ChildLine.bodyLine（絶対行番号）', () => {
        it('連続する childLines の絶対行番号が正しい', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',    // line 0
                '    child line 1',             // line 1
                '    child line 2',             // line 2
            ]);
            const parent = tasks[0];
            expect(parent.childLines.map(c => c.bodyLine)).toEqual([1, 2]);
        });

        it('子タスクを挟む場合に正しい行番号が設定される', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',    // line 0
                '    desc line 1',              // line 1
                '    - [ ] child @2026-03-25',  // line 2 (excluded)
                '        child desc',           // line 3 (excluded)
                '    desc line 2',              // line 4
            ]);
            const parent = tasks.find(t => t.content === 'parent')!;
            expect(parent.childLines).toHaveLength(2);
            expect(parent.childLines.map(c => c.bodyLine)).toEqual([1, 4]);
        });

        it('@notation なしチェックボックスは子タスクとして自分の行番号を持つ', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',    // line 0
                '    - [x] item A',             // line 1
                '    - [x] item B',             // line 2
                '    - [x] item C',             // line 3
            ]);
            expect(tasks.slice(1).map(t => t.line)).toEqual([1, 2, 3]);
            expect(tasks[0].childLines).toHaveLength(0);
        });
    });

    describe('リストマーカーバリエーション', () => {
        it('* マーカーのチェックボックスも子タスクになる', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    * [x] asterisk item',
            ]);
            expect(tasks).toHaveLength(2);
            expect(tasks[0].childLines).toHaveLength(0);
            expect(tasks[1].statusChar).toBe('x');
            expect(tasks[1].parentId).toBe(tasks[0].id);
        });

        it('+ マーカーのチェックボックスも子タスクになる', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    + [x] plus item',
            ]);
            expect(tasks).toHaveLength(2);
            expect(tasks[0].childLines).toHaveLength(0);
            expect(tasks[1].statusChar).toBe('x');
            expect(tasks[1].parentId).toBe(tasks[0].id);
        });

        it('1. 番号付きチェックボックスも子タスクになる', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    1. [x] ordered dot item',
            ]);
            expect(tasks).toHaveLength(2);
            expect(tasks[0].childLines).toHaveLength(0);
            expect(tasks[1].statusChar).toBe('x');
            expect(tasks[1].parentId).toBe(tasks[0].id);
        });

        it('1) 番号付きチェックボックスも子タスクになる', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    1) [x] ordered paren item',
            ]);
            expect(tasks).toHaveLength(2);
            expect(tasks[0].childLines).toHaveLength(0);
            expect(tasks[1].statusChar).toBe('x');
            expect(tasks[1].parentId).toBe(tasks[0].id);
        });

        it('異なるマーカーが混在しても全て子タスクになる', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [x] dash item',
                '    * [x] asterisk item',
                '    + [ ] plus item',
                '    1. [x] ordered item',
            ]);
            expect(tasks).toHaveLength(5);
            const parent = tasks[0];
            expect(parent.childLines).toHaveLength(0);
            expect(parent.childIds).toHaveLength(4);
            expect(tasks.slice(1).map(t => t.statusChar)).toEqual(['x', 'x', ' ', 'x']);
        });

        it('各種ステータス文字が正しく取得される', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [ ] open',
                '    - [x] done',
                '    - [/] in-progress',
                '    - [-] cancelled',
                '    - [>] forwarded',
            ]);
            expect(tasks.slice(1).map(t => t.statusChar)).toEqual([' ', 'x', '/', '-', '>']);
            expect(tasks[0].childLines).toHaveLength(0);
        });

        it('* マーカー + @notation はタスクとして抽出される', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    * [ ] child task @2026-03-25',
            ]);
            expect(tasks).toHaveLength(2);
            const parent = tasks.find(t => t.content === 'parent')!;
            expect(parent.childLines).toHaveLength(0);
            expect(parent.childIds).toHaveLength(1);
        });

        it('プレーンテキストとチェックボックスなし箇条書き', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    plain text without marker',
                '    - plain bullet no checkbox',
            ]);
            const cl = tasks[0].childLines;
            expect(cl).toHaveLength(2);
            expect(cl[0].checkboxChar).toBeNull();
            expect(cl[0].text).toContain('plain text');
            expect(cl[1].checkboxChar).toBeNull();
            expect(cl[1].text).toContain('plain bullet');
        });
    });

    describe('タグのカスケードマージ', () => {
        it('content タグのみ（従来動作）', () => {
            const tasks = extractTasks([
                '- [ ] task #inline @2026-03-24',
            ]);
            expect(tasks[0].tags).toEqual(['inline']);
        });

        it('プロパティ行タグが task.tags にマージされる', () => {
            const tasks = extractTasks([
                '- [ ] task #inline @2026-03-24',
                '    - tags:: #propTag',
            ]);
            expect(tasks[0].tags).toEqual(['inline', 'propTag']);
        });

        it('frontmatter tags がインラインタスクに cascade 経由でカスケード', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24',
            ], { tags: ['project'] });
            expect(tasks[0].tags).toEqual([]);
            expect(tasks[0].cascadeContext?.tags).toEqual(['project']);
            expect(getEffectiveTags(tasks[0])).toEqual(['project']);
        });

        it('セクション property block tags がタスクに cascade 経由でカスケード', () => {
            const tasks = extractTasks([
                '## Section',
                '- tags:: #sectionTag',
                '- [ ] task @2026-03-24',
            ]);
            expect(tasks[0].tags).toEqual([]);
            expect(getEffectiveTags(tasks[0])).toEqual(['sectionTag']);
        });

        it('3段マージ: frontmatter + section + content tags', () => {
            const tasks = extractTasks([
                '## Section',
                '- tags:: #sectionTag',
                '- [ ] task #inline @2026-03-24',
            ], { tags: ['project'] });
            expect(tasks[0].tags).toEqual(['inline']);
            expect(tasks[0].cascadeContext?.tags).toEqual(['project', 'sectionTag']);
            expect(getEffectiveTags(tasks[0])).toEqual(['inline', 'project', 'sectionTag']);
        });

        it('全レベルマージ: frontmatter + section + property line + content', () => {
            const tasks = extractTasks([
                '## Section',
                '- tags:: #sectionTag',
                '- [ ] task #inline @2026-03-24',
                '    - tags:: #propTag',
            ], { tags: ['project'] });
            expect(tasks[0].tags).toEqual(['inline', 'propTag']);
            expect(getEffectiveTags(tasks[0])).toEqual(['inline', 'project', 'propTag', 'sectionTag']);
        });

        it('重複タグは dedup される', () => {
            const tasks = extractTasks([
                '## Section',
                '- tags:: #shared',
                '- [ ] task #shared @2026-03-24',
            ], { tags: ['shared'] });
            expect(tasks[0].tags).toEqual(['shared']);
            expect(getEffectiveTags(tasks[0])).toEqual(['shared']);
        });

        it('プロパティ行 tags は task.properties に漏れない', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24',
                '    - tags:: #propTag',
            ]);
            expect(tasks[0].tags).toContain('propTag');
            expect(tasks[0].properties['tags']).toBeUndefined();
        });

        it('3段ネストで孫セクションのタグが兄弟セクションに漏れない', () => {
            const tasks = extractTasks([
                '## Expenses',
                '### EPOS',
                '#### 特殊',
                '- tags:: #出/クレカ/EPOS',
                '- [ ] epos-task @2026-03-24',
                '### りそな',
                '- tags:: #出/りそな',
                '- [ ] risona-task @2026-03-25',
            ]);
            const eposTask = tasks.find(t => t.content === 'epos-task')!;
            const risonaTask = tasks.find(t => t.content === 'risona-task')!;
            expect(getEffectiveTags(eposTask)).toEqual(['出/クレカ/EPOS']);
            expect(getEffectiveTags(risonaTask)).toEqual(['出/りそな']);
        });
    });

    describe('裸チェックボックス（日付もコマンドも持たない）', () => {
        // TVInlineParser uses '' (empty string) as the no-date sentinel for
        // startDate; other date fields stay undefined when absent.
        it('トップレベルの裸チェックボックスは親なしの独立タスク', () => {
            const tasks = extractTasks([
                '- [ ] やりたいこと',
            ]);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].parserId).toBe('tv-inline');
            expect(tasks[0].content).toBe('やりたいこと');
            expect(tasks[0].startDate).toBe('');
            expect(tasks[0].endDate).toBeUndefined();
            expect(tasks[0].due).toBeUndefined();
            expect(tasks[0].parentId).toBeUndefined();
        });

        it('タスク直下の裸チェックボックスはそのタスクの子', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [ ] 子手順',
            ]);
            const parent = tasks.find(t => t.content === 'parent')!;
            const step = tasks.find(t => t.content === '子手順')!;
            expect(step.parentId).toBe(parent.id);
            expect(parent.childIds).toEqual([step.id]);
            expect(parent.childLines).toHaveLength(0);
        });

        it('トップレベルの非タスク行の下の裸チェックボックスは親なしの独立タスク', () => {
            const tasks = extractTasks([
                '- メモ',
                '    - [ ] ついでにやる',
            ]);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].content).toBe('ついでにやる');
            expect(tasks[0].parentId).toBeUndefined();
        });

        // タスクの部分木の中なら、間に非タスク行を挟んでも部分木の所有者の子。
        // 行は親の childRawLines の中にあり、親を動かせば一緒に動く。
        it('タスクの部分木の中で非タスク行の下にある裸チェックボックスは、部分木の所有者の子', () => {
            const tasks = extractTasks([
                '- [ ] P',
                '    - メモ',
                '        - [ ] x',
            ]);
            const p = tasks.find(t => t.content === 'P')!;
            const x = tasks.find(t => t.content === 'x')!;
            expect(x.parentId).toBe(p.id);
            expect(p.childIds).toEqual([x.id]);
            expect(p.childLines.map(c => c.text.trim())).toEqual(['- メモ']);
        });

        it('frontmatter の日付を持つノートでは、裸チェックボックスが全部その日付を継承し、ノート自身のタスクは無い', () => {
            const tasks = extractTasks([
                '- [ ] 一',
                '- [ ] 二',
                '    - [ ] 二の子',
                '- [ ] 三',
            ], { 'tv-start': '2026-03-24' });
            expect(tasks.map(t => t.content)).toEqual(['一', '二', '二の子', '三']);
            expect(tasks.every(t => t.cascadeContext?.startDate === '2026-03-24')).toBe(true);
            expect(tasks.every(t => t.parserId === 'tv-inline')).toBe(true);
        });
    });

    describe('親子は直上のブロックだけ（インデント幅に依らない）', () => {
        const nested = (unit: string) => [
            '- [ ] a',
            `${unit}- [ ] b`,
            `${unit}${unit}- [ ] c`,
        ];

        for (const [label, unit] of [['1スペース', ' '], ['2スペース', '  '], ['4スペース', '    '], ['8スペース', '        '], ['タブ', '\t']] as const) {
            it(`${label}の3段ネストで、孫は子だけの子（祖父に二重登録されない）`, () => {
                const tasks = extractTasks(nested(unit));
                const [a, b, c] = ['a', 'b', 'c'].map(n => tasks.find(t => t.content === n)!);
                expect(b.parentId).toBe(a.id);
                expect(c.parentId).toBe(b.id);
                expect(a.childIds).toEqual([b.id]);
                expect(b.childIds).toEqual([c.id]);
                expect(c.childIds).toEqual([]);
            });
        }

        it('兄弟のインデント幅が揃っていなくても、直下ブロックはすべて子', () => {
            const tasks = extractTasks([
                '- [ ] a',
                '  - [ ] b1',
                '    - [ ] b1の子',
                '  - [ ] b2',
            ]);
            const a = tasks.find(t => t.content === 'a')!;
            const b1 = tasks.find(t => t.content === 'b1')!;
            const b2 = tasks.find(t => t.content === 'b2')!;
            const deep = tasks.find(t => t.content === 'b1の子')!;
            expect(a.childIds).toEqual([b1.id, b2.id]);
            expect(deep.parentId).toBe(b1.id);
        });
    });

    describe('フロー子行 (`- ==>`) の merge', () => {
        it('タスク行 + 子行 segment を joined でパースし program が成立する', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24 ==> every mon',
                '    - ==> setDue(start + 3d)',
                '    - ==> x3',
            ]);
            expect(tasks).toHaveLength(1);
            const flow = tasks[0].flow!;
            expect(flow.raw).toBe('every mon');
            expect(flow.childSegments.map(s => s.raw)).toEqual(['setDue(start + 3d)', 'x3']);
            expect(flow.childSegments.map(s => s.bodyLine)).toEqual([1, 2]);
            expect(flow.program?.lifetime).toMatchObject({ count: 3 });
            expect(Object.keys(flow.program?.sets ?? {})).toEqual(['due']);
            expect(tasks[0].validation).toBeUndefined();
        });

        it('flow 行は childLines から除外される', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24 ==> every mon',
                '    - ==> x3',
                '    - plain note',
            ]);
            expect(tasks[0].childLines.map(cl => cl.text.trim())).toEqual(['- plain note']);
            expect(tasks[0].childLines.map(cl => cl.bodyLine)).toEqual([2]);
        });

        it('子行だけに flow を書いた bare checkbox はタスクに昇格する', () => {
            const tasks = extractTasks([
                '- [ ] promoted',
                '    - ==> every mon',
            ]);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].content).toBe('promoted');
            expect(tasks[0].flow?.raw).toBe('');
            expect(tasks[0].flow?.program?.schedule?.kind).toBe('every');
        });

        it('昇格した子タスクは親の childLines に残らない（二重表出しない）', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [ ] promoted child',
                '        - ==> every mon',
            ]);
            expect(tasks).toHaveLength(2);
            const parent = tasks.find(t => t.content === 'parent')!;
            const child = tasks.find(t => t.content === 'promoted child')!;
            expect(child.parentId).toBe(parent.id);
            expect(child.flow?.program?.schedule?.kind).toBe('every');
            expect(parent.childLines).toHaveLength(0);
        });

        it('孫の flow 行を親が奪わない', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24 ==> every mon',
                '    - [ ] child @2026-03-25',
                '        - ==> every tue',
            ]);
            const parent = tasks.find(t => t.content === 'parent')!;
            const child = tasks.find(t => t.content === 'child')!;
            expect(parent.flow?.childSegments).toEqual([]);
            expect(parent.flow?.program?.schedule).toMatchObject({ rule: { days: [1] } });
            expect(child.flow?.childSegments.map(s => s.raw)).toEqual(['every tue']);
            expect(child.flow?.program?.schedule).toMatchObject({ rule: { days: [2] } });
        });

        it('タスク行単体の orphan-modifier が joined で解消され validation もクリアされる', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24 ==> x3',
                '    - ==> every mon',
            ]);
            expect(tasks[0].flow?.program).not.toBeNull();
            expect(tasks[0].validation).toBeUndefined();
        });

        it('segment 境界をまたぐノードは validation エラーになる', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24 ==> every',
                '    - ==> mon',
            ]);
            expect(tasks[0].flow?.program).toBeNull();
            expect(tasks[0].validation?.rule).toBe('flow.node-spans-lines');
        });

        it('非 tv-inline タスクの `- ==>` 子行は通常の childLine のまま', () => {
            TaskParser.withChain({ ...DEFAULT_SETTINGS, enableDayPlanner: true }, () => {
                const tasks = extractTasks([
                    '- [ ] 09:00 - 10:00 dp task',
                    '    - ==> every mon',
                ], { 'tv-start': '2026-03-24' });
                expect(tasks).toHaveLength(1);
                expect(tasks[0].parserId).toBe('day-planner');
                expect(tasks[0].flow).toBeUndefined();
                expect(tasks[0].childLines.map(cl => cl.text.trim())).toEqual(['- ==> every mon']);
            });
        });
    });

    describe('コードフェンス内の記法', () => {
        it('fence 内の `- ==>` はコマンドにならない', () => {
            const tasks = extractTasks([
                '- [ ] 手順メモ @2026-08-20',
                '    ```markdown',
                '    - ==> every 1d',
                '    ```',
            ]);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].flow).toBeUndefined();
        });

        it('fence 内の行は childLines に残る（カードのコードブロックが壊れない）', () => {
            const tasks = extractTasks([
                '- [ ] 手順メモ @2026-08-20',
                '    ```markdown',
                '    - ==> every 1d',
                '    ```',
            ]);
            expect(tasks[0].childLines.map(cl => cl.text.trim())).toEqual([
                '```markdown',
                '- ==> every 1d',
                '```',
            ]);
        });

        it('fence 内の `- ==>` はコマンドにならず、日付なし checkbox はフローを持たないタスクのまま', () => {
            const tasks = extractTasks([
                '- [ ] ただのメモ',
                '    ```markdown',
                '    - ==> every 1d',
                '    ```',
            ]);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].flow?.program).toBeFalsy();
            expect(tasks[0].childLines.some(c => c.text.includes('==> every 1d'))).toBe(true);
        });

        it('fence 内の checkbox はタスクにならない（既存 baseline）', () => {
            const tasks = extractTasks([
                '- [ ] 手順メモ @2026-08-20',
                '    ```markdown',
                '    - [ ] fenced @2026-08-21',
                '    ```',
            ]);
            expect(tasks.map(t => t.content)).toEqual(['手順メモ']);
        });

        it('fence が閉じた後の `- ==>` は通常どおりコマンドになる', () => {
            const tasks = extractTasks([
                '- [ ] 手順メモ @2026-08-20',
                '    ```markdown',
                '    - ==> every 1d',
                '    ```',
                '    - ==> every mon',
            ]);
            expect(tasks[0].flow?.program).not.toBeNull();
            expect(tasks[0].flow?.childSegments.map(s => s.raw)).toEqual(['every mon']);
        });

        it('~~~ fence でも同じ', () => {
            const tasks = extractTasks([
                '- [ ] 手順メモ @2026-08-20',
                '    ~~~',
                '    - ==> every 1d',
                '    ~~~',
            ]);
            expect(tasks[0].flow).toBeUndefined();
        });

        it('ドキュメント先頭からの fence 内も無視する', () => {
            const tasks = extractTasks([
                '```markdown',
                '- [ ] 例 @2026-08-20',
                '    - ==> every 1d',
                '```',
            ]);
            expect(tasks).toHaveLength(0);
        });
    });
});
