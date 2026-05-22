import { describe, it, expect } from 'vitest';
import { DocumentTreeBuilder } from '../../../../src/services/parsing/tree/DocumentTreeBuilder';

function buildFromBody(bodyLines: string[]): ReturnType<typeof DocumentTreeBuilder.build> {
    return DocumentTreeBuilder.build('test.md', bodyLines, 0);
}

function buildWithFrontmatter(lines: string[]): ReturnType<typeof DocumentTreeBuilder.build> {
    // frontmatter: lines 0-2 (---, key: val, ---)
    const bodyStart = lines.indexOf('---', 1) + 1;
    return DocumentTreeBuilder.build('test.md', lines, bodyStart);
}

describe('DocumentTreeBuilder', () => {
    describe('Pass 1: セクションツリー構築', () => {
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

    describe('Pass 2: ブロック分類', () => {
        it('タスクブロックを検出', () => {
            const doc = buildFromBody([
                '## Section',
                '- [ ] task @2026-03-24',
            ]);
            const blocks = doc.sections[0].blocks;
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe('task-block');
            const tb = blocks[0] as any;
            expect(tb.rawLine).toBe('- [ ] task @2026-03-24');
            expect(tb.line).toBe(1);
        });

        it('タスクブロックの子行を収集', () => {
            const doc = buildFromBody([
                '- [ ] parent @2026-03-24',
                '    - [ ] child @2026-03-25',
                '    - note:: something',
            ]);
            const tb = doc.sections[0].blocks[0] as any;
            expect(tb.childRawLines).toHaveLength(2);
            expect(tb.childRawLines[0]).toBe('    - [ ] child @2026-03-25');
            expect(tb.childRawLines[1]).toBe('    - note:: something');
        });

        it('子タスクブロックを再帰的に検出', () => {
            const doc = buildFromBody([
                '- [ ] parent @2026-03-24',
                '    - [ ] child @2026-03-25',
                '        - tv-color:: 333333',
            ]);
            const tb = doc.sections[0].blocks[0] as any;
            expect(tb.childTaskBlocks).toHaveLength(1);
            expect(tb.childTaskBlocks[0].rawLine).toBe('    - [ ] child @2026-03-25');
            expect(tb.childTaskBlocks[0].childRawLines).toHaveLength(1);
        });

        it('フラット形式のプロパティブロックを検出', () => {
            const doc = buildFromBody([
                '## Section',
                '- tv-color:: ffffff',
                '- custom-prop:: 2000',
                '- [ ] task @2026-03-24',
            ]);
            expect(doc.sections[0].propertyBlock).not.toBeNull();
            const pb = doc.sections[0].propertyBlock!;
            expect(pb.entries).toHaveLength(2);
            expect(pb.entries[0].key).toBe('tv-color');
            expect(pb.entries[0].value).toBe('ffffff');
            expect(pb.entries[1].key).toBe('custom-prop');
            expect(pb.entries[1].value).toBe('2000');
        });

        it('グループ形式のプロパティブロックを検出', () => {
            const doc = buildFromBody([
                '## Section',
                '- properties::',
                '    - tv-color:: ffffff',
                '    - custom-prop:: 2000',
                '- [ ] task @2026-03-24',
            ]);
            expect(doc.sections[0].propertyBlock).not.toBeNull();
            const pb = doc.sections[0].propertyBlock!;
            expect(pb.entries).toHaveLength(2);
            expect(pb.entries[0].key).toBe('tv-color');
            expect(pb.entries[0].value).toBe('ffffff');
        });

        it('混合形式（フラット + グループ）', () => {
            const doc = buildFromBody([
                '## Section',
                '- tv-color:: ffffff',
                '- properties::',
                '    - custom-prop:: 2000',
                '    - tv-linestyle:: dashed',
                '- [ ] task @2026-03-24',
            ]);
            const pb = doc.sections[0].propertyBlock!;
            expect(pb.entries).toHaveLength(3);
            expect(pb.entries[0].key).toBe('tv-color');
            expect(pb.entries[1].key).toBe('custom-prop');
            expect(pb.entries[2].key).toBe('tv-linestyle');
        });

        it('プロパティなしのセクション → propertyBlock = null', () => {
            const doc = buildFromBody([
                '## Section',
                '- [ ] task @2026-03-24',
            ]);
            expect(doc.sections[0].propertyBlock).toBeNull();
        });

        it('最初のタスク行で property 収集が打ち切られる (タスク後の property は section に昇格しない)', () => {
            const doc = buildFromBody([
                '## Section',
                '- tv-color:: red',
                '- [ ] task @2026-03-24',
                '- custom:: after-task',
            ]);
            const pb = doc.sections[0].propertyBlock!;
            expect(pb.entries).toHaveLength(1);
            expect(pb.entries[0].key).toBe('tv-color');
            // text/property 行は block にしない: タスクのみ
            expect(doc.sections[0].blocks).toHaveLength(1);
            expect(doc.sections[0].blocks[0].type).toBe('task-block');
        });

        it('空行を挟んだプロパティも収集 (Markdown loose list)', () => {
            const doc = buildFromBody([
                '## Section',
                '- tv-color:: red',
                '',
                '- custom:: after-blank',
                '- [ ] task @2026-03-24',
            ]);
            const pb = doc.sections[0].propertyBlock!;
            expect(pb.entries).toHaveLength(2);
            expect(pb.entries[0].key).toBe('tv-color');
            expect(pb.entries[1].key).toBe('custom');
        });

        it('見出し直後の空行を挟んでも property block を検出', () => {
            const doc = buildFromBody([
                '## Section',
                '',
                '- tv-color:: red',
                '- custom:: value',
                '- [ ] task @2026-03-24',
            ]);
            const pb = doc.sections[0].propertyBlock!;
            expect(pb).not.toBeNull();
            expect(pb.entries).toHaveLength(2);
        });

        it('見出し直後の空行 + group form でも検出', () => {
            const doc = buildFromBody([
                '## Section',
                '',
                '- properties::',
                '    - tv-color:: red',
                '    - custom:: value',
                '- [ ] task @2026-03-24',
            ]);
            const pb = doc.sections[0].propertyBlock!;
            expect(pb).not.toBeNull();
            expect(pb.entries).toHaveLength(2);
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
            const pb = doc.sections[0].propertyBlock!;
            expect(pb.entries).toHaveLength(2);
        });

        it('wikilink 行を挟んだ property も拾う', () => {
            const doc = buildFromBody([
                '## Section',
                '- tv-color:: red',
                '- [[wiki-target]]',
                '- custom:: still-collected',
                '- [ ] task @2026-03-24',
            ]);
            const pb = doc.sections[0].propertyBlock!;
            expect(pb.entries).toHaveLength(2);
            expect(pb.entries[0].key).toBe('tv-color');
            expect(pb.entries[1].key).toBe('custom');
        });

        it('plain text を挟んだ property も拾う', () => {
            const doc = buildFromBody([
                '## Section',
                '- tv-color:: red',
                'plain paragraph text',
                '- custom:: still-collected',
                '- [ ] task @2026-03-24',
            ]);
            const pb = doc.sections[0].propertyBlock!;
            expect(pb.entries).toHaveLength(2);
            expect(pb.entries[0].key).toBe('tv-color');
            expect(pb.entries[1].key).toBe('custom');
        });

        it('テキスト行のみのセクション → block も propertyBlock も作らない', () => {
            const doc = buildFromBody([
                '## Section',
                'Some paragraph text',
                'More text',
                '- [ ] task @2026-03-24',
            ]);
            expect(doc.sections[0].propertyBlock).toBeNull();
            // text 行は block 化しない: タスクのみ
            expect(doc.sections[0].blocks).toHaveLength(1);
            expect(doc.sections[0].blocks[0].type).toBe('task-block');
        });

        it('暗黙ルートで末尾の property は拾わない (タスク以降は遡及しない)', () => {
            const doc = buildFromBody([
                '- root_tag:: alpha',
                '- [ ] preTask @2026-05-27T10:00',
                '- post_tag:: beta',
            ]);
            const pb = doc.sections[0].propertyBlock!;
            expect(pb.entries).toHaveLength(1);
            expect(pb.entries[0].key).toBe('root_tag');
        });

        it('インデントされた property 行は section に昇格しない (indent 0 のみ)', () => {
            const doc = buildFromBody([
                '## Section',
                '- [[wiki-target]]',
                '    - sub:: nested',
                '- tv-color:: red',
                '- [ ] task @2026-03-24',
            ]);
            const pb = doc.sections[0].propertyBlock!;
            expect(pb.entries).toHaveLength(1);
            expect(pb.entries[0].key).toBe('tv-color');
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
            expect(parent.blocks).toHaveLength(1);
            expect((parent.blocks[0] as any).rawLine).toBe('- [ ] parent-task @2026-03-24');
            expect(child.blocks).toHaveLength(1);
            expect((child.blocks[0] as any).rawLine).toBe('- [ ] child-task @2026-03-25');
        });
    });
});
