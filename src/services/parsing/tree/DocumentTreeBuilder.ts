import type { DocumentNode, SectionNode, BlockNode, PropertyBlockEntry, TaskBlock } from './DocumentTree';
import { ChildLineClassifier } from '../utils/ChildLineClassifier';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';

const HEADING_REGEX = /^(#{1,6})\s+(.*)/;
const PROPERTY_GROUP_HEADER = /^\s*-\s+properties::\s*$/;

/**
 * Markdown ファイルの行配列からドキュメント構造ツリーを構築する。
 * 2パス: Pass 1 でセクション階層、Pass 2 でブロック分類。
 */
export class DocumentTreeBuilder {
    static build(
        filePath: string,
        lines: string[],
        bodyStartLine: number
    ): DocumentNode {
        const bodyLines = lines.slice(bodyStartLine);
        const sections = this.buildSectionTree(bodyLines, bodyStartLine);
        for (const section of this.flattenSections(sections)) {
            this.classifyBlocks(section, lines);
        }
        return { filePath, bodyStartLine, sections };
    }

    // ── Pass 1: セクションツリー構築 ──

    private static buildSectionTree(bodyLines: string[], bodyStartLine: number): SectionNode[] {
        const headings: { level: number; text: string; line: number }[] = [];

        for (let i = 0; i < bodyLines.length; i++) {
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

        return result;
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

    private static classifyBlocks(section: SectionNode, allLines: string[]): void {
        const ownRanges = this.getOwnLineRanges(section);
        if (ownRanges.length === 0) return;

        // ── Step A: lead area の property 収集 ──
        section.propertyBlock = this.collectSectionProperties(section, allLines, ownRanges);

        // ── Step B: own range 内の task block 検出 ──
        section.blocks = this.classifyTaskBlocks(section, allLines, ownRanges);
    }

    /**
     * セクションの lead area からプロパティを収集する。
     *
     * Lead area = ヘッダー直後（または暗黙ルートの先頭）〜 最初のタスク行直前。
     * 子セクション範囲は ownRanges 計算時点で既に除外済み。
     *
     * Lead area 内の **indent 0 の** `- key:: value` 行をすべて entries に集約する
     * （テキスト・wikilink・空行・インデントされたリスト項目を挟んでもよい）。
     * `- properties::` グループ形式 (indent 0) の直下インデント entry も吸収する。
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
        ownRanges: [number, number][]
    ): { entries: PropertyBlockEntry[] } | null {
        const leadLines = this.collectLeadAreaLines(section, allLines, ownRanges);
        if (leadLines.length === 0) return null;

        const entries: PropertyBlockEntry[] = [];

        for (let idx = 0; idx < leadLines.length; idx++) {
            const lineNum = leadLines[idx];
            const line = allLines[lineNum];
            if (line.trim() === '') continue;
            if (line.search(/\S|$/) !== 0) continue;

            // グループ形式: `- properties::` の直下の indented エントリを吸収
            if (PROPERTY_GROUP_HEADER.test(line)) {
                let j = idx + 1;
                while (j < leadLines.length) {
                    const childLine = allLines[leadLines[j]];
                    if (childLine.trim() === '') { j++; continue; }
                    const childIndent = childLine.search(/\S|$/);
                    if (childIndent === 0) break;
                    const propMatch = childLine.match(ChildLineClassifier.PROPERTY_LINE);
                    if (propMatch) {
                        entries.push({
                            key: propMatch[1].trim(),
                            value: propMatch[2].trim(),
                            line: leadLines[j],
                        });
                    }
                    j++;
                }
                idx = j - 1;
                continue;
            }

            // フラット形式: `- key:: value`
            const propMatch = line.match(ChildLineClassifier.PROPERTY_LINE);
            if (propMatch) {
                entries.push({
                    key: propMatch[1].trim(),
                    value: propMatch[2].trim(),
                    line: lineNum,
                });
            }
            // それ以外（text / wikilink / 通常 bullet）は読み飛ばすだけで打ち切らない
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
        ownRanges: [number, number][]
    ): number[] {
        const leadLines: number[] = [];
        for (const [rangeStart, rangeEnd] of ownRanges) {
            for (let i = rangeStart; i < rangeEnd; i++) {
                if (section.heading && i === section.heading.line) continue;
                if (TaskLineClassifier.isTaskLine(allLines[i])) {
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
        ownRanges: [number, number][]
    ): BlockNode[] {
        const blocks: BlockNode[] = [];
        for (const [rangeStart, rangeEnd] of ownRanges) {
            let i = rangeStart;
            while (i < rangeEnd) {
                if (section.heading && i === section.heading.line) { i++; continue; }
                const line = allLines[i];
                if (line.trim() === '') { i++; continue; }
                if (TaskLineClassifier.isTaskLine(line)) {
                    const taskBlock = this.collectTaskBlock(allLines, i, rangeEnd);
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

    /** タスクブロックを収集（タスク行 + インデントされた子行） */
    private static collectTaskBlock(
        allLines: string[],
        taskLine: number,
        rangeEnd: number
    ): TaskBlock {
        const rawLine = allLines[taskLine];
        const indent = rawLine.search(/\S|$/);
        const childRawLines: string[] = [];
        const childLineNumbers: number[] = [];
        let j = taskLine + 1;

        while (j < rangeEnd) {
            const nextLine = allLines[j];
            if (nextLine.trim() === '') break;
            const nextIndent = nextLine.search(/\S|$/);
            if (nextIndent > indent) {
                childRawLines.push(nextLine);
                childLineNumbers.push(j);
                j++;
            } else {
                break;
            }
        }

        // 再帰的に子タスクブロックを検出
        const childTaskBlocks: TaskBlock[] = [];
        let ci = 0;
        while (ci < childRawLines.length) {
            if (TaskLineClassifier.isTaskLine(childRawLines[ci])) {
                const childBlock = this.collectTaskBlockFromChildren(
                    childRawLines, childLineNumbers, ci
                );
                childTaskBlocks.push(childBlock);
                ci += 1 + childBlock.childRawLines.length;
            } else {
                ci++;
            }
        }

        return {
            type: 'task-block',
            line: taskLine,
            rawLine,
            indent,
            childRawLines,
            childLineNumbers,
            childTaskBlocks,
        };
    }

    /** 子行配列内でネストしたタスクブロックを収集 */
    private static collectTaskBlockFromChildren(
        childLines: string[],
        lineNumbers: number[],
        startIndex: number
    ): TaskBlock {
        const rawLine = childLines[startIndex];
        const indent = rawLine.search(/\S|$/);
        const nestedChildLines: string[] = [];
        const nestedLineNumbers: number[] = [];
        let j = startIndex + 1;

        while (j < childLines.length) {
            const nextLine = childLines[j];
            if (nextLine.trim() === '') break;
            const nextIndent = nextLine.search(/\S|$/);
            if (nextIndent > indent) {
                nestedChildLines.push(nextLine);
                nestedLineNumbers.push(lineNumbers[j]);
                j++;
            } else {
                break;
            }
        }

        // さらに再帰
        const childTaskBlocks: TaskBlock[] = [];
        let ci = 0;
        while (ci < nestedChildLines.length) {
            if (TaskLineClassifier.isTaskLine(nestedChildLines[ci])) {
                const childBlock = this.collectTaskBlockFromChildren(
                    nestedChildLines, nestedLineNumbers, ci
                );
                childTaskBlocks.push(childBlock);
                ci += 1 + childBlock.childRawLines.length;
            } else {
                ci++;
            }
        }

        return {
            type: 'task-block',
            line: lineNumbers[startIndex],
            rawLine,
            indent,
            childRawLines: nestedChildLines,
            childLineNumbers: nestedLineNumbers,
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
