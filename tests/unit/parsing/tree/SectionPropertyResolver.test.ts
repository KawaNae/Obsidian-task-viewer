import { describe, it, expect } from 'vitest';
import { DocumentTreeBuilder } from '../../../../src/services/parsing/tree/DocumentTreeBuilder';
import { SectionPropertyResolver } from '../../../../src/services/parsing/tree/SectionPropertyResolver';
import { DEFAULT_TV_FILE_KEYS } from '../../../../src/types';

const keys = DEFAULT_TV_FILE_KEYS;

function buildAndResolve(bodyLines: string[], frontmatter?: Record<string, any>) {
    const doc = DocumentTreeBuilder.build('test.md', bodyLines, 0);
    SectionPropertyResolver.resolve(doc, frontmatter, keys);
    return doc;
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
        expect(section.resolvedProperties['custom']).toEqual({ value: 'hello', type: 'string' });
        expect(section.resolvedProperties['tv-color']).toBeUndefined(); // 分離済み
    });

    it('セクションプロパティを解決（グループ形式）', () => {
        const doc = buildAndResolve([
            '## Section',
            '- properties::',
            '    - tv-color:: 333333',
            '    - note:: something',
            '- [ ] task @2026-03-24',
        ]);
        const section = doc.sections[0];
        expect(section.resolvedColor).toBe('333333');
        expect(section.resolvedProperties['note']).toEqual({ value: 'something', type: 'string' });
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
        expect(section.resolvedProperties['custom-fm']).toEqual({ value: 'from-fm', type: 'string' });
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
        expect(section.resolvedProperties['real']).toEqual({ value: 'kept', type: 'string' });
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
        expect(child.resolvedProperties['custom']).toEqual({ value: 'parent-value', type: 'string' });
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
        expect(child.resolvedProperties['custom']).toEqual({ value: 'child-value', type: 'string' });
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

        expect(doc.sections[0].resolvedProperties['priority']).toEqual({
            value: '1', type: 'number',
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
});
