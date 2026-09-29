import { describe, it, expect } from 'vitest';
import { inheritedAt, type InheritedValue } from '../../../src/services/data/InheritedValues';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import {
    getEffectiveColor, getEffectiveLinestyle, getEffectiveMask, getEffectiveProperties, getEffectiveTags,
} from '../../../src/services/data/EffectiveProperties';
import { DEFAULT_SETTINGS, type Task } from '../../../src/types';

const byKey = (values: InheritedValue[]) => Object.fromEntries(values.map(v => [v.key, v]));
const rowOf = (lines: string[], text: string) => lines.findIndex(line => line.includes(text));

describe('inheritedAt', () => {
    it('aliases の配列を綴りのまま写し、Obsidian のキーと印す', () => {
        const lines = [
            '---',
            'aliases:',
            '  - 別名',
            '  - "two: words"',
            'owner: me',
            '---',
            '- [ ] task',
        ];
        const values = byKey(inheritedAt(lines, 6, DEFAULT_SETTINGS));
        expect(values.aliases.yaml).toEqual(['aliases:', '  - 別名', '  - "two: words"']);
        expect(values.aliases.obsidian).toBe(true);
        expect(values.aliases.from).toEqual([{ kind: 'frontmatter' }]);
        expect(values.owner).toMatchObject({ yaml: ['owner: me'], obsidian: false });
    });

    it('tv-ignore、position、ファイルタスクの旧キーは出さない', () => {
        const lines = [
            '---',
            'tv-ignore: false',
            'position: 3',
            'tv-status: done',
            'tv-content: old',
            'tv-timer-target-id: abc',
            'kept: yes',
            '---',
            '- [ ] task',
        ];
        const keys = inheritedAt(lines, 8, DEFAULT_SETTINGS).map(v => v.key);
        expect(keys).toEqual(['kept']);
    });

    it('子タスクの行でも、その節の値が出る（行が自分の日付を持っても）', () => {
        const lines = [
            '---',
            'tv-start: "2026-09-01"',
            '---',
            '## Work',
            '- tv-color:: ff0000',
            '- [ ] parent',
            '    - [ ] child @2026-09-28',
        ];
        const child = rowOf(lines, 'child');
        // The row's own copy does not keep what its date hides.
        const task = FileParsePipeline.parse('n.md', lines, DEFAULT_SETTINGS).tasks.find(t => t.line === child)!;
        expect(task.cascadeContext?.startDate).toBeUndefined();

        const values = byKey(inheritedAt(lines, child, DEFAULT_SETTINGS));
        expect(values['tv-start'].yaml).toEqual(['tv-start: "2026-09-01"']);
        expect(values['tv-color']).toMatchObject({
            yaml: ['tv-color: ff0000'],
            from: [{ kind: 'section', line: 4, heading: { text: 'Work' } }],
        });
    });

    it('日付を frontmatter から、時刻を見出しから受け継いだ tv-start を組む', () => {
        const lines = [
            '---',
            'tv-start: "2026-09-28"',
            '---',
            '## Morning',
            '- tv-start:: 11:00',
            '- [ ] task',
        ];
        const values = byKey(inheritedAt(lines, 5, DEFAULT_SETTINGS));
        expect(values['tv-start'].yaml).toEqual(['tv-start: "2026-09-28T11:00"']);
        expect(values['tv-start'].from).toEqual([
            { kind: 'frontmatter' },
            { kind: 'section', line: 4, heading: expect.objectContaining({ text: 'Morning' }) },
        ]);
    });

    it('tags は和集合を YAML のリストで、出所は加えた層のすべて', () => {
        const lines = [
            '---',
            'tags: [project]',
            '---',
            '## S',
            '- tags:: 出/クレカ',
            '- [ ] task',
        ];
        const values = byKey(inheritedAt(lines, 5, DEFAULT_SETTINGS));
        expect(values.tags.yaml).toEqual(['tags:', '  - project', '  - "出/クレカ"']);
        expect(values.tags.from).toHaveLength(2);
    });

    it('見出しのプロパティ行の値は、書かれた文字のまま読める scalar にする', () => {
        const lines = [
            '## S',
            '- priority:: 3',
            '- code:: 007',
            '- note:: a: b # c',
            '- [ ] task',
        ];
        const values = byKey(inheritedAt(lines, 4, DEFAULT_SETTINGS));
        expect(values.priority.yaml).toEqual(['priority: 3']);
        expect(values.code.yaml).toEqual(['code: "007"']);
        expect(values.note.yaml).toEqual(['note: "a: b # c"']);
    });

    it('tv-ignore のノートは行を持たないので、何も答えない', () => {
        expect(inheritedAt(['---', 'tv-ignore: true', 'x: 1', '---', '- [ ] task'], 4, DEFAULT_SETTINGS)).toEqual([]);
    });
});

describe('inheritedAt の受け入れ: 候補を frontmatter に書いたノートで、送った行は同じ値を受け継ぐ', () => {
    /** What a row inherits, as the views read it. */
    function inherited(task: Task) {
        const cc = task.cascadeContext ?? {};
        return {
            startDate: task.startDate ?? cc.startDate,
            startTime: task.startTime ?? cc.startTime,
            endDate: task.endDate ?? cc.endDate,
            endTime: task.endTime ?? cc.endTime,
            due: task.due ?? cc.due,
            color: getEffectiveColor(task),
            linestyle: getEffectiveLinestyle(task),
            mask: getEffectiveMask(task),
            tags: getEffectiveTags(task),
            properties: getEffectiveProperties(task),
        };
    }

    function send(lines: string[], row: number): { before: Task; after: Task } {
        const before = FileParsePipeline.parse('from.md', lines, DEFAULT_SETTINGS).tasks.find(t => t.line === row)!;
        const block = before.subtreeLines!;
        const indent = block[0].length - block[0].trimStart().length;
        const note = [
            '---',
            ...inheritedAt(lines, row, DEFAULT_SETTINGS).flatMap(v => v.yaml),
            '---',
            '## Tasks',
            ...block.map(line => line.slice(indent)),
        ];
        const at = note.indexOf('## Tasks') + 1;
        const after = FileParsePipeline.parse('to.md', note, DEFAULT_SETTINGS).tasks.find(t => t.line === at)!;
        return { before, after };
    }

    const SOURCE = [
        '---',
        'tv-start: "2026-09-28"',
        'tv-color: red',
        'tags:',
        '  - project',
        'owner: me',
        'links:',
        '  - "[[a]]"',
        '  - "[[b]]"',
        '---',
        '## Plan',
        '- tv-start:: 10:30',
        '- tv-mask:: ***',
        '- tags:: plan',
        '- priority:: 3',
        '- memo:: see: there',
        '### Detail',
        '- tv-linestyle:: dashed',
        '- owner:: you',
        '- tv-end:: 2026-10-01 18:00',
        '- tv-due:: 2026-10-02',
        '- [ ] parent @2026-09-29',
        '    - [ ] child',
        '    - note',
    ];

    it('入れ子の見出しの下の行', () => {
        const { before, after } = send(SOURCE, rowOf(SOURCE, 'parent'));
        expect(inherited(after)).toEqual(inherited(before));
    });

    it('子タスクの行を単独で送っても', () => {
        const { before, after } = send(SOURCE, rowOf(SOURCE, 'child'));
        expect(inherited(after)).toEqual(inherited(before));
    });
});
