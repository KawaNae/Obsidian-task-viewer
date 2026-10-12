import { describe, it, expect } from 'vitest';
import { NoteSections } from '../../../../src/services/parsing/tree/NoteSections';
import { NoteTasks } from '../../../../src/services/parsing/tree/NoteTasks';
import type { SectionNode } from '../../../../src/services/parsing/tree/Sections';
import { Outline, type OutlineReading } from '../../../../src/services/parsing/utils/Outline';
import { lineParsers } from '../../../../src/services/parsing/TaskParser';
import { namesOutsideIndex } from '../../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS, DEFAULT_SCOPE_KEYS, type Task } from '../../../../src/types';

interface Read {
    sections: SectionNode[];
    bodyStartLine: number;
    outline: OutlineReading;
    tasks: Task[];
}

function read(lines: string[]): Read {
    const outline = Outline.read(lines);
    const sections = NoteSections.read(outline);
    const tasks = NoteTasks.extract(outline, sections, {
        filePath: 'test.md', scopeKeys: DEFAULT_SCOPE_KEYS, parsers: lineParsers(DEFAULT_SETTINGS), name: namesOutsideIndex('test.md'),
    });
    return { sections, bodyStartLine: outline.bodyStart, outline, tasks };
}

function buildFromBody(bodyLines: string[]): Read {
    return read(bodyLines);
}

function buildWithFrontmatter(lines: string[]): Read {
    return read(lines);
}

/** A row as these tests look at it: its line, its subtree's lines, and its child rows. */
interface RowView {
    line: number;
    rawLine: string;
    childRawLines: string[];
    childRows: RowView[];
}

function view(doc: Read, task: Task): RowView {
    const { lines } = doc.outline;
    return {
        line: task.line,
        rawLine: lines[task.line],
        childRawLines: lines.slice(task.line + 1, doc.outline.subtreeEnd(task.line)),
        childRows: doc.tasks.filter(child => child.parentId === task.id).map(child => view(doc, child)),
    };
}

/** A section's own property lines, as `[key, written value]`. */
function entries(section: SectionNode): [string, string][] {
    return section.properties.lines.map(line => [line.key, line.written]);
}

/** The top-level rows whose innermost section is `section`. */
function blocksOf(doc: Read, section: SectionNode): RowView[] {
    return doc.tasks
        .filter(task => task.parentId === undefined && NoteSections.at(doc.sections, task.line) === section)
        .map(task => view(doc, task));
}

describe('NoteSections', () => {
    describe('節の木', () => {
        it('見出しなし → 暗黙ルートセクション1つ', () => {
            const doc = buildFromBody([
                '- [ ] task1 @2026-03-24',
                '- [ ] task2 @2026-03-25',
            ]);
            expect(doc.sections).toHaveLength(1);
            expect(doc.sections[0].heading).toBeNull();
            expect(doc.sections[0].startLine).toBe(0);
            expect(doc.sections[0].endLine).toBe(2);
        });

        it('単一見出し → 1セクション', () => {
            const doc = buildFromBody([
                '## Section',
                '- [ ] task @2026-03-24',
            ]);
            expect(doc.sections).toHaveLength(1);
            expect(doc.sections[0].heading!.level).toBe(2);
            expect(doc.sections[0].heading!.text).toBe('Section');
            expect(doc.sections[0].heading!.line).toBe(0);
        });

        it('見出し前に行がある → 暗黙ルート + 名前付きセクション', () => {
            const doc = buildFromBody([
                'Some text',
                '- [ ] orphan @2026-03-24',
                '## Section',
                '- [ ] task @2026-03-25',
            ]);
            expect(doc.sections).toHaveLength(2);
            expect(doc.sections[0].heading).toBeNull();
            expect(doc.sections[0].startLine).toBe(0);
            expect(doc.sections[0].endLine).toBe(2);
            expect(doc.sections[1].heading!.text).toBe('Section');
        });

        it('同レベルの見出し → 兄弟セクション', () => {
            const doc = buildFromBody([
                '## A',
                '- [ ] task1 @2026-03-24',
                '## B',
                '- [ ] task2 @2026-03-25',
            ]);
            expect(doc.sections).toHaveLength(2);
            expect(doc.sections[0].heading!.text).toBe('A');
            expect(doc.sections[0].endLine).toBe(2);
            expect(doc.sections[1].heading!.text).toBe('B');
        });

        it('ネストした見出し → 子セクション', () => {
            const doc = buildFromBody([
                '## Parent',
                '- [ ] parent task @2026-03-24',
                '### Child',
                '- [ ] child task @2026-03-25',
            ]);
            expect(doc.sections).toHaveLength(1);
            expect(doc.sections[0].heading!.text).toBe('Parent');
            expect(doc.sections[0].children).toHaveLength(1);
            expect(doc.sections[0].children[0].heading!.text).toBe('Child');
        });

        it('深いネスト: ## → ### → ####', () => {
            const doc = buildFromBody([
                '## L2',
                '### L3',
                '#### L4',
                '- [ ] deep @2026-03-24',
            ]);
            expect(doc.sections).toHaveLength(1);
            const l2 = doc.sections[0];
            expect(l2.heading!.level).toBe(2);
            expect(l2.children).toHaveLength(1);
            const l3 = l2.children[0];
            expect(l3.heading!.level).toBe(3);
            expect(l3.children).toHaveLength(1);
            const l4 = l3.children[0];
            expect(l4.heading!.level).toBe(4);
        });

        it('ネスト後に同レベルに戻る: ## → ### → ##', () => {
            const doc = buildFromBody([
                '## A',
                '### A1',
                '- [ ] a1 @2026-03-24',
                '## B',
                '- [ ] b @2026-03-25',
            ]);
            expect(doc.sections).toHaveLength(2);
            expect(doc.sections[0].heading!.text).toBe('A');
            expect(doc.sections[0].children).toHaveLength(1);
            expect(doc.sections[0].children[0].heading!.text).toBe('A1');
            expect(doc.sections[1].heading!.text).toBe('B');
            expect(doc.sections[1].children).toHaveLength(0);
        });

        it('endLine が子孫の範囲を含む（3段ネスト）', () => {
            const doc = buildFromBody([
                '## L2',       // 0
                '### L3',      // 1
                '#### L4',     // 2
                '- [ ] deep @2026-03-24', // 3
            ]);
            const l2 = doc.sections[0];
            const l3 = l2.children[0];
            const l4 = l3.children[0];
            expect(l2.endLine).toBe(4);
            expect(l3.endLine).toBe(4);
            expect(l4.endLine).toBe(4);
        });

        it('兄弟孫セクション間の endLine', () => {
            const doc = buildFromBody([
                '## Parent',   // 0
                '### Child',   // 1
                '#### GrandA', // 2
                '- [ ] a @2026-03-24', // 3
                '#### GrandB', // 4
                '- [ ] b @2026-03-25', // 5
            ]);
            const parent = doc.sections[0];
            const child = parent.children[0];
            expect(parent.endLine).toBe(6);
            expect(child.endLine).toBe(6);
            expect(child.children[0].endLine).toBe(4); // GrandA
            expect(child.children[1].endLine).toBe(6); // GrandB
        });

        it('frontmatter offset を考慮', () => {
            const lines = [
                '---',
                'tv-color: red',
                '---',
                '## Section',
                '- [ ] task @2026-03-24',
            ];
            const doc = buildWithFrontmatter(lines);
            expect(doc.bodyStartLine).toBe(3);
            expect(doc.sections).toHaveLength(1);
            expect(doc.sections[0].heading!.line).toBe(3);
        });
    });

    describe('節のタスクとプロパティ', () => {
        it('タスクブロックを検出', () => {
            const doc = buildFromBody([
                '## Section',
                '- [ ] task @2026-03-24',
            ]);
            const blocks = blocksOf(doc, doc.sections[0]);
            expect(blocks).toHaveLength(1);
            const tb = blocks[0];
            expect(tb.rawLine).toBe('- [ ] task @2026-03-24');
            expect(tb.line).toBe(1);
        });

        it('タスクブロックの子行を収集', () => {
            const doc = buildFromBody([
                '- [ ] parent @2026-03-24',
                '    - [ ] child @2026-03-25',
                '    - note:: something',
            ]);
            const tb = blocksOf(doc, doc.sections[0])[0];
            expect(tb.childRawLines).toHaveLength(2);
            expect(tb.childRawLines[0]).toBe('    - [ ] child @2026-03-25');
            expect(tb.childRawLines[1]).toBe('    - note:: something');
        });

        // コードフェンス内の `- [ ]` はサンプルテキストであってタスクではない。
        // ただし subtree の一部ではあるので childRawLines には残る（move /
        // duplicate で verbatim に運ばれる必要があるため）。
        it('フェンス内のチェックボックス風行をタスクとして拾わない（トップレベル）', () => {
            const doc = buildFromBody([
                '```md',
                '- [ ] fenced sample @2026-03-24',
                '```',
                '- [ ] real task @2026-03-25',
            ]);
            const blocks = blocksOf(doc, doc.sections[0]);
            expect(blocks).toHaveLength(1);
            expect(blocks[0].rawLine).toBe('- [ ] real task @2026-03-25');
        });

        it('フェンス内のチェックボックス風行を子タスクにしない（childRawLines には残る）', () => {
            const doc = buildFromBody([
                '- [ ] parent @2026-03-24',
                '    ```md',
                '    - [ ] fenced sample @2026-03-25',
                '    ```',
                '    - [ ] real child @2026-03-26',
            ]);
            const tb = blocksOf(doc, doc.sections[0])[0];
            expect(tb.childRawLines).toHaveLength(4);
            expect(tb.childRawLines[1]).toBe('    - [ ] fenced sample @2026-03-25');
            expect(tb.childRows).toHaveLength(1);
            expect(tb.childRows[0].rawLine).toBe('    - [ ] real child @2026-03-26');
        });

        it('フェンス内のタスク行で lead area を打ち切らない', () => {
            const doc = buildFromBody([
                '## Section',
                '- tv-color:: ffffff',
                '```md',
                '- [ ] fenced sample',
                '```',
                '- tags:: work',
                '- [ ] real task @2026-03-24',
            ]);
            const section = doc.sections[0];
            expect(entries(section).map(([key]) => key)).toEqual(['tv-color', 'tags']);
            expect(blocksOf(doc, section)).toHaveLength(1);
        });

        // タブ字下げのフェンス。Obsidian の既定インデントはタブなので、
        // サブツリー内フェンスの実運用上いちばん多い形。
        it('タブ字下げされたサブツリー内フェンスも認識する', () => {
            const doc = buildFromBody([
                '- [ ] parent @2026-03-24',
                '\t```md',
                '\t- [ ] fenced sample @2026-03-25',
                '\t```',
                '\t- [ ] real child @2026-03-26',
            ]);
            const tb = blocksOf(doc, doc.sections[0])[0];
            expect(tb.childRawLines).toHaveLength(4);
            expect(tb.childRows).toHaveLength(1);
            expect(tb.childRows[0].rawLine).toBe('\t- [ ] real child @2026-03-26');
        });

        it('チルダフェンスにも対応する', () => {
            const doc = buildFromBody([
                '~~~',
                '- [ ] fenced sample',
                '~~~',
                '- [ ] real task @2026-03-24',
            ]);
            expect(blocksOf(doc, doc.sections[0])).toHaveLength(1);
        });

        it('子タスクブロックを再帰的に検出', () => {
            const doc = buildFromBody([
                '- [ ] parent @2026-03-24',
                '    - [ ] child @2026-03-25',
                '        - tv-color:: 333333',
            ]);
            const tb = blocksOf(doc, doc.sections[0])[0];
            expect(tb.childRows).toHaveLength(1);
            expect(tb.childRows[0].rawLine).toBe('    - [ ] child @2026-03-25');
            expect(tb.childRows[0].childRawLines).toHaveLength(1);
        });

        it('フラット形式のプロパティブロックを検出', () => {
            const doc = buildFromBody([
                '## Section',
                '- tv-color:: ffffff',
                '- custom-prop:: 2000',
                '- [ ] task @2026-03-24',
            ]);
            expect(entries(doc.sections[0])).toEqual([['tv-color', 'ffffff'], ['custom-prop', '2000']]);
            expect(doc.sections[0].head).toBe(3);
        });

        it('`- properties::` はまとめの形でなく、ふつうのプロパティ行で、下の項目はそのリストの項目', () => {
            const doc = buildFromBody([
                '## Section',
                '- properties::',
                '    - tv-color:: ffffff',
                '    - custom-prop:: 2000',
                '- [ ] task @2026-03-24',
            ]);
            const [line] = doc.sections[0].properties.lines;
            expect(entries(doc.sections[0])).toEqual([['properties', '']]);
            expect(line.value).toEqual({ type: 'list', items: [
                { type: 'text', text: 'tv-color:: ffffff', spelling: 'tv-color:: ffffff' },
                { type: 'text', text: 'custom-prop:: 2000', spelling: 'custom-prop:: 2000' },
            ] });
            expect(doc.sections[0].head).toBe(4);
        });

        it('プロパティなしのセクション → プロパティ行なし、頭は見出しのすぐ下', () => {
            const doc = buildFromBody([
                '## Section',
                '- [ ] task @2026-03-24',
            ]);
            expect(entries(doc.sections[0])).toEqual([]);
            expect(doc.sections[0].head).toBe(1);
        });

        it('最初のタスクより下のプロパティ行も節のもの。頭は最初のタスクより上の行の後ろ', () => {
            const doc = buildFromBody([
                '## Section',
                '- tv-color:: red',
                '- [ ] task @2026-03-24',
                '- custom:: after-task',
            ]);
            expect(entries(doc.sections[0])).toEqual([['tv-color', 'red'], ['custom', 'after-task']]);
            expect(doc.sections[0].head).toBe(2);
            // text/property 行は block にしない: タスクのみ
            expect(blocksOf(doc, doc.sections[0])).toHaveLength(1);
        });

        it('空行を挟んだプロパティも収集 (Markdown loose list)', () => {
            const doc = buildFromBody([
                '## Section',
                '- tv-color:: red',
                '',
                '- custom:: after-blank',
                '- [ ] task @2026-03-24',
            ]);
            expect(entries(doc.sections[0])).toEqual([['tv-color', 'red'], ['custom', 'after-blank']]);
        });

        it('見出し直後の空行を挟んでも property block を検出', () => {
            const doc = buildFromBody([
                '## Section',
                '',
                '- tv-color:: red',
                '- custom:: value',
                '- [ ] task @2026-03-24',
            ]);
            expect(entries(doc.sections[0])).toHaveLength(2);
            expect(doc.sections[0].head).toBe(4);
        });

        it('連続する複数空行を許容', () => {
            const doc = buildFromBody([
                '## Section',
                '',
                '',
                '- tv-color:: red',
                '',
                '',
                '- custom:: value',
                '- [ ] task @2026-03-24',
            ]);
            expect(entries(doc.sections[0])).toHaveLength(2);
        });

        it('wikilink 行を挟んだ property も拾う', () => {
            const doc = buildFromBody([
                '## Section',
                '- tv-color:: red',
                '- [[wiki-target]]',
                '- custom:: still-collected',
                '- [ ] task @2026-03-24',
            ]);
            expect(entries(doc.sections[0]).map(([key]) => key)).toEqual(['tv-color', 'custom']);
        });

        it('plain text を挟んだ property も拾う', () => {
            const doc = buildFromBody([
                '## Section',
                '- tv-color:: red',
                'plain paragraph text',
                '- custom:: still-collected',
                '- [ ] task @2026-03-24',
            ]);
            expect(entries(doc.sections[0]).map(([key]) => key)).toEqual(['tv-color', 'custom']);
        });

        it('テキスト行のみのセクション → block もプロパティ行も作らない', () => {
            const doc = buildFromBody([
                '## Section',
                'Some paragraph text',
                'More text',
                '- [ ] task @2026-03-24',
            ]);
            expect(entries(doc.sections[0])).toEqual([]);
            // text 行は block 化しない: タスクのみ
            expect(blocksOf(doc, doc.sections[0])).toHaveLength(1);
        });

        it('暗黙ルートの末尾の property も根の節のもの', () => {
            const doc = buildFromBody([
                '- root_tag:: alpha',
                '- [ ] preTask @2026-05-27T10:00',
                '- post_tag:: beta',
            ]);
            expect(entries(doc.sections[0]).map(([key]) => key)).toEqual(['root_tag', 'post_tag']);
        });

        it('インデントされた property 行は section に昇格しない (indent 0 のみ)', () => {
            const doc = buildFromBody([
                '## Section',
                '- [[wiki-target]]',
                '    - sub:: nested',
                '- tv-color:: red',
                '- [ ] task @2026-03-24',
            ]);
            expect(entries(doc.sections[0])).toEqual([['tv-color', 'red']]);
        });

        it('ネストセクションのブロックが正しく分離', () => {
            const doc = buildFromBody([
                '## Parent',
                '- [ ] parent-task @2026-03-24',
                '### Child',
                '- [ ] child-task @2026-03-25',
            ]);
            const parent = doc.sections[0];
            const child = parent.children[0];
            expect(blocksOf(doc, parent)).toHaveLength(1);
            expect(blocksOf(doc, parent)[0].rawLine).toBe('- [ ] parent-task @2026-03-24');
            expect(blocksOf(doc, child)).toHaveLength(1);
            expect(blocksOf(doc, child)[0].rawLine).toBe('- [ ] child-task @2026-03-25');
        });

        it('3段ネストでブロックが正しく分離（孫のプロパティが親に漏れない）', () => {
            const doc = buildFromBody([
                '## Expenses',                        // 0
                '- [ ] expense @2026-03-24',          // 1
                '### EPOS',                            // 2
                '#### 普通',                           // 3
                '- [ ] normal @2026-03-25',           // 4
                '#### 特殊',                           // 5
                '- tags:: #出/クレカ/EPOS',            // 6
                '- [ ] special @2026-03-26',          // 7
                '### りそな',                          // 8
                '- tags:: #出/りそな',                 // 9
                '- [ ] risona @2026-03-27',           // 10
            ]);
            const expenses = doc.sections[0];
            const epos = expenses.children[0];
            const normal = epos.children[0];
            const special = epos.children[1];
            const risona = expenses.children[1];

            // Expenses 自身は 1 タスクのみ、プロパティ行なし
            expect(blocksOf(doc, expenses)).toHaveLength(1);
            expect(blocksOf(doc, expenses)[0].rawLine).toContain('expense');
            expect(entries(expenses)).toEqual([]);

            // EPOS 自身はタスクなし・プロパティなし
            expect(blocksOf(doc, epos)).toHaveLength(0);
            expect(entries(epos)).toEqual([]);

            // #### 普通 に 1 タスク
            expect(blocksOf(doc, normal)).toHaveLength(1);
            expect(blocksOf(doc, normal)[0].rawLine).toContain('normal');

            // #### 特殊 に tags プロパティ + 1 タスク
            expect(entries(special)).toEqual([['tags', '#出/クレカ/EPOS']]);
            expect(blocksOf(doc, special)).toHaveLength(1);
            expect(blocksOf(doc, special)[0].rawLine).toContain('special');

            // ### りそな に tags プロパティ + 1 タスク
            expect(entries(risona)).toEqual([['tags', '#出/りそな']]);
            expect(blocksOf(doc, risona)).toHaveLength(1);
            expect(blocksOf(doc, risona)[0].rawLine).toContain('risona');
        });
    });

    describe('見出しの読み（Outline.headings）', () => {
        it('setext の見出しと 1〜3 字下げの ATX でも節を区切る', () => {
            const doc = buildFromBody([
                '- p:: root',
                '',
                'Setext',
                '---',
                '- [ ] a @2026-03-24',
                '',
                ' ## Indented ##',
                '- [ ] b @2026-03-25',
            ]);
            expect(doc.sections.map(s => s.heading && { level: s.heading.level, text: s.heading.text, line: s.heading.line }))
                .toEqual([null, { level: 2, text: 'Setext', line: 2 }, { level: 2, text: 'Indented', line: 6 }]);
            expect(doc.sections[0].endLine).toBe(2);
            expect(blocksOf(doc, doc.sections[1]).map(b => b.rawLine)).toEqual(['- [ ] a @2026-03-24']);
        });

        it('項目の中の見出しでは節を区切らない', () => {
            const doc = buildFromBody([
                '- [ ] a @2026-03-24',
                '  ## Inside',
                '- [ ] b @2026-03-25',
            ]);
            expect(doc.sections).toHaveLength(1);
            expect(doc.sections[0].heading).toBeNull();
        });
    });
});
