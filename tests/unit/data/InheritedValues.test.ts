import { describe, it, expect } from 'vitest';
import { inheritedAt, type InheritedValue } from '../../../src/services/data/InheritedValues';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import {
    getEffectiveColor, getEffectiveLinestyle, getEffectiveMask, getEffectiveProperties, getEffectiveTags,
} from '../../../src/services/data/EffectiveProperties';
import { DEFAULT_SETTINGS, type PropertyValue, type Task } from '../../../src/types';
import { valuesOf } from '../helpers/properties';

const byKey = (values: InheritedValue[]) => Object.fromEntries(values.map(v => [v.key, v]));
const rowOf = (lines: string[], text: string) => lines.findIndex(line => line.includes(text));

describe('inheritedAt', () => {
    it('frontmatter のカスタムキーは出さず、組み込みのキーと tags を frontmatter に書く値にする', () => {
        const lines = [
            '---',
            'aliases:',
            '  - 別名',
            'owner: me',
            '体重[kg]:',
            'tv-color: red',
            'tags: [project]',
            '---',
            '- [ ] task',
        ];
        const values = inheritedAt(lines, 8, DEFAULT_SETTINGS);
        expect(values.map(v => [v.key, v.to, v.lines])).toEqual([
            ['tv-color', 'frontmatter', ['tv-color: red']],
            ['tags', 'frontmatter', ['tags:', '  - project']],
        ]);
        expect(byKey(values)['tv-color'].from).toEqual([{ kind: 'frontmatter', line: 5 }]);
    });

    it('tv-ignore、position、ファイルタスクの旧キーは出さない', () => {
        const lines = [
            '---',
            'tv-ignore: false',
            'position: 3',
            'tv-status: done',
            'tv-content: old',
            'tv-timer-target-id: abc',
            '---',
            '- tv-status:: done',
            '- kept:: yes',
            '',
            '- [ ] task',
        ];
        const keys = inheritedAt(lines, 10, DEFAULT_SETTINGS).map(v => v.key);
        expect(keys).toEqual(['kept']);
    });

    it('最初の見出しより上の行の値は、見出しの下の行にも出る。カスタムの値は根の行に、組み込みのキーは frontmatter に書く', () => {
        const lines = [
            '---',
            'tv-color: red',
            '---',
            'Inherit properties:',
            '- 時給:: 1450',
            '- tv-color:: 00ff00',
            '',
            '## Work',
            '- [ ] task',
        ];
        const values = byKey(inheritedAt(lines, rowOf(lines, 'task'), DEFAULT_SETTINGS));
        expect(values['時給']).toEqual({ key: '時給', to: 'root', lines: ['- 時給:: 1450'], from: [{ kind: 'section', line: 4, heading: null }] });
        expect(values['tv-color']).toMatchObject({ to: 'frontmatter', lines: ['tv-color: 00ff00'], from: [{ kind: 'section', line: 5, heading: null }] });
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
        const task = FileParsePipeline.parse('n.md', lines, DEFAULT_SETTINGS, namesOutsideIndex('n.md')).tasks.find(t => t.line === child)!;
        expect(task.cascadeContext?.startDate).toBeUndefined();

        const values = byKey(inheritedAt(lines, child, DEFAULT_SETTINGS));
        expect(values['tv-start'].lines).toEqual(['tv-start: 2026-09-01']);
        expect(values['tv-color']).toMatchObject({
            to: 'frontmatter',
            lines: ['tv-color: ff0000'],
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
        expect(values['tv-start'].lines).toEqual(['tv-start: 2026-09-28T11:00']);
        expect(values['tv-start'].from).toEqual([
            { kind: 'frontmatter', line: 1 },
            { kind: 'section', line: 4, heading: expect.objectContaining({ text: 'Morning' }) },
        ]);
    });

    it('tags は和集合を YAML のリストで、出所は加えた層のすべて', () => {
        const lines = [
            '---',
            'tags: [project]',
            '---',
            '## S',
            '- tags:: #出/クレカ',
            '- [ ] task',
        ];
        const values = byKey(inheritedAt(lines, 5, DEFAULT_SETTINGS));
        expect(values.tags.lines).toEqual(['tags:', '  - project', '  - 出/クレカ']);
        expect(values.tags.from).toHaveLength(2);
    });

    it('見出しのプロパティ行のカスタムの値は、根の行に `- key:: value` で、値を綴りのまま写す', () => {
        const lines = [
            '## S',
            '- priority:: 3',
            '- code:: 007',
            '- note:: a: b # c',
            '* star:: x',
            '+ plus:: y',
            '- done:: True',
            '- area:: lab, desk',
            '- link:: [[x]]',
            '- hex:: 0x1F',
            '- id:: "123"',
            "- sq:: 'abc'",
            '- nul:: null',
            '- empty::',
            '- tv-color:: 007700',
            '- [ ] task',
        ];
        const values = byKey(inheritedAt(lines, rowOf(lines, 'task'), DEFAULT_SETTINGS));
        const root = (key: string) => {
            expect(values[key].to, key).toBe('root');
            return values[key].lines;
        };
        expect(root('priority')).toEqual(['- priority:: 3']);
        expect(root('code')).toEqual(['- code:: 007']);
        expect(root('note')).toEqual(['- note:: a: b # c']);
        // The list marker is made `-`.
        expect(root('star')).toEqual(['- star:: x']);
        expect(root('plus')).toEqual(['- plus:: y']);
        expect(root('done')).toEqual(['- done:: True']);
        expect(root('area')).toEqual(['- area:: lab, desk']);
        expect(root('link')).toEqual(['- link:: [[x]]']);
        expect(root('hex')).toEqual(['- hex:: 0x1F']);
        expect(root('id')).toEqual(['- id:: "123"']);
        expect(root('sq')).toEqual(["- sq:: 'abc'"]);
        expect(root('nul')).toEqual(['- nul:: null']);
        // No value goes as no value, which hides the value above there too.
        expect(root('empty')).toEqual(['- empty::']);
        // A built-in goes into the frontmatter, read as text: a color is not a number.
        expect(values['tv-color']).toMatchObject({ to: 'frontmatter', lines: ['tv-color: "007700"'] });
    });

    it('見出しのプロパティ行のリストは、行と項目を字下げの差を保って写し、組み込みのキーのリストは読めない値なので送らない。最初のタスクより下の行も節の値', () => {
        const lines = [
            '## S',
            '- [ ] task',
            '- list::',
            '  - a',
            '  - 12',
            '',
            '  - "12"',
            "  - 'x y'",
            '  - "a\\b"',
            '- tabs::',
            '\t- one',
            '- tv-mask::',
            '  - x',
            '  - y',
        ];
        const values = byKey(inheritedAt(lines, rowOf(lines, 'task'), DEFAULT_SETTINGS));
        expect(values.list).toMatchObject({ to: 'root', lines: ['- list::', '  - a', '  - 12', '  - "12"', "  - 'x y'", '  - "a\\b"'] });
        expect(values.tabs.lines).toEqual(['- tabs::', '\t- one']);
        expect(values['tv-mask']).toBeUndefined();
    });

    it('値のない値は値のない値として送る: 組み込みのキーは frontmatter の値のないキーで、frontmatter の行はそのまま、カスタムの値は値のない行', () => {
        const lines = [
            '---',
            'tv-color: red',
            'tv-start: 2026-09-01',
            'tv-linestyle:',
            'area: lab',
            '---',
            '- area::',
            '## S',
            '- tv-color::',
            '- tv-mask:: null',
            '- tv-start::',
            '- [ ] task',
        ];
        const values = byKey(inheritedAt(lines, rowOf(lines, 'task'), DEFAULT_SETTINGS));
        expect(values['tv-color']).toMatchObject({ lines: ['tv-color:'], from: [{ kind: 'section', line: 8 }] });
        expect(values['tv-mask'].lines).toEqual(['tv-mask:']);
        expect(values['tv-start']).toMatchObject({ lines: ['tv-start:'], from: [{ kind: 'section', line: 10 }] });
        expect(values['tv-linestyle']).toMatchObject({ lines: ['tv-linestyle:'], from: [{ kind: 'frontmatter', line: 3 }] });
        expect(values.area).toMatchObject({ to: 'root', lines: ['- area::'], from: [{ kind: 'section', line: 6, heading: null }] });
    });

    it('tv-ignore のノートは行を持たないので、何も答えない', () => {
        expect(inheritedAt(['---', 'tv-ignore: true', 'x: 1', '---', '- [ ] task'], 4, DEFAULT_SETTINGS)).toEqual([]);
    });
});

describe('inheritedAt の受け入れ: 候補をそれぞれの書く先に書いたノートで、送った行は同じ値を受け継ぐ', () => {
    /**
     * What a row inherits, as the views read it. A property is its type and
     * what that type means: an array its items, a boolean its truth, a
     * number its number.
     */
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
            properties: Object.fromEntries(Object.values(getEffectiveProperties(task))
                .map(({ key, value }) => [key, { type: value.type, means: meaning(value) }])),
        };
    }

    function meaning(property: PropertyValue): unknown {
        switch (property.type) {
            case 'list': return property.items.map(meaning);
            case 'boolean': return property.boolean;
            case 'number': return property.number;
            case 'text': return property.text;
            case 'null': return null;
        }
    }

    function send(lines: string[], row: number): { before: Task; after: Task } {
        const before = FileParsePipeline.parse('from.md', lines, DEFAULT_SETTINGS, namesOutsideIndex('from.md')).tasks.find(t => t.line === row)!;
        const block = before.subtreeLines!;
        const indent = block[0].length - block[0].trimStart().length;
        const values = inheritedAt(lines, row, DEFAULT_SETTINGS);
        const note = [
            '---',
            ...values.filter(v => v.to === 'frontmatter').flatMap(v => v.lines),
            '---',
            ...values.filter(v => v.to === 'root').flatMap(v => v.lines),
            '## Tasks',
            ...block.map(line => line.slice(indent)),
        ];
        const at = note.indexOf('## Tasks') + 1;
        const after = FileParsePipeline.parse('to.md', note, DEFAULT_SETTINGS, namesOutsideIndex('to.md')).tasks.find(t => t.line === at)!;
        return { before, after };
    }

    const SOURCE = [
        '---',
        'tv-start: "2026-09-28"',
        'tv-color: red',
        'tags:',
        '  - project',
        'author: me',
        '---',
        '- owner:: me',
        '- links::',
        '    - "[[a]]"',
        '    - "[[b]]"',
        '## Plan',
        '- tv-start:: 10:30',
        '- tv-mask:: ***',
        '- tags:: plan',
        '- priority:: 3',
        '- memo:: see: there',
        '- area:: lab, desk',
        '- pair:: [x, y]',
        '- quoted:: "123"',
        '- hex:: 0x1F',
        '- link:: [[x]]',
        '- refs:: [[a]], [[b|B, c]]',
        '- done:: True',
        '- off:: False',
        '- day:: 2026-09-29',
        '- word:: true',
        '- size:: 1.50',
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

    it('カスタムの値は型も綴りもそのまま', () => {
        const { before, after } = send(SOURCE, rowOf(SOURCE, 'parent'));
        const was = valuesOf(getEffectiveProperties(before));
        expect(valuesOf(getEffectiveProperties(after))).toEqual(was);
        expect(Object.keys(was)).not.toContain('author');
        expect(was.done).toEqual({ type: 'boolean', boolean: true, spelling: 'True' });
        expect(was.links).toEqual({ type: 'list', items: [
            { type: 'text', text: '[[a]]', spelling: '"[[a]]"' },
            { type: 'text', text: '[[b]]', spelling: '"[[b]]"' },
        ] });
    });

    it('子タスクの行を単独で送っても', () => {
        const { before, after } = send(SOURCE, rowOf(SOURCE, 'child'));
        expect(inherited(after)).toEqual(inherited(before));
    });
});
