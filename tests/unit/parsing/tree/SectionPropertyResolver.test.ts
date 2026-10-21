import { describe, it, expect } from 'vitest';
import { NoteSections } from '../../../../src/services/parsing/tree/NoteSections';
import { Outline } from '../../../../src/services/parsing/utils/Outline';
import { SectionPropertyResolver } from '../../../../src/services/parsing/tree/SectionPropertyResolver';
import { DEFAULT_SCOPE_KEYS, DEFAULT_SETTINGS } from '../../../../src/types';
import { FileParsePipeline } from '../../../../src/services/parsing/FileParsePipeline';

const keys = DEFAULT_SCOPE_KEYS;

function buildAndResolve(bodyLines: string[], frontmatter?: Record<string, any>) {
    const outline = Outline.read(bodyLines);
    const root = NoteSections.read(outline);
    SectionPropertyResolver.resolve(outline, root, frontmatter, keys);
    return { root, sections: root.children };
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

    it('frontmatter → セクションのカスケード（child-wins）。frontmatter のカスタムキーは受け継がない', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tv-color:: 00ff00',
            '- [ ] task @2026-03-24',
        ], { 'tv-color': 'red', 'custom-fm': 'from-fm' });

        const section = doc.sections[0];
        // セクションの color がfrontmatter を上書き
        expect(section.resolvedColor).toBe('00ff00');
        // frontmatter のカスタムキーはノートのメタデータで、タスクに届かない
        expect(section.resolvedProperties['custom-fm']).toBeUndefined();
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

    it('frontmatter のカスタムキーは、position も値のあるキーも properties に含めない', () => {
        const doc = buildAndResolve([
            '## Section',
            '- [ ] task @2026-03-24',
        ], { 'position': { start: 0 }, 'real': 'kept', '体重[kg]': null });

        expect(doc.root.resolvedProperties).toEqual({});
        expect(doc.sections[0].resolvedProperties).toEqual({});
        expect(doc.sections[0].resolvedSources.properties).toEqual({});
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

        expect(doc.root.resolvedColor).toBeUndefined();
        expect(doc.root.resolvedProperties).toEqual({});
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
    // These notes are given their frontmatter as read, with no lines for it.
    const fm = { kind: 'frontmatter', line: null };
    const at = (line: number, text: string | null, level = 2) => ({
        kind: 'section',
        line,
        heading: text === null ? null : { level, text, line: expect.any(Number), end: expect.any(Number) },
    });

    it('frontmatter だけ: 組み込みの値はどれも frontmatter から。カスタムのキーは届かない', () => {
        const doc = buildAndResolve([
            '## Section',
            '- [ ] task',
        ], { 'tv-color': 'red', 'tv-start': '2026-09-28', owner: 'me', tags: ['a'] });
        const sources = doc.sections[0].resolvedSources;
        expect(sources.fields).toEqual({ color: fm, startDate: fm });
        expect(sources.properties).toEqual({});
        expect(sources.tags).toEqual([{ from: fm, tags: ['a'] }]);
    });

    it('見出しのプロパティ行が上書きした値は、その行から', () => {
        const doc = buildAndResolve([
            '- owner:: me',
            '- project:: X',
            '## Section',
            '- tv-color:: 00ff00',
            '- owner:: you',
            '- [ ] task',
        ], { 'tv-color': 'red' });
        const sources = doc.sections[0].resolvedSources;
        expect(sources.fields.color).toEqual(at(3, 'Section'));
        expect(sources.properties).toEqual({ owner: at(4, 'Section'), project: at(1, null) });
    });

    it('入れ子の見出し: 子の節は、自分の行と親の節の行と根の行と frontmatter を重ねる', () => {
        const doc = buildAndResolve([
            '- project:: X',
            '## Parent',
            '- owner:: parent',
            '- tv-mask:: ***',
            '### Child',
            '- owner:: child',
            '- [ ] task',
        ], { 'tv-color': 'red' });
        const child = doc.sections[0].children[0];
        expect(child.resolvedSources.properties).toEqual({
            project: at(0, null),
            owner: at(5, 'Child', 3),
        });
        expect(child.resolvedSources.fields.mask).toEqual(at(3, 'Parent'));
        expect(child.resolvedSources.fields.color).toEqual(fm);
        // 親の節の出所は子に書き換えられない
        expect(doc.sections[0].resolvedSources.properties.owner).toEqual(at(2, 'Parent'));
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

    it('根の行の値の出所は heading が null で、見出しの下の節にも同じ出所で届く', () => {
        const doc = buildAndResolve([
            '- owner:: top',
            '- [ ] task',
            '## Later',
            '- [ ] other',
        ]);
        expect(doc.root.resolvedSources.properties.owner).toEqual(at(0, null));
        expect(doc.sections[0].resolvedSources.properties).toEqual({ owner: at(0, null) });
    });

    it('同じキーが2度あれば、そのキーを読まず、上の層の値が届く。ほかのキーは読む', () => {
        const doc = buildAndResolve([
            '- owner:: top',
            '## Section',
            '- owner:: first',
            '- owner:: second',
            '- area:: lab',
            '- [ ] task',
        ]);
        const section = doc.sections[0];
        expect(section.resolvedProperties.owner?.value).toMatchObject({ text: 'top' });
        expect(section.resolvedSources.properties.owner).toEqual(at(0, null));
        expect(section.resolvedProperties.area?.value).toMatchObject({ text: 'lab' });
        expect(section.resolvedSources.properties.area).toEqual(at(4, 'Section'));
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
    const fm = { kind: 'frontmatter', line: null };
    const at = (line: number) => expect.objectContaining({ kind: 'section', line });

    it('見出しの値のない組み込みのキーは、frontmatter の値を隠し、出所はその行', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tv-color::',
            '- tv-linestyle:: null',
            '- tv-mask:: ~',
            '- [ ] task',
        ], { 'tv-color': 'red', 'tv-linestyle': 'dashed', 'tv-mask': '***' });
        const section = doc.sections[0];
        expect(section.resolvedColor).toBeNull();
        expect(section.resolvedLinestyle).toBeNull();
        expect(section.resolvedMask).toBeNull();
        expect(section.resolvedSources.fields.color).toEqual(at(1));
        expect(section.resolvedSources.fields.linestyle).toEqual(at(2));
        expect(section.resolvedSources.fields.mask).toEqual(at(3));
    });

    it('値のない値を、さらに下の層の値が上書きする', () => {
        const doc = buildAndResolve([
            '## Parent',
            '- tv-color::',
            '- area::',
            '### Child',
            '- tv-color:: blue',
            '- area:: desk',
            '- [ ] task',
        ], { 'tv-color': 'red', area: 'lab' });
        const child = doc.sections[0].children[0];
        expect(child.resolvedColor).toBe('blue');
        expect(child.resolvedProperties.area?.value).toMatchObject({ text: 'desk' });
        expect(child.resolvedSources.fields.color).toEqual(at(4));
    });

    it('見出しの値のない tv-start は、frontmatter の日付と時刻の両方を隠す', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tv-start::',
            '- tv-end::',
            '- tv-due::',
            '- [ ] task',
        ], { 'tv-start': '2026-09-28T10:00', 'tv-end': '2026-09-29T11:00', 'tv-due': '2026-09-30' });
        const section = doc.sections[0];
        expect(section.resolvedStartDate).toBeNull();
        expect(section.resolvedStartTime).toBeNull();
        expect(section.resolvedEndDate).toBeNull();
        expect(section.resolvedEndTime).toBeNull();
        expect(section.resolvedDue).toBeNull();
        expect(section.resolvedSources.fields.startDate).toEqual(at(1));
        expect(section.resolvedSources.fields.startTime).toEqual(at(1));
    });

    it('値を書いた tv-start は、日付と時刻を別々に受け継ぐ（隠した後も）', () => {
        const doc = buildAndResolve([
            '## Parent',
            '- tv-start::',
            '### Child',
            '- tv-start:: 11:00',
            '- [ ] task',
        ], { 'tv-start': '2026-09-28T10:00' });
        const child = doc.sections[0].children[0];
        expect(child.resolvedStartDate).toBeNull();
        expect(child.resolvedStartTime).toBe('11:00');
    });

    it('見出しの値のないカスタムのキーは、根の行の値を隠す', () => {
        const doc = buildAndResolve([
            '- area:: lab',
            '## Section',
            '- area::',
            '- [ ] task',
        ]);
        const section = doc.sections[0];
        expect(section.resolvedProperties.area?.value).toEqual({ type: 'null', spelling: '' });
        expect(section.resolvedSources.properties.area).toEqual(at(2));
    });

    it('frontmatter の値のない組み込みのキーは値なしとして届き、出所は frontmatter。値のないカスタムのキーは届かない', () => {
        const doc = buildAndResolve(['## Section', '- [ ] task'], { area: null, 'tv-color': null, 'tv-start': null });
        const section = doc.sections[0];
        expect(section.resolvedProperties).toEqual({});
        expect(section.resolvedColor).toBeNull();
        expect(section.resolvedStartDate).toBeNull();
        expect(section.resolvedStartTime).toBeNull();
        expect(section.resolvedSources.fields.color).toEqual(fm);
        expect(section.resolvedSources.properties).toEqual({});
    });

    it('frontmatter の大小違いの重複は、値のないキーでも重複として読まない', () => {
        const doc = buildAndResolve(['## Section', '- [ ] task'], { 'TV-COLOR': 'red', 'tv-color': null, 'tv-mask': '***' });
        expect(doc.sections[0].resolvedColor).toBeUndefined();
        expect(doc.sections[0].resolvedSources.fields.color).toBeUndefined();
        expect(doc.sections[0].resolvedMask).toBe('***');
    });

    it('見出しの読めない値は、書いていないものとして上の層の値を通す', () => {
        const doc = buildAndResolve([
            '## Section',
            '- tv-linestyle:: wavy',
            '- tv-start:: someday',
            '- tv-due:: 10:00',
            '- tv-color:: ""',
            '- [ ] task',
        ], { 'tv-linestyle': 'dashed', 'tv-start': '2026-09-28', 'tv-due': '2026-09-30', 'tv-color': 'red' });
        const section = doc.sections[0];
        expect(section.resolvedLinestyle).toBe('dashed');
        expect(section.resolvedStartDate).toBe('2026-09-28');
        expect(section.resolvedDue).toBe('2026-09-30');
        expect(section.resolvedColor).toBe('red');
        expect(section.resolvedSources.fields.linestyle).toEqual(fm);
    });

    it('見出しの組み込みのキーのリストは読めない値で、上の層の値を通す', () => {
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
        expect(section.resolvedColor).toBe('blue');
        expect(section.resolvedMask).toBeUndefined();
    });

    it('frontmatter の組み込みのキーのリストも読めない値', () => {
        const doc = buildAndResolve(['## Section', '- [ ] task'], { 'tv-color': ['red'], 'tv-mask': [] });
        const section = doc.sections[0];
        expect(section.resolvedColor).toBeUndefined();
        expect(section.resolvedMask).toBeUndefined();
        expect(section.resolvedSources.fields).toEqual({});
    });

    it('カスタムのリストは上の層のリストを丸ごと置き換える', () => {
        const doc = buildAndResolve([
            '- who::',
            '    - a',
            '    - b',
            '## Section',
            '- who::',
            '    - c',
            '- [ ] task',
        ]);
        expect(doc.root.resolvedProperties.who?.value).toEqual({ type: 'list', items: [
            { type: 'text', text: 'a', spelling: 'a' }, { type: 'text', text: 'b', spelling: 'b' },
        ] });
        expect(doc.sections[0].resolvedProperties.who?.value).toEqual({ type: 'list', items: [{ type: 'text', text: 'c', spelling: 'c' }] });
    });

    it('値のない tags は何も足さず、上の層のタグを隠さない', () => {
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

describe('frontmatter の出所の行', () => {
    it('frontmatter の値の出所は、そのキーの行（大文字と小文字によらない）', () => {
        const lines = [
            '---',
            'TV-Color: red',
            'Area: lab',
            'tags:',
            '  - a',
            'tv-start:',
            '---',
            '## S',
            '- [ ] task',
        ];
        const read = FileParsePipeline.resolveSections(lines, DEFAULT_SETTINGS)!;
        const sources = read.root.children[0].resolvedSources;
        expect(sources.fields.color).toEqual({ kind: 'frontmatter', line: 1 });
        expect(sources.properties).toEqual({});
        expect(sources.tags).toEqual([{ from: { kind: 'frontmatter', line: 3 }, tags: ['a'] }]);
        expect(sources.fields.startDate).toEqual({ kind: 'frontmatter', line: 5 });
        expect(sources.fields.startTime).toEqual({ kind: 'frontmatter', line: 5 });
    });
});

describe('根の行（最初の見出しより上のプロパティ行）', () => {
    it('ノート全体に届く: 根の中のタスクにも、見出しの下の節にも、入れ子の節にも', () => {
        const doc = buildAndResolve([
            '- 時給:: 1450',
            '- [ ] top task',
            '## A',
            '### A1',
            '- [ ] deep task',
            '## B',
        ]);
        const value = { type: 'number', number: 1450, spelling: '1450' };
        expect(doc.root.resolvedProperties['時給']?.value).toEqual(value);
        expect(doc.sections[0].resolvedProperties['時給']?.value).toEqual(value);
        expect(doc.sections[0].children[0].resolvedProperties['時給']?.value).toEqual(value);
        expect(doc.sections[1].resolvedProperties['時給']?.value).toEqual(value);
    });

    it('frontmatter に勝ち、見出しの節に負ける', () => {
        const doc = buildAndResolve([
            '- tv-color:: 00ff00',
            '- tv-start:: 2026-10-01',
            '## A',
            '- tv-color:: 0000ff',
            '## B',
        ], { 'tv-color': 'red', 'tv-start': '2026-09-28', 'tv-mask': '***' });
        expect(doc.root.resolvedColor).toBe('00ff00');
        expect(doc.sections[0].resolvedColor).toBe('0000ff');
        expect(doc.sections[1].resolvedColor).toBe('00ff00');
        expect(doc.sections[1].resolvedStartDate).toBe('2026-10-01');
        expect(doc.sections[1].resolvedMask).toBe('***');
        expect(doc.sections[1].resolvedSources.fields.color).toMatchObject({ kind: 'section', line: 0, heading: null });
        expect(doc.sections[1].resolvedSources.fields.mask).toEqual({ kind: 'frontmatter', line: null });
    });

    it('根の値のない組み込みのキーは frontmatter の値を隠す', () => {
        const doc = buildAndResolve(['- tv-color::', '## A', '- [ ] t'], { 'tv-color': 'red' });
        expect(doc.sections[0].resolvedColor).toBeNull();
        expect(doc.sections[0].resolvedSources.fields.color).toMatchObject({ kind: 'section', line: 0, heading: null });
    });

    it('根のタグは frontmatter のタグに足され、見出しの節に届く', () => {
        const doc = buildAndResolve(['- tags:: #root', '## A', '- [ ] t'], { tags: ['fm'] });
        expect(doc.sections[0].resolvedTags).toEqual(['fm', 'root']);
    });

    it('frontmatter の閉じの次の行から根の行になる', () => {
        const lines = ['---', 'area: fm', '---', 'Inherit properties:', '- area:: root', '', '## S', '- [ ] task'];
        const read = FileParsePipeline.resolveSections(lines, DEFAULT_SETTINGS)!;
        const section = read.root.children[0];
        expect(section.resolvedProperties.area?.value).toMatchObject({ text: 'root' });
        expect(section.resolvedSources.properties.area).toMatchObject({ kind: 'section', line: 4, heading: null });
    });
});
