import type { DocumentNode, SectionNode, BlockNode, PropertyBlock, PropertyBlockEntry, TaskBlock, TextBlock } from './DocumentTree';
import { ChildLineClassifier } from '../utils/ChildLineClassifier';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';

const HEADING_REGEX = /^(#{1,6})\s+(.*)/;
const PROPERTY_GROUP_HEADER = /^\s*-\s+properties::\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

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

    private static classifyBlocks(section: SectionNode, allLines: string[]): void {
        // セクション自身の行範囲から子セクションの範囲を除外した行範囲を計算
        const ownRanges = this.getOwnLineRanges(section);
        if (ownRanges.length === 0) return;

        const blocks: BlockNode[] = [];
        let isFirstRange = true;

        for (const [rangeStart, rangeEnd] of ownRanges) {
            let i = rangeStart;

            // 見出し行自体をスキップ
            if (isFirstRange && section.heading && i === section.heading.line) {
                i++;
            }
            isFirstRange = false;

            // セクション先頭のプロパティブロック検出
            if (!section.propertyBlock && blocks.length === 0) {
                const propBlock = this.collectPropertyBlock(allLines, i, rangeEnd);
                if (propBlock) {
                    section.propertyBlock = propBlock;
                    i = propBlock.endLine;
                }
            }

            // 残りの行をブロックに分類
            while (i < rangeEnd) {
                const line = allLines[i];

                if (line.trim() === '') {
                    i++;
                    continue;
                }

                if (TaskLineClassifier.isTaskLine(line)) {
                    const taskBlock = this.collectTaskBlock(allLines, i, rangeEnd);
                    blocks.push(taskBlock);
                    i = taskBlock.line + 1 + taskBlock.childRawLines.length;
                } else {
                    // TextBlock: 連続する非タスク・非空行
                    const textStart = i;
                    while (i < rangeEnd && allLines[i].trim() !== '' && !TaskLineClassifier.isTaskLine(allLines[i])) {
                        i++;
                    }
                    blocks.push({ type: 'text-block', startLine: textStart, endLine: i } as TextBlock);
                }
            }
        }

        section.blocks = blocks;
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
     * セクション先頭のプロパティブロックを収集する。
     *
     * Markdown list-aware な走査: 空行は list を終了させない (CommonMark の
     * loose list と同じ semantics) ので transparent に skip する。
     * property block を終端するのは:
     *   - task 行 (checkbox)
     *   - property でも group header でもない list 行 (wikilink, 通常 bullet)
     *   - 非 list 行 (plain text)
     *
     * 返却する `endLine` は最後に収集した property entry の次行 (= entries が
     * claim する範囲の終端)。後続の空行は claim しない。
     */
    private static collectPropertyBlock(
        allLines: string[],
        startLine: number,
        endLine: number
    ): PropertyBlock | null {
        const entries: PropertyBlockEntry[] = [];
        let scanIndex = startLine;
        let lastEntryLine = -1;

        while (scanIndex < endLine) {
            const line = allLines[scanIndex];

            // Markdown: 空行は list を終了させない (loose list)
            if (line.trim() === '') {
                scanIndex++;
                continue;
            }

            // チェックボックス行（タスク行）で終了
            if (TaskLineClassifier.isTaskLine(line)) break;

            // グループ形式: `- properties::`
            if (PROPERTY_GROUP_HEADER.test(line)) {
                const groupIndent = line.search(/\S|$/);
                scanIndex++;
                while (scanIndex < endLine) {
                    const childLine = allLines[scanIndex];
                    if (childLine.trim() === '') {
                        scanIndex++;
                        continue;
                    }
                    const childIndent = childLine.search(/\S|$/);
                    if (childIndent <= groupIndent) break;

                    const propMatch = childLine.match(ChildLineClassifier.PROPERTY_LINE);
                    if (propMatch) {
                        entries.push({
                            key: propMatch[1].trim(),
                            value: propMatch[2].trim(),
                            line: scanIndex,
                        });
                        lastEntryLine = scanIndex;
                    }
                    scanIndex++;
                }
                continue;
            }

            // フラット形式: `- key:: value`
            const propMatch = line.match(ChildLineClassifier.PROPERTY_LINE);
            if (propMatch) {
                entries.push({
                    key: propMatch[1].trim(),
                    value: propMatch[2].trim(),
                    line: scanIndex,
                });
                lastEntryLine = scanIndex;
                scanIndex++;
                continue;
            }

            // リスト項目だがプロパティでもタスクでもない (wikilink 等) → 終了
            if (LIST_ITEM.test(line)) break;

            // 非リスト行 → 終了
            break;
        }

        if (entries.length === 0) return null;

        return {
            type: 'property-block',
            startLine,
            endLine: lastEntryLine + 1,
            entries,
        };
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
