import type { DocumentNode, SectionNode, BlockNode, PropertyBlockEntry, TaskBlock } from './DocumentTree';
import { ChildLineClassifier } from '../utils/ChildLineClassifier';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';
import { IN_LINE } from '../../../utils/LineBreak';
import { INDENT_SOURCE, Outline, type OutlineReading } from '../utils/Outline';
import { SPACE_OR_TAB_SOURCE } from '../utils/ListMarker';

/**
 * A markdown heading line: capture group 1 = `#` run, group 2 = title text.
 *
 * No trailing `$` anchor — callers must pass a single line with no embedded
 * newline (DocumentTreeBuilder does: it splits the document into lines before
 * matching). Matching this against a string that can contain `\n` would let
 * group 2 swallow past the line the caller thinks it matched.
 */
export const HEADING_REGEX = new RegExp(`^(#{1,6})${SPACE_OR_TAB_SOURCE}+(${IN_LINE}*)`);
const PROPERTY_GROUP_HEADER = new RegExp(`^${INDENT_SOURCE}-${SPACE_OR_TAB_SOURCE}+properties::\\s*$`);

/**
 * Markdown ファイルの行配列からドキュメント構造ツリーを構築する。
 * 2パス: Pass 1 でセクション階層、Pass 2 でブロック分類。
 */
export class DocumentTreeBuilder {
    static build(
        filePath: string,
        lines: string[],
        bodyStartLine: number,
        outline: OutlineReading = Outline.read(lines),
    ): DocumentNode {
        // One reading of the whole note (`Outline.read`), asked by absolute
        // line number: a `- [ ]` in a code block is sample text, not a task,
        // and a `# comment` in one is no heading; a task's subtree is the
        // item it opens. No part below reads a slice of the note on its own:
        // a slice loses the items it stands in, and reads differently.
        const fenceMask = outline.codeMask();
        const bodyLines = lines.slice(bodyStartLine);
        const sections = this.buildSectionTree(bodyLines, bodyStartLine, fenceMask);
        for (const section of this.flattenSections(sections)) {
            this.classifyBlocks(section, lines, outline);
        }
        return { filePath, bodyStartLine, sections, outline };
    }

    // ── Pass 1: セクションツリー構築 ──

    private static buildSectionTree(bodyLines: string[], bodyStartLine: number, fenceMask: boolean[]): SectionNode[] {
        const headings: { level: number; text: string; line: number }[] = [];

        for (let i = 0; i < bodyLines.length; i++) {
            // A heading-like line in a fence is code: splitting a section there
            // cut the subtree of the task the fence stands under, and a write
            // carried lines the parser gave to no one.
            if (fenceMask[bodyStartLine + i]) continue;
            const m = bodyLines[i].match(HEADING_REGEX);
            if (m) {
                headings.push({ level: m[1].length, text: m[2].trim(), line: bodyStartLine + i });
            }
        }

        const totalEndLine = bodyStartLine + bodyLines.length;

        // 見出しがない場合: 暗黙ルートセクションのみ
        if (headings.length === 0) {
            return [this.createSection(null, bodyStartLine, totalEndLine)];
        }

        const result: SectionNode[] = [];

        // 最初の見出し前に行がある場合: 暗黙ルートセクション
        if (headings[0].line > bodyStartLine) {
            result.push(this.createSection(null, bodyStartLine, headings[0].line));
        }

        // 各見出しからセクションを作成
        const sectionsByLine = new Map<number, SectionNode>();
        for (let i = 0; i < headings.length; i++) {
            const h = headings[i];
            const endLine = i + 1 < headings.length ? headings[i + 1].line : totalEndLine;
            const section = this.createSection(
                { level: h.level, text: h.text, line: h.line },
                h.line,
                endLine
            );
            sectionsByLine.set(h.line, section);
        }

        // ネスト構築: スタックベース
        const stack: SectionNode[] = [];
        for (const h of headings) {
            const section = sectionsByLine.get(h.line)!;
            // スタックからこの見出しレベル以上のものをポップ
            while (stack.length > 0 && stack[stack.length - 1].heading!.level >= h.level) {
                stack.pop();
            }
            if (stack.length > 0) {
                const parent = stack[stack.length - 1];
                parent.children.push(section);
                // 親の endLine を調整（子を含む範囲は変わらないが、
                // 親の直接ブロック範囲から子の範囲を除外するのは classifyBlocks で処理）
            } else {
                result.push(section);
            }
            stack.push(section);
        }

        this.adjustEndLines(result);
        return result;
    }

    /** ツリー構築後に endLine を子孫の最大値に調整する（ボトムアップ） */
    private static adjustEndLines(sections: SectionNode[]): void {
        for (const section of sections) {
            this.adjustEndLines(section.children);
            if (section.children.length > 0) {
                const lastChild = section.children[section.children.length - 1];
                section.endLine = Math.max(section.endLine, lastChild.endLine);
            }
        }
    }

    private static createSection(
        heading: { level: number; text: string; line: number } | null,
        startLine: number,
        endLine: number
    ): SectionNode {
        return {
            heading,
            propertyBlock: null,
            resolvedProperties: {},
            blocks: [],
            children: [],
            startLine,
            endLine,
        };
    }

    // ── Pass 2: ブロック分類 ──
    //
    // セクションごとに 2 ステップで処理する:
    //   Step A: collectSectionProperties — lead area 内の同レベル property を集約
    //   Step B: classifyTaskBlocks       — own range 内の task 行を TaskBlock 化
    // 両者は独立しており、property は「セクションの属性」、block 列は task 専用。

    private static classifyBlocks(
        section: SectionNode,
        allLines: string[],
        outline: OutlineReading
    ): void {
        const ownRanges = this.getOwnLineRanges(section);
        if (ownRanges.length === 0) return;

        // ── Step A: lead area の property 収集 ──
        section.propertyBlock = this.collectSectionProperties(section, allLines, ownRanges, outline);

        // ── Step B: own range 内の task block 検出 ──
        section.blocks = this.classifyTaskBlocks(section, allLines, ownRanges, outline);
    }

    /**
     * セクションの lead area からプロパティを収集する。
     *
     * Lead area = ヘッダー直後（または暗黙ルートの先頭）〜 最初のタスク行直前。
     * 子セクション範囲は ownRanges 計算時点で既に除外済み。
     *
     * Lead area 内の **indent 0 の** `- key:: value` 行をすべて entries に集約する
     * （テキスト・wikilink・空行・インデントされたリスト項目を挟んでもよい）。
     * `- properties::` グループ形式 (indent 0) の部分木の entry も吸収する。
     * コードの中の行はプロパティにならない。
     *
     * 最初のタスク行が出現した時点で打ち切り。これにより:
     *   - 後方のタスクメモが前方のタスクへ遡及しない
     *   - 暗黙ルートの末尾が暴走しない
     *
     * indent 0 固定の理由: File 層 (frontmatter top-level) との対称、および
     * 「wikilink 直下の sub-bullet `- key:: value`」のような視覚的に
     * セクションプロパティに見えないものを誤って拾わないため。
     */
    private static collectSectionProperties(
        section: SectionNode,
        allLines: string[],
        ownRanges: [number, number][],
        outline: OutlineReading
    ): { entries: PropertyBlockEntry[] } | null {
        const leadLines = this.collectLeadAreaLines(section, allLines, ownRanges, outline);
        if (leadLines.length === 0) return null;

        const entries: PropertyBlockEntry[] = [];
        const take = (lineNum: number) => {
            const propMatch = allLines[lineNum].match(ChildLineClassifier.PROPERTY_LINE);
            if (propMatch) {
                entries.push({ key: propMatch[1].trim(), value: propMatch[2].trim(), line: lineNum });
            }
        };

        for (let idx = 0; idx < leadLines.length; idx++) {
            const lineNum = leadLines[idx];
            const line = allLines[lineNum];
            if (outline.inCode(lineNum) || Outline.isBlank(line)) continue;
            if (Outline.depthOf(line) !== 0) continue;

            // グループ形式: `- properties::` の部分木の entry を吸収
            if (PROPERTY_GROUP_HEADER.test(line) && outline.item(lineNum)) {
                const end = outline.subtreeEnd(lineNum);
                let j = idx + 1;
                for (; j < leadLines.length && leadLines[j] < end; j++) {
                    if (!outline.inCode(leadLines[j])) take(leadLines[j]);
                }
                idx = j - 1;
                continue;
            }

            // フラット形式: `- key:: value`
            // それ以外（text / wikilink / 通常 bullet）は読み飛ばすだけで打ち切らない
            take(lineNum);
        }

        return entries.length > 0 ? { entries } : null;
    }

    /**
     * Lead area の行番号配列を返す。ownRanges を順に走査し、見出し行を除外しつつ
     * 最初のタスク行が出現したらそこで打ち切る。
     */
    private static collectLeadAreaLines(
        section: SectionNode,
        allLines: string[],
        ownRanges: [number, number][],
        outline: OutlineReading
    ): number[] {
        const leadLines: number[] = [];
        for (const [rangeStart, rangeEnd] of ownRanges) {
            for (let i = rangeStart; i < rangeEnd; i++) {
                if (section.heading && i === section.heading.line) continue;
                if (TaskLineClassifier.opensTask(outline, i)) {
                    return leadLines;
                }
                leadLines.push(i);
            }
        }
        return leadLines;
    }

    /**
     * Own range 内のタスク行を走査し、TaskBlock 配列を生成する。
     * Property 行・空行・テキスト行はスキップ（block にはしない）。
     */
    private static classifyTaskBlocks(
        section: SectionNode,
        allLines: string[],
        ownRanges: [number, number][],
        outline: OutlineReading
    ): BlockNode[] {
        const blocks: BlockNode[] = [];
        for (const [rangeStart, rangeEnd] of ownRanges) {
            let i = rangeStart;
            while (i < rangeEnd) {
                if (section.heading && i === section.heading.line) { i++; continue; }
                if (TaskLineClassifier.opensTask(outline, i)) {
                    const taskBlock = this.collectBlock(allLines, outline, i, rangeEnd);
                    blocks.push(taskBlock);
                    i = taskBlock.line + 1 + taskBlock.childRawLines.length;
                } else {
                    i++;
                }
            }
        }
        return blocks;
    }

    /** セクション自身の行範囲（子セクション範囲を除外） */
    private static getOwnLineRanges(section: SectionNode): [number, number][] {
        if (section.children.length === 0) {
            return [[section.startLine, section.endLine]];
        }

        const ranges: [number, number][] = [];
        let current = section.startLine;
        for (const child of section.children) {
            if (current < child.startLine) {
                ranges.push([current, child.startLine]);
            }
            current = child.endLine;
        }
        if (current < section.endLine) {
            ranges.push([current, section.endLine]);
        }
        return ranges;
    }

    /**
     * The task block at absolute line `row`: the task line and its subtree
     * as the outline reads it (`OutlineReading.subtreeEnd`), no further than
     * `limit` (the section's range), and the task blocks directly under it —
     * the tasks in the subtree with no task between.
     */
    private static collectBlock(
        allLines: string[],
        outline: OutlineReading,
        row: number,
        limit: number
    ): TaskBlock {
        const rawLine = allLines[row];
        const end = Math.min(outline.subtreeEnd(row), limit);
        const childRawLines = allLines.slice(row + 1, end);
        const childLineNumbers: number[] = [];
        for (let i = row + 1; i < end; i++) childLineNumbers.push(i);

        // Code lines stay in childRawLines (they are part of the subtree
        // body and must survive moves verbatim) but are never interpreted as
        // notation — neither as tasks nor as `- ==>` flow lines.

        const childTaskBlocks: TaskBlock[] = [];
        let i = row + 1;
        while (i < end) {
            if (TaskLineClassifier.opensTask(outline, i)) {
                const childBlock = this.collectBlock(allLines, outline, i, end);
                childTaskBlocks.push(childBlock);
                i += 1 + childBlock.childRawLines.length;
            } else {
                i++;
            }
        }

        return {
            type: 'task-block',
            line: row,
            rawLine,
            indent: Outline.depthOf(rawLine),
            childRawLines,
            childLineNumbers,
            childTaskBlocks,
        };
    }

    /** セクションツリーをフラットなリストに展開 */
    private static flattenSections(sections: SectionNode[]): SectionNode[] {
        const result: SectionNode[] = [];
        const queue = [...sections];
        while (queue.length > 0) {
            const section = queue.shift()!;
            result.push(section);
            queue.push(...section.children);
        }
        return result;
    }
}
