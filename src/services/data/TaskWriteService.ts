import type { TFile } from 'obsidian';
import type { EditorLine, WriteChannels } from '../../utils/FileLines';
import type { InsertPlace, TaskOp } from '../persistence/TaskOps';
import type { DuplicateOptions, Task } from '../../types';
import type { TaskIndex } from '../core/TaskIndex';
import type { FlowDeleteAssessment } from '../flow/FlowDeletion';
import { TaskIdGenerator } from '../display/TaskIdGenerator';

/**
 * Write-side entry point for views and interaction handlers.
 * All task mutations go through this service.
 * Pure delegation layer — no business logic here.
 *
 * ID contract: every taskId-taking method accepts display-layer synthetic
 * segment IDs (`…##seg:YYYY-MM-DD`) and resolves them to the original task
 * via {@link resolveTaskId}. A split segment shares the original's file and
 * lines, so a mutation addressed to a segment IS a mutation of the original —
 * enforcing that here makes "synthetic IDs never reach TaskIndex" hold by
 * construction, rather than relying on each UI caller to remember
 * getOriginalTaskId before calling.
 */
export class TaskWriteService {
    private deleteListeners: Array<(taskId: string) => void> = [];

    constructor(private taskIndex: TaskIndex) {}

    /** Resolve a synthetic segment ID to the original task ID (see class doc). */
    private resolveTaskId(taskId: string): string {
        return TaskIdGenerator.parseSegmentId(taskId)?.baseId ?? taskId;
    }

    // ===== Task CRUD =====

    /**
     * @returns whether the file was written. A `false` means the update was
     * reverted: the task still holds its former values, and a caller that
     * reports the new ones would be reporting a change that never happened.
     */
    async updateTask(taskId: string, updates: Partial<Task>): Promise<boolean> {
        return this.taskIndex.updateTask(this.resolveTaskId(taskId), updates);
    }

    /**
     * @returns whether the task is gone. A `fireFlow` delete whose fire could
     * not be planned keeps the task and answers no, and the listeners stay
     * quiet — a view told to drop its selection would be dropping it for a
     * task still on the page.
     */
    async deleteTask(taskId: string, options: { fireFlow?: boolean } = {}): Promise<boolean> {
        const id = this.resolveTaskId(taskId);
        const removed = await this.taskIndex.deleteTask(id, options);
        if (removed) {
            for (const cb of this.deleteListeners) cb(id);
        }
        return removed;
    }

    /**
     * What a delete would do to this task's flow command, and how many
     * commands go down with it.
     *
     * A query on the write side because it is part of planning the write: the
     * delete menu asks it to decide which dialog to open, and the answer names
     * the very line the write would produce.
     */
    assessFlowDelete(taskId: string): FlowDeleteAssessment {
        return this.taskIndex.assessFlowDelete(this.resolveTaskId(taskId));
    }

    /**
     * Subscribe to UI-initiated task deletions. Fired after deleteTask resolves.
     * Views use this to clear selection when the selected task is deleted via
     * the UI (context menu, command palette, API), preventing a stale id from
     * being re-applied to a different task that shifted into the same line
     * number.
     */
    onTaskDeleted(cb: (taskId: string) => void): () => void {
        this.deleteListeners.push(cb);
        return () => {
            const i = this.deleteListeners.indexOf(cb);
            if (i >= 0) this.deleteListeners.splice(i, 1);
        };
    }

    /** @returns whether the copy was written. */
    async duplicateTask(taskId: string, options?: DuplicateOptions): Promise<boolean> {
        return this.taskIndex.duplicateTask(this.resolveTaskId(taskId), options);
    }

    // ===== Task creation =====

    /** @returns the line the task was written on, or null when it was not. */
    async createTask(filePath: string, taskLine: string, heading?: string): Promise<number | null> {
        return this.taskIndex.createTask(filePath, taskLine, heading);
    }

    /**
     * Append a child at the *end* of the parent's subtree. Session records are
     * a log, so they must accumulate in chronological order — a first child
     * goes at the head and would read backwards.
     */
    async appendChildTask(parentTaskId: string, childLine: string): Promise<boolean> {
        return this.taskIndex.appendChildTask(this.resolveTaskId(parentTaskId), childLine);
    }

    /**
     * A line beside the row, where `place` says — a child from a card's
     * menu, the API or the CLI, a timer's line — and the row's own `^id` put
     * on or taken off in the same write (`TaskIndex.insertLine`).
     *
     * @returns whether the line was written. Not written: an unknown or
     * read-only task, or a write that was refused (and told the user why).
     */
    async insertLine(taskId: string, line: string, place: InsertPlace, rowId?: string | null): Promise<boolean> {
        return this.taskIndex.insertLine(this.resolveTaskId(taskId), line, place, rowId);
    }

    // ===== A line the editor pointed at =====

    /** @returns whether `ops` were written to the row at `at`, in the file (see TaskIndex.writeLine). */
    async writeLine(filePath: string, at: EditorLine, ops: readonly TaskOp[]): Promise<boolean> {
        return this.taskIndex.writeLine(filePath, at, ops);
    }

    // ===== Frontmatter key writes (Task を介さない書き込み) =====
    //
    // Task ではなくファイルパス+キーで書き先が決まる操作（プロパティ欄の
    // サジェスト由来の色・線種書き込み）向けの薄い素通し。frontmatter は
    // ノートのスコープ属性で、タスクは作らない。no-op な vault.process が
    // modify を発火しない挙動もここでは変わらない。

    /** @returns whether the keys were written. */
    async setFrontmatterKeys(filePath: string, updates: Record<string, string | null>): Promise<boolean> {
        return (await this.taskIndex.getRepository().setFrontmatterKeys(filePath, updates)).written;
    }

    /**
     * Where a write to a file made outside the repository reports what it
     * did — the daily note's heading insert, for one. Undefined once the
     * index is taken down. Bound, so a writer is handed it as it is.
     */
    readonly writeChannel: WriteChannels = (filePath) => this.taskIndex.getRepository().channelOf(filePath);

    // ===== Drag state control =====

    setDraggingFile(filePath: string | null): void {
        this.taskIndex.setDraggingFile(filePath);
    }

    notifyImmediate(taskId?: string, changes?: string[]): void {
        this.taskIndex.notifyImmediate(taskId === undefined ? undefined : this.resolveTaskId(taskId), changes);
    }

    // ===== Scan control (for menu-triggered rescans) =====

    async requestScan(file: TFile): Promise<void> {
        return this.taskIndex.requestScan(file);
    }

    async waitForScan(filePath: string): Promise<void> {
        return this.taskIndex.waitForScan(filePath);
    }
}
