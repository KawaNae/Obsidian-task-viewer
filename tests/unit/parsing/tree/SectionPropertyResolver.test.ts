import { describe, it, expect } from 'vitest';
import { NoteSections } from '../../../../src/services/parsing/tree/NoteSections';
import { Outline } from '../../../../src/services/parsing/utils/Outline';
import { SectionPropertyResolver } from '../../../../src/services/parsing/tree/SectionPropertyResolver';
import { DEFAULT_SCOPE_KEYS } from '../../../../src/types';

const keys = DEFAULT_SCOPE_KEYS;

function buildAndResolve(bodyLines: string[], frontmatter?: Record<string, any>) {
    const sections = NoteSections.read(Outline.read(bodyLines));
    SectionPropertyResolver.resolve(sections, frontmatter, keys);
    return { sections };
}

describe('SectionPropertyResolver', () => {
    it('セクションプロパティを解決（フラット形式）', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tv-color:: ff0000',
            '- custom:: hello',
            '- [ ] task @2026-03-24',
        ]);
        const section = doc.sections[0];
        expect(section.resolvedColor).toBe('ff0000');
        expect(section.resolvedProperties['custom']?.value).toEqual({ type: 'text', text: 'hello', spelling: 'hello' });
        expect(section.resolvedProperties['tv-color']).toBeUndefined(); // 分離済み
    });

    it('`- properties::` はまとめの形でなく、キー properties のリスト', () => {
        const doc = buildAndResolve([
            '## Section',
            '- properties::',
            '    - tv-color:: 333333',
            '    - note:: something',
            '- [ ] task @2026-03-24',
        ]);
        const section = doc.sections[0];
        expect(section.resolvedColor).toBeUndefined();
        expect(section.resolvedProperties['note']).toBeUndefined();
        expect(section.resolvedProperties['properties']?.value).toEqual({ type: 'list', items: [
            { type: 'text', text: 'tv-color:: 333333', spelling: 'tv-color:: 333333' },
            { type: 'text', text: 'note:: something', spelling: 'note:: something' },
        ] });
    });

    it('frontmatter → セクションのカスケード（child-wins）', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tv-color:: 00ff00',
            '- [ ] task @2026-03-24',
        ], { 'tv-color': 'red', 'custom-fm': 'from-fm' });

        const section = doc.sections[0];
        // セクションの color がfrontmatter を上書き
        expect(section.resolvedColor).toBe('00ff00');
        // frontmatter のカスタムプロパティが継承
        expect(section.resolvedProperties['custom-fm']?.value).toEqual({ type: 'text', text: 'from-fm', spelling: 'from-fm' });
    });

    it('frontmatter プロパティのみ（セクションプロパティなし）', () => {
        const doc = buildAndResolve([
            '## Section',
            '- [ ] task @2026-03-24',
        ], { 'tv-color': 'blue', 'tv-linestyle': 'dashed' });

        const section = doc.sections[0];
        expect(section.resolvedColor).toBe('blue');
        expect(section.resolvedLinestyle).toBe('dashed');
    });

    it('frontmatter の不正な linestyle は undefined になる (validation)', () => {
        const doc = buildAndResolve([
            '## Section',
            '- [ ] task @2026-03-24',
        ], { 'tv-linestyle': 'bogus-value' });

        const section = doc.sections[0];
        expect(section.resolvedLinestyle).toBeUndefined();
    });

    it('frontmatter + 見出し直後空行 + section property: section が FM を上書き', () => {
        // Markdown loose list: heading 直後の空行は list を終了させない。
        // section property block が正しく検出され、FM の tv-color を上書きする。
        const doc = buildAndResolve([
            '## Section',
            '',
            '- tv-color:: 00ff00',
            '- [ ] task @2026-03-24',
        ], { 'tv-color': 'ff0000' });

        const section = doc.sections[0];
        expect(section.resolvedColor).toBe('00ff00');
    });

    it('frontmatter の position キーは properties に含めない', () => {
        const doc = buildAndResolve([
            '## Section',
            '- [ ] task @2026-03-24',
        ], { 'position': { start: 0 }, 'real': 'kept' });

        const section = doc.sections[0];
        expect(section.resolvedProperties['position']).toBeUndefined();
        expect(section.resolvedProperties['real']?.value).toEqual({ type: 'text', text: 'kept', spelling: 'kept' });
    });

    it('ネストセクションのカスケード: 親 → 子', () => {
        const doc = buildAndResolve([
            '## Parent',
            '- tv-color:: red',
            '- custom:: parent-value',
            '### Child',
            '- [ ] task @2026-03-24',
        ]);

        const parent = doc.sections[0];
        const child = parent.children[0];

        expect(parent.resolvedColor).toBe('red');
        expect(child.resolvedColor).toBe('red'); // 親から継承
        expect(child.resolvedProperties['custom']?.value).toEqual({ type: 'text', text: 'parent-value', spelling: 'parent-value' });
    });

    it('子セクションが親プロパティをオーバーライド（child-wins）', () => {
        const doc = buildAndResolve([
            '## Parent',
            '- tv-color:: red',
            '- custom:: parent-value',
            '### Child',
            '- tv-color:: blue',
            '- custom:: child-value',
            '- [ ] task @2026-03-24',
        ]);

        const child = doc.sections[0].children[0];
        expect(child.resolvedColor).toBe('blue');
        expect(child.resolvedProperties['custom']?.value).toEqual({ type: 'text', text: 'child-value', spelling: 'child-value' });
    });

    it('3レベルカスケード: frontmatter → ## → ###', () => {
        const doc = buildAndResolve([
            '## Level 2',
            '- tv-linestyle:: dashed',
            '### Level 3',
            '- tv-color:: 333333',
            '- [ ] task @2026-03-24',
        ], { 'tv-color': 'red', 'tv-mask': '***' });

        const l2 = doc.sections[0];
        const l3 = l2.children[0];

        // L2: fm の color を継承、自身の linestyle
        expect(l2.resolvedColor).toBe('red');
        expect(l2.resolvedLinestyle).toBe('dashed');
        expect(l2.resolvedMask).toBe('***');

        // L3: 自身の color、L2 の linestyle を継承、fm の mask を継承
        expect(l3.resolvedColor).toBe('333333');
        expect(l3.resolvedLinestyle).toBe('dashed');
        expect(l3.resolvedMask).toBe('***');
    });

    it('兄弟セクションは独立', () => {
        const doc = buildAndResolve([
            '## A',
            '- tv-color:: red',
            '## B',
            '- tv-color:: blue',
            '- [ ] task @2026-03-24',
        ]);

        expect(doc.sections[0].resolvedColor).toBe('red');
        expect(doc.sections[1].resolvedColor).toBe('blue');
    });

    it('プロパティなしのセクション → 空の resolvedProperties', () => {
        const doc = buildAndResolve([
            '## Section',
            '- [ ] task @2026-03-24',
        ]);

        expect(doc.sections[0].resolvedColor).toBeUndefined();
        expect(doc.sections[0].resolvedLinestyle).toBeUndefined();
        expect(doc.sections[0].resolvedProperties).toEqual({});
    });

    it('frontmatter なし + セクションなし → 空', () => {
        const doc = buildAndResolve([
            '- [ ] task @2026-03-24',
        ]);

        expect(doc.sections[0].resolvedColor).toBeUndefined();
        expect(doc.sections[0].resolvedProperties).toEqual({});
    });

    it('不正な linestyle は除外', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tv-linestyle:: wavy',
            '- [ ] task @2026-03-24',
        ]);

        expect(doc.sections[0].resolvedLinestyle).toBeUndefined();
    });

    it('数値型のカスタムプロパティの型推定', () => {
        const doc = buildAndResolve([
            '## Section',
            '- priority:: 1',
            '- [ ] task @2026-03-24',
        ]);

        expect(doc.sections[0].resolvedProperties['priority']?.value).toEqual({
            type: 'number', number: 1, spelling: '1',
        });
    });

    // --- tags カスケード ---

    it('frontmatter tags がセクションに伝播', () => {
        const doc = buildAndResolve([
            '## Section',
            '- [ ] task @2026-03-24',
        ], { tags: ['project', 'important'] });

        expect(doc.sections[0].resolvedTags).toEqual(['important', 'project']);
    });

    it('セクション property block の tags が解決される', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tags:: #sectionTag',
            '- [ ] task @2026-03-24',
        ]);

        expect(doc.sections[0].resolvedTags).toEqual(['sectionTag']);
    });

    it('frontmatter tags + セクション tags がマージされる', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tags:: #sectionTag',
            '- [ ] task @2026-03-24',
        ], { tags: ['project'] });

        expect(doc.sections[0].resolvedTags).toEqual(['project', 'sectionTag']);
    });

    it('ネストセクションでタグがカスケード＋マージ', () => {
        const doc = buildAndResolve([
            '## Parent',
            '- tags:: #parentTag',
            '### Child',
            '- tags:: #childTag',
            '- [ ] task @2026-03-24',
        ]);

        const parent = doc.sections[0];
        const child = parent.children[0];

        expect(parent.resolvedTags).toEqual(['parentTag']);
        expect(child.resolvedTags).toEqual(['childTag', 'parentTag']);
    });

    it('兄弟セクションのタグは独立', () => {
        const doc = buildAndResolve([
            '## A',
            '- tags:: #tagA',
            '## B',
            '- tags:: #tagB',
        ]);

        expect(doc.sections[0].resolvedTags).toEqual(['tagA']);
        expect(doc.sections[1].resolvedTags).toEqual(['tagB']);
    });

    it('タグなしセクションは親タグを継承', () => {
        const doc = buildAndResolve([
            '## Parent',
            '- tags:: #parentTag',
            '### Child',
            '- [ ] task @2026-03-24',
        ]);

        const child = doc.sections[0].children[0];
        expect(child.resolvedTags).toEqual(['parentTag']);
    });

    it('frontmatter tags なし + セクション tags なし → undefined', () => {
        const doc = buildAndResolve([
            '## Section',
            '- [ ] task @2026-03-24',
        ]);

        expect(doc.sections[0].resolvedTags).toBeUndefined();
    });

    it('3段ネストでタグがカスケードしても兄弟間で独立', () => {
        const doc = buildAndResolve([
            '## Expenses',                      // 0
            '### EPOS',                          // 1
            '#### 普通',                         // 2
            '- [ ] task1 @2026-03-24',          // 3
            '#### 特殊',                         // 4
            '- tags:: #出/クレカ/EPOS',          // 5
            '- [ ] task2 @2026-03-25',          // 6
            '### りそな',                        // 7
            '- tags:: #出/りそな',               // 8
            '- [ ] task3 @2026-03-26',          // 9
        ]);

        const expenses = doc.sections[0];
        const epos = expenses.children[0];
        const normal = epos.children[0];
        const special = epos.children[1];
        const risona = expenses.children[1];

        expect(expenses.resolvedTags).toBeUndefined();
        expect(epos.resolvedTags).toBeUndefined();
        expect(normal.resolvedTags).toBeUndefined();
        expect(special.resolvedTags).toEqual(['出/クレカ/EPOS']);
        expect(risona.resolvedTags).toEqual(['出/りそな']);
    });
});

describe('SectionPropertyResolver の出所', () => {
    const fm = { kind: 'frontmatter' };
    const at = (line: number, text: string | null, level = 2) => ({
        kind: 'section',
        line,
        heading: text === null ? null : { level, text, line: expect.any(Number), end: expect.any(Number) },
    });

    it('frontmatter だけ: 値はどれも frontmatter から', () => {
        const doc = buildAndResolve([
            '## Section',
            '- [ ] task',
        ], { 'tv-color': 'red', 'tv-start': '2026-09-28', owner: 'me', tags: ['a'] });
        const sources = doc.sections[0].resolvedSources;
        expect(sources.fields).toEqual({ color: fm, startDate: fm });
        expect(sources.properties).toEqual({ owner: fm });
        expect(sources.tags).toEqual([{ from: fm, tags: ['a'] }]);
    });

    it('見出しのプロパティ行が上書きした値は、その行から', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tv-color:: 00ff00',
            '- owner:: you',
            '- [ ] task',
        ], { 'tv-color': 'red', owner: 'me', project: 'X' });
        const sources = doc.sections[0].resolvedSources;
        expect(sources.fields.color).toEqual(at(1, 'Section'));
        expect(sources.properties).toEqual({ owner: at(2, 'Section'), project: fm });
    });

    it('入れ子の見出し: 子の節は、自分の行と親の節の行と frontmatter を重ねる', () => {
        const doc = buildAndResolve([
            '## Parent',
            '- owner:: parent',
            '- tv-mask:: ***',
            '### Child',
            '- owner:: child',
            '- [ ] task',
        ], { project: 'X' });
        const child = doc.sections[0].children[0];
        expect(child.resolvedSources.properties).toEqual({
            project: fm,
            owner: at(4, 'Child', 3),
        });
        expect(child.resolvedSources.fields.mask).toEqual(at(2, 'Parent'));
        // 親の節の出所は子に書き換えられない
        expect(doc.sections[0].resolvedSources.properties.owner).toEqual(at(1, 'Parent'));
    });

    it('日付を frontmatter から、時刻を見出しから受け継ぐ', () => {
        const doc = buildAndResolve([
            '## Morning',
            '- tv-start:: 11:00',
            '- [ ] task',
        ], { 'tv-start': '2026-09-28' });
        const section = doc.sections[0];
        expect(section.resolvedStartDate).toBe('2026-09-28');
        expect(section.resolvedStartTime).toBe('11:00');
        expect(section.resolvedSources.fields.startDate).toEqual(fm);
        expect(section.resolvedSources.fields.startTime).toEqual(at(1, 'Morning'));
    });

    it('tags の出所が2つ: 和集合に加えた層を上から順に', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tags:: #sectionTag',
            '- [ ] task',
        ], { tags: ['project'] });
        const section = doc.sections[0];
        expect(section.resolvedTags).toEqual(['project', 'sectionTag']);
        expect(section.resolvedSources.tags).toEqual([
            { from: fm, tags: ['project'] },
            { from: at(1, 'Section'), tags: ['sectionTag'] },
        ]);
    });

    it('最初の見出しより上の節は heading が null', () => {
        const doc = buildAndResolve([
            '- owner:: top',
            '- [ ] task',
            '## Later',
            '- [ ] other',
        ]);
        expect(doc.sections[0].resolvedSources.properties.owner).toEqual(at(0, null));
        expect(doc.sections[1].resolvedSources.properties).toEqual({});
    });

    it('同じキーが2度あれば、そのキーを読まず、上の層の値が届く。ほかのキーは読む', () => {
        const doc = buildAndResolve([
            '## Section',
            '- owner:: first',
            '- owner:: second',
            '- area:: lab',
            '- [ ] task',
        ], { owner: 'fm' });
        const section = doc.sections[0];
        expect(section.resolvedProperties.owner?.value).toMatchObject({ text: 'fm' });
        expect(section.resolvedSources.properties.owner).toEqual({ kind: 'frontmatter' });
        expect(section.resolvedProperties.area?.value).toMatchObject({ text: 'lab' });
        expect(section.resolvedSources.properties.area).toEqual(at(3, 'Section'));
    });

    // 実在しない日や時刻を指す値は、日付も時刻も読まない。その層は日付を
    // 言っていないことになり、上の層の値を受け継ぐ（タスクの読めない @ ブロックと同じ）
    describe('実在しない日付と時刻', () => {
        it('frontmatter の実在しない日は読まない', () => {
            const doc = buildAndResolve(['## S', '- [ ] task'], {
                'tv-start': '2026-02-30', 'tv-end': '2026-13-45T10:00', 'tv-due': '2025-02-29',
            });
            const section = doc.sections[0];
            expect(section.resolvedStartDate).toBeUndefined();
            expect(section.resolvedEndDate).toBeUndefined();
            expect(section.resolvedEndTime).toBeUndefined();
            expect(section.resolvedDue).toBeUndefined();
        });

        it('見出しのプロパティ行の読めない値は、日付も時刻も読まず、上の層の値になる', () => {
            const doc = buildAndResolve([
                '## Morning',
                '- tv-start:: 2026-02-30T11:00',
                '- tv-due:: 2026-10-01T25:00',
                '- [ ] task',
            ], { 'tv-start': '2026-09-28', 'tv-due': '2026-10-05' });
            const section = doc.sections[0];
            expect(section.resolvedStartDate).toBe('2026-09-28');
            expect(section.resolvedStartTime).toBeUndefined();
            expect(section.resolvedSources.fields.startDate).toEqual(fm);
            expect(section.resolvedDue).toBe('2026-10-05');
        });
    });
});

describe('値のない値と読めない値', () => {
    const fm = { kind: 'frontmatter' };

    it('見出しの値のない組み込みのキーは、frontmatter の値を通す', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tv-color::',
            '- tv-linestyle::',
            '- tv-mask::',
            '- [ ] task',
        ], { 'tv-color': 'red', 'tv-linestyle': 'dashed', 'tv-mask': '***' });
        const section = doc.sections[0];
        expect(section.resolvedColor).toBe('red');
        expect(section.resolvedLinestyle).toBe('dashed');
        expect(section.resolvedMask).toBe('***');
        expect(section.resolvedSources.fields.color).toEqual(fm);
    });

    it('見出しの値のない tv-start は、frontmatter の日付と時刻を通す', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tv-start::',
            '- [ ] task',
        ], { 'tv-start': '2026-09-28T10:00' });
        const section = doc.sections[0];
        expect(section.resolvedStartDate).toBe('2026-09-28');
        expect(section.resolvedStartTime).toBe('10:00');
    });

    it('見出しの値のないカスタムのキーは、frontmatter の値を隠す', () => {
        const doc = buildAndResolve([
            '## Section',
            '- area::',
            '- [ ] task',
        ], { area: 'lab' });
        const section = doc.sections[0];
        expect(section.resolvedProperties.area?.value).toEqual({ type: 'null', spelling: '' });
        expect(section.resolvedSources.properties.area).toMatchObject({ kind: 'section', line: 1 });
    });

    it('frontmatter の値のないキーは読まない', () => {
        const doc = buildAndResolve(['## Section', '- [ ] task'], { area: null, 'tv-color': null });
        const section = doc.sections[0];
        expect(section.resolvedProperties.area).toBeUndefined();
        expect(section.resolvedColor).toBeUndefined();
        expect(section.resolvedSources.fields.color).toBeUndefined();
    });

    it('見出しの読めない線種は、frontmatter の値を通す', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tv-linestyle:: wavy',
            '- [ ] task',
        ], { 'tv-linestyle': 'dashed' });
        expect(doc.sections[0].resolvedLinestyle).toBe('dashed');
    });

    it('見出しの組み込みのキーのリストは、項目を `, ` でつないだ値になる', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tv-color::',
            '    - red',
            '- tv-mask::',
            '    - a',
            '    - b',
            '- [ ] task',
        ], { 'tv-color': 'blue' });
        const section = doc.sections[0];
        expect(section.resolvedColor).toBe('red');
        expect(section.resolvedMask).toBe('a, b');
    });

    it('値のない tags は何も足さない', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tags::',
            '- [ ] task',
        ], { tags: ['a'] });
        const section = doc.sections[0];
        expect(section.resolvedTags).toEqual(['a']);
        expect(section.resolvedSources.tags).toEqual([{ from: fm, tags: ['a'] }]);
    });
});
