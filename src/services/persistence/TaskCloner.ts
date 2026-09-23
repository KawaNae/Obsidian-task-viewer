import { type App, TFile } from 'obsidian';
import type { DuplicateOptions, Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { logWarn } from '../../log/log';
import { FileOperations } from './utils/FileOperations';
import { processLines, type LineEdits } from '../../utils/FileLines';
import { refOf, subjectOf } from './TaskRefs';
import type { WriteObserver } from './WriteObserver';
import { Outline } from '../parsing/utils/Outline';
import { Placement } from './utils/Placement';

export type { GeneratedChild } from './FlowInstanceLines';

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
        private fileOps: FileOperations,
        private writes?: WriteObserver,
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
            this.writes?.for(task.file)?.refused({ file: task.file, reason: { kind: 'gone' }, subject: subjectOf(task) });
            return false;
        }

        return processLines(this.app, file, (lines, _eol, { edits, lineOf }) => {
            const idx = lineOf(refOf(task), subjectOf(task));
            if (idx === null) return null;

            const cleanParent = this.fileOps.stripBlockIds([lines[idx]])[0];
            const parents: string[] = [];
            // Future-first order: highest offset first so newer dates appear above older ones.
            for (let offset = dayOffset + count - 1; offset >= dayOffset; offset--) {
                parents.push(this.shiftInlineDates(cleanParent, offset));
            }

            return this.spliceCopies(lines, idx, parents, idx, edits);
        }, this.writes?.for(task.file)).then(outcome => outcome.written);
    }

    /**
     * 続きに複製する（`dayOffset` なし）。
     *
     * 複写の行は呼び出し側が組んで渡す。どこへ置くかを決めるのがこの層で、
     * 何を書くか（実効 end から始めて長さを保つ）を決めるのは日付を解決
     * できる層である、という分担はフローの次回分（`InlineTaskWriter.applyToTask`
     * の `insert-instance`）と同じ。
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
            this.writes?.for(task.file)?.refused({ file: task.file, reason: { kind: 'gone' }, subject: subjectOf(task) });
            return false;
        }

        return processLines(this.app, file, (lines, _eol, { edits, lineOf, refuse }) => {
            const idx = lineOf(refOf(task), subjectOf(task));
            if (idx === null) return null;
            const at = Placement.afterSubtree(lines, idx);
            if (at === null) return refuse({ kind: 'unplaceable' }, subjectOf(task));

            const indent = Outline.indentOf(lines[idx]);
            const parents = copies.kind === 'verbatim'
                ? Array.from({ length: copies.count },
                    () => this.fileOps.stripBlockIds([lines[idx]])[0])
                : copies.lines.map(l => indent + l.trim());

            return this.spliceCopies(lines, idx, parents, at, edits);
        }, this.writes?.for(task.file)).then(outcome => outcome.written);
    }

    // --- Private helpers ---

    /**
     * Put one copy per parent line into the file, each followed by the
     * original's children with their block ids stripped.
     *
     * Children travel verbatim. A child's dates are its own, not an offset
     * from its parent's, so nothing here rewrites them — the same rule in
     * both duplication paths. `insertIndex` is where the copies go: the
     * task's own line to go before it, or `Placement.afterSubtree` to follow it.
     *
     * @returns the modified lines array.
     */
    private spliceCopies(
        lines: string[],
        taskLine: number,
        parentLines: string[],
        insertIndex: number,
        edits: LineEdits,
    ): string[] {
        const { childrenLines } = this.fileOps.collectChildrenFromLines(lines, taskLine);
        const cleanedChildren = this.fileOps.stripBlockIds(childrenLines);

        const linesToInsert: string[] = [];
        for (const parent of parentLines) {
            linesToInsert.push(parent, ...cleanedChildren);
        }

        // Through `edits` rather than beside it: the copy is worded exactly
        // like the line it copies, so a position off by one would read the same
        // and hand the original's identity to the copy. One number does both.
        //
        // Which of these lines are tasks is not this layer's question — the
        // copied children can hold anything, a fence among them — and the index
        // answers it by parsing what was written.
        edits.splice(insertIndex, 0, ...linesToInsert);

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
