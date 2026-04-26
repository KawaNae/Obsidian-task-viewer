import { describe, it, expect } from 'vitest';
import { DocumentTreeBuilder } from '../../../../src/services/parsing/tree/DocumentTreeBuilder';
import { SectionPropertyResolver } from '../../../../src/services/parsing/tree/SectionPropertyResolver';
import { TreeTaskExtractor, type TaskExtractionContext } from '../../../../src/services/parsing/tree/TreeTaskExtractor';
import { DEFAULT_FRONTMATTER_TASK_KEYS } from '../../../../src/types';

const defaultCtx: TaskExtractionContext = {
    filePath: 'test.md',
    hasFrontmatterParent: false,
    frontmatterTaskKeys: DEFAULT_FRONTMATTER_TASK_KEYS,
};

function extractTasks(bodyLines: string[], frontmatter?: Record<string, any>, ctx?: Partial<TaskExtractionContext>) {
    const doc = DocumentTreeBuilder.build('test.md', bodyLines, 0);
    SectionPropertyResolver.resolve(doc, frontmatter, DEFAULT_FRONTMATTER_TASK_KEYS);
    return TreeTaskExtractor.extract(doc, { ...defaultCtx, ...ctx });
}

describe('TreeTaskExtractor', () => {
    describe('基本的なタスク抽出', () => {
        it('単一タスクを抽出', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks).toHaveLength(1);
            expect(tasks[0].content).toBe('task');
            expect(tasks[0].startDate).toBe('2026-03-24');
        });

        it('日付なしタスクはデイリーノート/FM親なしで無視', () => {
            const tasks = extractTasks([
                '- [ ] no date task',
            ]);
            expect(tasks).toHaveLength(0);
        });

        it('時刻のみでもデイリーノートなら抽出', () => {
            const tasks = extractTasks([
                '- [ ] time only task @T09:00',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks).toHaveLength(1);
            expect(tasks[0].startDate).toBe('2026-03-24');
        });

        it('複数タスクを抽出', () => {
            const tasks = extractTasks([
                '- [ ] task1 @2026-03-24',
                '- [ ] task2 @2026-03-25',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks).toHaveLength(2);
        });
    });

    describe('子タスクと親子関係', () => {
        it('インデントされた子タスクの parentId が設定される', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [ ] child @2026-03-25',
            ], undefined, { dailyNoteDate: '2026-03-24' });
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
            ], undefined, { dailyNoteDate: '2026-03-24' });
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
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].color).toBe('333333');
            // properties に tv-color が入っていないこと
            expect(tasks[0].properties['tv-color']).toBeUndefined();
        });

        it('子行の tv-linestyle が task.linestyle に反映される', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24',
                '    - tv-linestyle:: dashed',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].linestyle).toBe('dashed');
        });

        it('子行のカスタムプロパティは properties に残る', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24',
                '    - note:: something',
                '    - priority:: 1',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].properties['note']).toEqual({ value: 'something', type: 'string' });
            expect(tasks[0].properties['priority']).toEqual({ value: '1', type: 'number' });
        });
    });

    describe('セクションプロパティの継承', () => {
        it('セクションの color が直接 color に設定される', () => {
            const tasks = extractTasks([
                '## Section',
                '- tv-color:: ff0000',
                '- [ ] task @2026-03-24',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].color).toBe('ff0000');
        });

        it('タスクの子行 color がセクション color をオーバーライド', () => {
            const tasks = extractTasks([
                '## Section',
                '- tv-color:: ff0000',
                '- [ ] task @2026-03-24',
                '    - tv-color:: 00ff00',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].color).toBe('00ff00');
        });

        it('セクションのカスタムプロパティがタスクに継承される', () => {
            const tasks = extractTasks([
                '## Section',
                '- category:: work',
                '- [ ] task @2026-03-24',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].properties['category']).toEqual({ value: 'work', type: 'string' });
        });

        it('タスクの子行プロパティがセクションプロパティをオーバーライド', () => {
            const tasks = extractTasks([
                '## Section',
                '- priority:: 1',
                '- [ ] task @2026-03-24',
                '    - priority:: 5',
            ], undefined, { dailyNoteDate: '2026-03-24' });
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
            ], { 'tv-color': 'red', 'tv-mask': '***' }, { dailyNoteDate: '2026-03-24' });

            const task = tasks[0];
            // 子行 > セクション > frontmatter
            expect(task.color).toBe('333333');      // 子行（最強）
            expect(task.linestyle).toBe('dashed');   // セクション
            expect(task.mask).toBe('***');           // frontmatter（SectionPropertyResolver 経由）
        });

        it('ネストセクションからのカスケード', () => {
            const tasks = extractTasks([
                '## Parent',
                '- tv-color:: red',
                '### Child',
                '- tv-linestyle:: dotted',
                '- [ ] task @2026-03-24',
            ], undefined, { dailyNoteDate: '2026-03-24' });

            const task = tasks[0];
            expect(task.color).toBe('red');          // 親セクションから継承
            expect(task.linestyle).toBe('dotted');   // 子セクション
        });
    });

    describe('childLines の正しい処理', () => {
        it('子タスク行は childLines から除外される', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [ ] child @2026-03-25',
                '    - note:: parent-note',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            const parent = tasks.find(t => t.content === 'parent')!;
            // childLines にはチェックボックス行ではなく note 行のみ
            expect(parent.childLines).toHaveLength(1);
            expect(parent.childLines[0].propertyKey).toBe('note');
        });

        it('プレーンチェックボックスの子 @notation タスクはパースされる', () => {
            const tasks = extractTasks([
                '- [ ] plainCheckBox',
                '    - [ ] inlineTask1 @2026-03-24',
            ]);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].content).toBe('inlineTask1');
            expect(tasks[0].startDate).toBe('2026-03-24');
            expect(tasks[0].parentId).toBeUndefined();
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
            ], undefined, { dailyNoteDate: '2026-03-24' });

            const b1 = tasks.find(t => t.content.includes('B1'))!;
            const b2 = tasks.find(t => t.content.includes('B2'))!;
            const b3 = tasks.find(t => t.content.includes('B3'))!;
            const b4 = tasks.find(t => t.content.includes('B4'))!;

            // B1, B2: セクション色が直接 color に設定
            expect(b1.color).toBe('ff6b6b');
            expect(b2.color).toBe('ff6b6b');

            // B3: 子行 tv-color がセクション色をオーバーライド
            expect(b3.color).toBe('4ecdc4');

            // B4: 親ブロック B3 の effective color を継承
            expect(b4.color).toBe('4ecdc4');

            // customProp が全タスクに継承
            expect(b1.properties['customProp']).toEqual({ value: 'section-B', type: 'string' });
            expect(b3.properties['customProp']).toEqual({ value: 'section-B', type: 'string' });
        });

        it('プレーンチェックボックスは childLines に残る', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [ ] plain checkbox',
                '    - note:: something',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            const parent = tasks[0];
            expect(parent.childLines).toHaveLength(2);
            expect(parent.childLines[0].checkboxChar).toBe(' ');
            expect(parent.childLines[0].text).toContain('plain checkbox');
            expect(parent.childLines[1].propertyKey).toBe('note');
        });
    });

    describe('ブロック内の子行処理（@notation なし - [x] の保持）', () => {
        it('@notation なしの複数 - [x] が全て childLines に残る', () => {
            const tasks = extractTasks([
                '- [x] 更新 @2026-03-25T12:34>15:20',
                '    - [x] mini-calendarの調整',
                '    - [x] スタイル修正',
                '    - [x] tv-colorの変更',
            ], undefined, { dailyNoteDate: '2026-03-25' });
            expect(tasks).toHaveLength(1);
            const parent = tasks[0];
            expect(parent.childLines).toHaveLength(3);
            expect(parent.childLines[0].checkboxChar).toBe('x');
            expect(parent.childLines[1].checkboxChar).toBe('x');
            expect(parent.childLines[2].checkboxChar).toBe('x');
        });

        it('@notation あり/なし混在: タスクと childLines が正しく分離される', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [x] plain checkbox',
                '    - [ ] child task @2026-03-25',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks).toHaveLength(2);
            const parent = tasks.find(t => t.content === 'parent')!;
            const child = tasks.find(t => t.content === 'child task')!;
            // plain checkbox は childLines に残る
            expect(parent.childLines).toHaveLength(1);
            expect(parent.childLines[0].checkboxChar).toBe('x');
            // child task は childIds に入る
            expect(parent.childIds).toContain(child.id);
        });

        it('説明行とチェックボックスとプロパティの混在', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    説明テキスト',
                '    - [x] done item',
                '    - priority:: high',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            const parent = tasks[0];
            expect(parent.childLines).toHaveLength(3);
            // 順序が保持される
            expect(parent.childLines[0].checkboxChar).toBeNull();
            expect(parent.childLines[0].text).toContain('説明テキスト');
            expect(parent.childLines[1].checkboxChar).toBe('x');
            expect(parent.childLines[2].propertyKey).toBe('priority');
        });

        it('非タスクラッパー内の孫タスクが抽出される', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [x] wrapper without notation',
                '        - [ ] grandchild @2026-03-26',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            // parent + grandchild（wrapper はタスクにならない）
            expect(tasks).toHaveLength(2);
            const parent = tasks.find(t => t.content === 'parent')!;
            const grandchild = tasks.find(t => t.content === 'grandchild')!;
            expect(grandchild).toBeDefined();
            // wrapper は parent の childLines に残る
            expect(parent.childLines.some(cl => cl.text.includes('wrapper'))).toBe(true);
        });
    });

    describe('childLineBodyOffsets', () => {
        it('連続する childLines の絶対行番号が正しい', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',    // line 0
                '    child line 1',             // line 1
                '    child line 2',             // line 2
            ], undefined, { dailyNoteDate: '2026-03-24' });
            const parent = tasks[0];
            expect(parent.childLineBodyOffsets).toEqual([1, 2]);
        });

        it('子タスクを挟む場合に正しいオフセットが設定される', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',    // line 0
                '    desc line 1',              // line 1
                '    - [ ] child @2026-03-25',  // line 2 (excluded)
                '        child desc',           // line 3 (excluded)
                '    desc line 2',              // line 4
            ], undefined, { dailyNoteDate: '2026-03-24' });
            const parent = tasks.find(t => t.content === 'parent')!;
            expect(parent.childLines).toHaveLength(2);
            expect(parent.childLineBodyOffsets).toEqual([1, 4]);
        });

        it('@notation なしチェックボックスのオフセットが正しい', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',    // line 0
                '    - [x] item A',             // line 1
                '    - [x] item B',             // line 2
                '    - [x] item C',             // line 3
            ], undefined, { dailyNoteDate: '2026-03-24' });
            const parent = tasks[0];
            expect(parent.childLineBodyOffsets).toEqual([1, 2, 3]);
        });
    });

    describe('リストマーカーバリエーション', () => {
        it('* マーカーのチェックボックスが childLines に残る', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    * [x] asterisk item',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks).toHaveLength(1);
            expect(tasks[0].childLines).toHaveLength(1);
            expect(tasks[0].childLines[0].checkboxChar).toBe('x');
        });

        it('+ マーカーのチェックボックスが childLines に残る', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    + [x] plus item',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks).toHaveLength(1);
            expect(tasks[0].childLines).toHaveLength(1);
            expect(tasks[0].childLines[0].checkboxChar).toBe('x');
        });

        it('1. 番号付きチェックボックスが childLines に残る', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    1. [x] ordered dot item',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks).toHaveLength(1);
            expect(tasks[0].childLines).toHaveLength(1);
            expect(tasks[0].childLines[0].checkboxChar).toBe('x');
        });

        it('1) 番号付きチェックボックスが childLines に残る', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    1) [x] ordered paren item',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks).toHaveLength(1);
            expect(tasks[0].childLines).toHaveLength(1);
            expect(tasks[0].childLines[0].checkboxChar).toBe('x');
        });

        it('異なるマーカーが混在しても全て childLines に残る', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [x] dash item',
                '    * [x] asterisk item',
                '    + [ ] plus item',
                '    1. [x] ordered item',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks).toHaveLength(1);
            const parent = tasks[0];
            expect(parent.childLines).toHaveLength(4);
            expect(parent.childLines[0].checkboxChar).toBe('x');
            expect(parent.childLines[1].checkboxChar).toBe('x');
            expect(parent.childLines[2].checkboxChar).toBe(' ');
            expect(parent.childLines[3].checkboxChar).toBe('x');
        });

        it('各種ステータス文字が正しく取得される', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [ ] open',
                '    - [x] done',
                '    - [/] in-progress',
                '    - [-] cancelled',
                '    - [>] forwarded',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            const cl = tasks[0].childLines;
            expect(cl).toHaveLength(5);
            expect(cl.map(c => c.checkboxChar)).toEqual([' ', 'x', '/', '-', '>']);
        });

        it('* マーカー + @notation はタスクとして抽出される', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    * [ ] child task @2026-03-25',
            ], undefined, { dailyNoteDate: '2026-03-24' });
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
            ], undefined, { dailyNoteDate: '2026-03-24' });
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
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].tags).toEqual(['inline']);
        });

        it('プロパティ行タグが task.tags にマージされる', () => {
            const tasks = extractTasks([
                '- [ ] task #inline @2026-03-24',
                '    - tags:: #propTag',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].tags).toEqual(['inline', 'propTag']);
        });

        it('frontmatter tags がインラインタスクにカスケード', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24',
            ], { tags: ['project'] }, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].tags).toEqual(['project']);
        });

        it('セクション property block tags がタスクにカスケード', () => {
            const tasks = extractTasks([
                '## Section',
                '- tags:: #sectionTag',
                '- [ ] task @2026-03-24',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].tags).toEqual(['sectionTag']);
        });

        it('3段マージ: frontmatter + section + content tags', () => {
            const tasks = extractTasks([
                '## Section',
                '- tags:: #sectionTag',
                '- [ ] task #inline @2026-03-24',
            ], { tags: ['project'] }, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].tags).toEqual(['inline', 'project', 'sectionTag']);
        });

        it('全レベルマージ: frontmatter + section + property line + content', () => {
            const tasks = extractTasks([
                '## Section',
                '- tags:: #sectionTag',
                '- [ ] task #inline @2026-03-24',
                '    - tags:: #propTag',
            ], { tags: ['project'] }, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].tags).toEqual(['inline', 'project', 'propTag', 'sectionTag']);
        });

        it('重複タグは dedup される', () => {
            const tasks = extractTasks([
                '## Section',
                '- tags:: #shared',
                '- [ ] task #shared @2026-03-24',
            ], { tags: ['shared'] }, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].tags).toEqual(['shared']);
        });

        it('プロパティ行 tags は task.properties に漏れない', () => {
            const tasks = extractTasks([
                '- [ ] task @2026-03-24',
                '    - tags:: #propTag',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks[0].tags).toContain('propTag');
            expect(tasks[0].properties['tags']).toBeUndefined();
        });
    });

    describe('bare-checkbox inbox tasks (task-bearing files)', () => {
        // After parser unification, "bare checkbox" is a tv-inline task with
        // no scheduling fields — distinguished by absence of dates rather than
        // by parserId. TVInlineParser uses '' (empty string) as the no-date
        // sentinel for startDate; other date fields stay undefined when absent.
        const isBare = (t: { startDate?: string; startTime?: string; endDate?: string; endTime?: string; due?: string }) =>
            !t.startDate && !t.startTime && !t.endDate && !t.endTime && !t.due;
        const isScheduled = (t: { startDate?: string; startTime?: string; endDate?: string; endTime?: string; due?: string }) =>
            !!(t.startDate || t.startTime || t.endDate || t.endTime || t.due);

        it('task-bearing file の top-level bare checkbox は inbox Task として抽出される', () => {
            const tasks = extractTasks([
                '- [ ] やりたいこと',
            ], undefined, { hasFrontmatterParent: true });
            expect(tasks).toHaveLength(1);
            expect(tasks[0].parserId).toBe('tv-inline');
            expect(tasks[0].content).toBe('やりたいこと');
            expect(tasks[0].startDate).toBe('');
            expect(tasks[0].endDate).toBeUndefined();
            expect(tasks[0].due).toBeUndefined();
        });

        it('非 task-bearing file の bare checkbox は従来どおり無視される', () => {
            const tasks = extractTasks([
                '- [ ] 議事メモ',
            ]);
            expect(tasks).toHaveLength(0);
        });

        it('@ タスク配下の bare checkbox は Task 化されず親の childLines に残る', () => {
            const tasks = extractTasks([
                '- [ ] parent @2026-03-24',
                '    - [ ] 子手順',
            ], undefined, { dailyNoteDate: '2026-03-24', hasFrontmatterParent: true });
            const scheduledTasks = tasks.filter(isScheduled);
            const bareTasks = tasks.filter(isBare);
            expect(scheduledTasks).toHaveLength(1);
            expect(bareTasks).toHaveLength(0);
            const parent = scheduledTasks[0];
            expect(parent.childLines.some(c => c.text.includes('子手順'))).toBe(true);
        });

        it('bare checkbox の配下に置かれた @ タスクは bare checkbox の子になる', () => {
            const tasks = extractTasks([
                '- [ ] inbox 親',
                '    - [ ] scheduled @2026-03-24',
            ], undefined, { hasFrontmatterParent: true });
            const inbox = tasks.find(isBare)!;
            const scheduled = tasks.find(isScheduled)!;
            expect(inbox).toBeDefined();
            expect(scheduled).toBeDefined();
            expect(scheduled.parentId).toBe(inbox.id);
            expect(inbox.childIds).toContain(scheduled.id);
        });

        it('bare checkbox の孫になる bare checkbox は childLine として保持される（祖先ルール）', () => {
            const tasks = extractTasks([
                '- [ ] inbox 親',
                '    - [ ] nested plain',
            ], undefined, { hasFrontmatterParent: true });
            const bareTasks = tasks.filter(isBare);
            expect(bareTasks).toHaveLength(1);
            expect(bareTasks[0].content).toBe('inbox 親');
            expect(bareTasks[0].childLines.some(c => c.text.includes('nested plain'))).toBe(true);
        });

        it('デイリーノート内の bare checkbox は日付継承により dated task になる（inbox ではない）', () => {
            const tasks = extractTasks([
                '- [ ] メモ',
            ], undefined, { dailyNoteDate: '2026-03-24' });
            expect(tasks).toHaveLength(1);
            expect(tasks[0].parserId).toBe('tv-inline');
            expect(tasks[0].startDate).toBe('2026-03-24');
        });

        it('同一ファイル内で @ task と inbox task が共存できる', () => {
            const tasks = extractTasks([
                '- [ ] scheduled @2026-03-24',
                '- [ ] inbox item',
            ], undefined, { hasFrontmatterParent: true });
            expect(tasks).toHaveLength(2);
            const scheduled = tasks.find(isScheduled)!;
            const inbox = tasks.find(isBare)!;
            expect(scheduled.startDate).toBe('2026-03-24');
            expect(inbox.startDate).toBe('');
        });
    });
});
