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
 * What a duplicate-as-next writes for each copy.
 *
 * `verbatim` repeats the file's own line, so a task that is not being moved
 * is not reworded: it never reaches the formatter. `lines` carries copies
 * the caller has composed, which only a task being moved needs.
 */
export type InPlaceCopyLines =
    | { kind: 'verbatim'; count: number }
    | { kind: 'lines'; lines: string[] };


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
     * 日付をずらしてインラインタスクを複製する（`dayOffset` > 0）。
     *
     * 複写は元タスクの前に入り、`count` > 1 なら
     * `dayOffset..dayOffset+count-1` の各日付ぶんを future-first（新しい日付
     * ほど上）で並べる。日をまたがない複製は
     * {@link duplicateInlineTaskInPlace} が扱う。
     *
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
            const idx = this.fileOps.findTaskLineNumber(lines, task);
            if (idx < 0 || idx >= lines.length) {
                logWarn('[TaskCloner] Task not found in file (duplicate)');
                return null;
            }

            const cleanParent = this.fileOps.stripBlockIds([lines[idx]])[0];
            const parents: string[] = [];
            // Future-first order: highest offset first so newer dates appear above older ones.
            for (let offset = dayOffset + count - 1; offset >= dayOffset; offset--) {
                parents.push(this.shiftInlineDates(cleanParent, offset));
            }

            return this.spliceCopies(lines, idx, parents, 'before');
        });
    }

    /**
     * 続きに複製する（`dayOffset` なし）。
     *
     * 複写の行は呼び出し側が組んで渡す。どこへ置くかを決めるのがこの層で、
     * 何を書くか（実効 end から始めて長さを保つ）を決めるのは日付を解決
     * できる層である、という分担は {@link insertRecurrenceForTask} と同じ。
     * 時刻を持たないタスクはずらす先が無いので、呼び出し側は `verbatim` を
     * 渡す。その複写はファイルの行をそのまま写し、formatter を通らない。
     *
     * 複写は元タスクとその子行の**後ろ**に入る。時刻の順に読めるためで、
     * 同じ本文の 2 行が序数で振り分けられたときに、旧 ID が上の元の行に
     * 残るためでもある。
     *
     * @returns whether the copies were written.
     */
    async duplicateInlineTaskInPlace(task: Task, copies: InPlaceCopyLines): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) {
            logWarn(`[TaskCloner] File not found: ${task.file}`);
            return false;
        }

        return processLines(this.app, file, (lines) => {
            const idx = this.fileOps.findTaskLineNumber(lines, task);
            if (idx < 0 || idx >= lines.length) {
                logWarn('[TaskCloner] Task not found in file (duplicate as next)');
                return null;
            }

            const indent = lines[idx].match(/^(\s*)/)?.[1] ?? '';
            const parents = copies.kind === 'verbatim'
                ? Array.from({ length: copies.count },
                    () => this.fileOps.stripBlockIds([lines[idx]])[0])
                : copies.lines.map(l => indent + l.trim());

            return this.spliceCopies(lines, idx, parents, 'after');
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
     * Put one copy per parent line into the file, each followed by the
     * original's children with their block ids stripped.
     *
     * Children travel verbatim. A child's dates are its own, not an offset
     * from its parent's, so nothing here rewrites them — the same rule in
     * both duplication paths.
     *
     * @returns the modified lines array.
     */
    private spliceCopies(
        lines: string[],
        taskLine: number,
        parentLines: string[],
        position: 'before' | 'after',
    ): string[] {
        const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, taskLine);
        const cleanedChildren = this.fileOps.stripBlockIds(childrenLines);

        const linesToInsert: string[] = [];
        for (const parent of parentLines) {
            linesToInsert.push(parent, ...cleanedChildren);
        }

        const insertIndex = position === 'before'
            ? taskLine
            : TaskCloner.indentedRegionEnd(lines, taskLine);
        lines.splice(insertIndex, 0, ...linesToInsert);

        return lines;
    }

    /**
     * The index just past everything indented under the task line.
     *
     * The parser ends a task's children at the first blank line, and the
     * lines after that blank still read as the task's — a second group of
     * notes, a fenced block with a blank line in it. A copy dropped at the
     * end of the parsed children would land in the middle of them, and the
     * fence would be cut in half. So the region runs to the last line deeper
     * than the task, and the copy goes after that.
     *
     * Only the insertion point is measured this way. What a copy carries is
     * still the children the parser sees, so the copy and the index agree on
     * what its subtree is.
     */
    private static indentedRegionEnd(lines: string[], taskLine: number): number {
        const taskIndent = lines[taskLine].search(/\S|$/);
        let last = taskLine;

        for (let j = taskLine + 1; j < lines.length; j++) {
            const line = lines[j];
            // A blank line decides nothing on its own — what follows it does.
            if (line.trim() === '') continue;
            if (line.search(/\S|$/) <= taskIndent) break;
            last = j;
        }

        return last + 1;
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
