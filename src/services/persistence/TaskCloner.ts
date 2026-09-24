import { type App, TFile } from 'obsidian';
import type { DuplicateOptions } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { logWarn } from '../../log/log';
import { FileOperations } from './utils/FileOperations';
import { fileGone, processLines, type LineDraft, type WriteOutcome } from '../../utils/FileLines';
import type { PlannedTarget } from './TaskRefs';
import type { WriteObserver } from './WriteObserver';
import { Outline } from '../parsing/utils/Outline';
import { Block, Placement, type Spot } from './utils/Placement';

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
    async duplicateInlineTask(target: PlannedTarget, options?: DuplicateOptions): Promise<WriteOutcome> {
        const { dayOffset = 0, count = 1 } = options ?? {};

        const file = this.app.vault.getAbstractFileByPath(target.file);
        if (!(file instanceof TFile)) return fileGone(this.writes?.for(target.file, 'user'), target.file, target.subject);

        return processLines(this.app, file, this.writes?.for(target.file, 'user'), (draft, _eol, { row }) => {
            const lines = draft.lines;
            const idx = row(target);
            if (idx === null) return false;

            const cleanParent = this.fileOps.stripBlockIds([lines[idx]])[0];
            const parents: string[] = [];
            // Future-first order: highest offset first so newer dates appear above older ones.
            for (let offset = dayOffset + count - 1; offset >= dayOffset; offset--) {
                parents.push(this.shiftInlineDates(cleanParent, offset));
            }

            this.putCopies(draft, idx, parents, Placement.before(lines, idx, parents[0]));
            return true;
        });
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
    async duplicateInlineTaskInPlace(target: PlannedTarget, copies: InPlaceCopyLines): Promise<WriteOutcome> {
        const file = this.app.vault.getAbstractFileByPath(target.file);
        if (!(file instanceof TFile)) return fileGone(this.writes?.for(target.file, 'user'), target.file, target.subject);

        return processLines(this.app, file, this.writes?.for(target.file, 'user'), (draft, _eol, { row }) => {
            const lines = draft.lines;
            const idx = row(target);
            if (idx === null) return false;

            const indent = Outline.indentOf(lines[idx]);
            const parents = copies.kind === 'verbatim'
                ? Array.from({ length: copies.count },
                    () => this.fileOps.stripBlockIds([lines[idx]])[0])
                : copies.lines.map(l => indent + Outline.dedent(l));

            this.putCopies(draft, idx, parents, Placement.afterSubtree(lines, idx, parents[0]));
            return true;
        });
    }

    // --- Private helpers ---

    /**
     * Put one copy per parent line into the file, each followed by the
     * original's children with their block ids stripped: a sibling of the
     * task, at `spot` — just above it (`Placement.before`) or just past its
     * subtree (`Placement.afterSubtree`).
     *
     * Children travel verbatim. A child's dates are its own, not an offset
     * from its parent's, so nothing here rewrites them — the same rule in
     * both duplication paths. Each copy is to read as the original's subtree
     * reads (`Block.of`), and is not written where it would not.
     *
     * A fence among the children that never closes ends with the copy's item,
     * as it ended with the original's (`Outline.read`): below a copy stands
     * the original's own line, or whatever stood below the original.
     */
    private putCopies(draft: LineDraft, taskLine: number, parentLines: string[], spot: Spot): void {
        const lines = draft.lines;
        const outline = Outline.read(lines);
        const rows: number[] = [];
        for (let row = taskLine; row < outline.subtreeEnd(taskLine); row++) rows.push(row);
        const cleanedChildren = this.fileOps.stripBlockIds(rows.slice(1).map(row => lines[row]));

        // Through the draft rather than beside it: the copy is worded exactly
        // like the line it copies, so a position off by one would read the same
        // and hand the original's identity to the copy. One number does both.
        // Each copy's lines stand under lines of that copy.
        draft.put(spot, parentLines.flatMap((parent, copy) => Block.of(outline, rows, [parent, ...cleanedChildren])
            .map(line => (typeof line.under === 'number' ? { ...line, under: line.under + copy * rows.length } : line))));
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
