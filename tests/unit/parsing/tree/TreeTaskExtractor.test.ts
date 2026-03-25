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
            // plain checkbox（日付なし）は childLines に残る
            expect(parent.childLines.length).toBeGreaterThanOrEqual(1);
        });
    });
});
