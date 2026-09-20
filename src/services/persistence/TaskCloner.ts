import { type App, TFile } from 'obsidian';
import type { DuplicateOptions, Task } from '../../types';
import { collectFlowLineIndicesInFile, formatFlowLine } from '../flow/FlowLineScanner';
import { DateUtils } from '../../utils/DateUtils';
import { logWarn } from '../../log/log';
import { FileOperations } from './utils/FileOperations';
import { appendLines, processLines, splitLines } from '../../utils/FileLines';

/**
 * One generated child line, as the block described it.
 *
 * `depth` counts levels below the generated parent, so 1 is its direct child.
 * `body` carries no indentation — this layer decides what one level looks like
 * in the file being written.
 */
export interface GeneratedChild {
    depth: number;
    body: string;
}


/**
 * タスク複製ロジックを担当するクラス
 * インラインタスクの複製、週次複製、再発処理を提供
 */
export class TaskCloner {
    constructor(
        private app: App,
        private fileOps: FileOperations
    ) { }

    /**
     * インラインタスクを複製する。
     * - dayOffset=0, count=1: 同一ファイル内に複製（Block ID除去、元タスクの前に挿入）
     * - dayOffset>0, count=1: 指定日数シフトして1件複製（元タスクの前に挿入）
     * - count>1: dayOffset..dayOffset+count-1 の各日付で複製（future-first 挿入）
     */
    /**
     * @returns whether the copy was written. A `false` means the original line
     * could not be resolved and the file is untouched.
     */
    async duplicateInlineTask(task: Task, options?: DuplicateOptions): Promise<boolean> {
        const { dayOffset = 0, count = 1 } = options ?? {};

        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) {
            logWarn(`[TaskCloner] File not found: ${task.file}`);
            return false;
        }

        return processLines(this.app, file, (lines) => {
            if (count > 1) {
                // Multi-copy: future-first insertion (highest offset first)
                const currentLine = this.fileOps.findTaskLineNumber(lines, task);
                if (currentLine < 0 || currentLine >= lines.length) {
                    logWarn('[TaskCloner] Task not found in file (duplicate)');
                    return null;
                }

                const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);
                const cleanParent = this.fileOps.stripBlockIds([lines[currentLine]])[0];
                const cleanedChildren = this.fileOps.stripBlockIds(childrenLines);

                const newLines: string[] = [];
                // Future-first order: highest offset first so newer dates appear above older ones.
                for (let offset = dayOffset + count - 1; offset >= dayOffset; offset--) {
                    newLines.push(this.shiftInlineDates(cleanParent, offset));
                    newLines.push(...cleanedChildren);
                }

                lines.splice(currentLine, 0, ...newLines);
                return lines;
            } else if (dayOffset === 0) {
                // In-place copy: clean parent, insert before
                const idx = this.fileOps.findTaskLineNumber(lines, task);
                if (idx < 0 || idx >= lines.length) {
                    logWarn('[TaskCloner] Task not found in file (duplicate)');
                    return null;
                }

                const cleanParent = this.fileOps.stripBlockIds([lines[idx]])[0];
                return this.duplicateInlineTaskLines(lines, task, cleanParent, 'before');
            } else {
                // Single copy with date shift
                const idx = this.fileOps.findTaskLineNumber(lines, task);
                if (idx < 0 || idx >= lines.length) {
                    logWarn('[TaskCloner] Task not found in file (duplicate)');
                    return null;
                }

                const shiftedParent = this.shiftInlineDates(
                    this.fileOps.stripBlockIds([lines[idx]])[0], dayOffset
                );
                return this.duplicateInlineTaskLines(lines, task, shiftedParent, 'before');
            }
        });
    }

    /**
     * タスクの再発処理：元タスクの兄弟位置に新しいタスク行を挿入する。
     * `content` は呼び出し側（FlowExecutor interpreter）が format 済みの行文字列。
     * `flowLines` は新インスタンスの `- ==>` フロー子行の raw 列（行単位
     * canonical、FlowPlanner 産）。タスク行直後に正規化位置で挿入する。
     *
     * 子行は運ばない。発火したインスタンスの下にある行はそのインスタンスが
     * 何をしたかの記録で、次インスタンスに何を持たせるかは生成ブロックが
     * 記述する（gen v3）。既存子行はここでも読むが、用途はフロー子行の
     * インデントをファイルの綴りに揃えることだけである。
     */
    async insertRecurrenceForTask(task: Task, content: string, flowLines: string[] = []): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await processLines(this.app, file, (lines) => {
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) {
                // Task not found: append to end
                appendLines(lines, [
                    ...splitLines(content).lines,
                    ...flowLines.map(raw => formatFlowLine('\t', raw)),
                ]);
                return lines;
            }

            // Re-indent the formatted line to match the original task line
            const originalLine = lines[currentLine];
            const originalIndent = originalLine.match(/^(\s*)/)?.[1] || '';
            const newParentLine = originalIndent + content.trim();

            // 新インスタンスの flow 行インデント: 既存子行の綴りに揃え、
            // なければタブ。直下の flow 行は発火で消費される側なので、綴りの
            // 見本としては後回しにする（それしか無ければ使う）。
            const flowAbs = new Set(collectFlowLineIndicesInFile(lines, currentLine));
            const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);
            const ordinaryChildren = childrenLines.filter((_, i) => !flowAbs.has(currentLine + 1 + i));

            const childIndent = ordinaryChildren.find(l => l.trim() !== '')?.match(/^\s*/)?.[0]
                ?? childrenLines.find(l => l.trim() !== '')?.match(/^\s*/)?.[0]
                ?? originalIndent + '\t';
            const newFlowLines = flowLines.map(raw => formatFlowLine(childIndent, raw));

            const insertAt = this.fileOps.findSiblingGroupStart(lines, currentLine);
            lines.splice(insertAt, 0, newParentLine, ...newFlowLines);

            return lines;
        });
    }

    /**
     * Write the next instance from what a gen block described.
     *
     * The caller hands over finished values: the parent line with its flow
     * clause already composed, the flow child lines in canonical form, and the
     * children as depth and body. Nothing here reads the block or evaluates
     * anything — this layer only decides where the lines go and how deep they
     * sit, which is the same division of labour the recurrence path has always
     * had.
     *
     * Indentation is resolved from the file, not from the caller. The parent is
     * a sibling of the task that fired, so it takes that task's own indent; the
     * children take one unit per level of `depth`, where a depth of 1 means the
     * first level below the parent. The unit follows the task's existing
     * children, falling back to however the rest of the file is written — the
     * same rule the child-insert primitives use, so a subtree keeps one
     * spelling.
     */
    async insertGeneratedInstance(
        task: Task,
        parentLine: string,
        flowLines: string[],
        children: GeneratedChild[],
    ): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return;

        await processLines(this.app, file, (lines) => {
            const currentLine = this.fileOps.findTaskLineNumber(lines, task);
            if (currentLine < 0 || currentLine >= lines.length) {
                logWarn('[TaskCloner] Task not found in file (insertGeneratedInstance)');
                return null;
            }

            const parentIndent = lines[currentLine].match(/^(\s*)/)?.[1] ?? '';
            const unit = FileOperations.resolveChildIndent(lines, currentLine)
                .slice(parentIndent.length) || FileOperations.detectIndentUnit(lines);

            const rendered = [
                parentIndent + parentLine.trim(),
                ...flowLines.map(raw => formatFlowLine(parentIndent + unit, raw)),
                ...children.map(c => parentIndent + unit.repeat(Math.max(1, c.depth)) + c.body.trim()),
            ];

            const insertAt = this.fileOps.findSiblingGroupStart(lines, currentLine);
            lines.splice(insertAt, 0, ...rendered);

            return lines;
        });
    }

    // --- Private helpers ---

    /**
     * Inline task duplication core: collect parent+children, replace parent line,
     * strip block IDs from children, insert at specified position.
     * Children are copied as-is (no date shifting).
     * @returns Modified lines array, or null if task not found.
     */
    private duplicateInlineTaskLines(
        lines: string[],
        task: Task,
        newParentLine: string,
        position: 'before' | 'after'
    ): string[] | null {
        const currentLine = this.fileOps.findTaskLineNumber(lines, task);
        if (currentLine < 0 || currentLine >= lines.length) return null;

        const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, currentLine);
        const cleanedChildren = this.fileOps.stripBlockIds(childrenLines);

        const linesToInsert = [newParentLine, ...cleanedChildren];

        if (position === 'before') {
            lines.splice(currentLine, 0, ...linesToInsert);
        } else {
            const insertIndex = currentLine + 1 + childrenLines.length;
            lines.splice(insertIndex, 0, ...linesToInsert);
        }

        return lines;
    }

    /**
     * @notation ブロック内の start/end 日付を dayOffset 日シフトする。
     * due（3番目のセグメント）はシフトしない。
     */
    private shiftInlineDates(line: string, dayOffset: number): string {
        return line.replace(
            /(@(?=[\d>T])(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|T?\d{2}:\d{2})?(?:>(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|\d{2}:\d{2})?)*)/,
            (block) => {
                const inner = block.slice(1); // remove '@'
                const segments = inner.split('>');
                const shifted = segments.map((seg, i) =>
                    i < 2 ? seg.replace(/\d{4}-\d{2}-\d{2}/g, (d) => DateUtils.addDays(d, dayOffset)) : seg,
                );
                return '@' + shifted.join('>');
            },
        );
    }
}
