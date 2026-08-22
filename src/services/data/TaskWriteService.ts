import type { TFile } from 'obsidian';
import type { DuplicateOptions, Task } from '../../types';
import type { TaskIndex } from '../core/TaskIndex';
import type { FlowDeleteAssessment } from '../flow/FlowDeletion';
import { TaskIdGenerator } from '../display/TaskIdGenerator';
import { buildChildEntries } from './ChildEntryBuilder';

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

    async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
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

    async duplicateTask(taskId: string, options?: DuplicateOptions): Promise<void> {
        return this.taskIndex.duplicateTask(this.resolveTaskId(taskId), options);
    }

    async convertToTvFile(taskId: string): Promise<string> {
        return this.taskIndex.convertToTvFile(this.resolveTaskId(taskId));
    }

    // ===== Task creation =====

    async createTask(filePath: string, taskLine: string, heading?: string): Promise<number> {
        return this.taskIndex.createTask(filePath, taskLine, heading);
    }

    async insertChildTask(parentTaskId: string, childLine: string): Promise<void> {
        return this.taskIndex.insertChildTask(this.resolveTaskId(parentTaskId), childLine);
    }

    /**
     * Append a child at the *end* of the parent's subtree. Session records are
     * a log, so they must accumulate in chronological order — insertChildTask
     * inserts at the head and would read backwards.
     */
    async appendChildTask(parentTaskId: string, childLine: string): Promise<void> {
        return this.taskIndex.appendChildTask(this.resolveTaskId(parentTaskId), childLine);
    }

    /**
     * Insert a line as the task's next sibling, at the task's own indentation.
     * `siblingLine` is a formatted line body without indentation — the write
     * layer reads the indent off the file, so a shifted line cannot make the
     * record land at the wrong depth.
     *
     * Pass `afterCompletedRun` to skip past the completed siblings that follow
     * the task, which is what keeps a run of session records in chronological
     * order when the timer resumes from an earlier one. Completion means `[x]`
     * and nothing else.
     *
     * Returns the inserted line index, or -1 when nothing was written
     * (unknown / read-only / tv-file task, or an unresolvable line).
     */
    async insertSiblingAfterTask(
        taskId: string,
        siblingLine: string,
        opts: { afterCompletedRun?: boolean } = {}
    ): Promise<number> {
        return this.taskIndex.insertSiblingAfterTask(this.resolveTaskId(taskId), siblingLine, opts);
    }

    async createTvFileFromData(taskData: Partial<Task>): Promise<string> {
        return this.taskIndex.createTvFileFromData(taskData);
    }

    // ===== Line-level operations =====
    //
    // updateLine / insertLineAfterLine / deleteLine operate on raw (file, line)
    // pairs. They are appropriate when the caller has direct knowledge of the
    // line via the editor cursor (e.g. TaskMenuExtension) or another trusted
    // source. UI write paths that target a child line of a parsed task should
    // prefer updateChildLine / insertChildLineAfter / deleteChildLine, which
    // validate that the line actually belongs to the parent before writing.

    async updateLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        return this.taskIndex.updateLine(filePath, lineNumber, newContent);
    }

    async insertLineAfterLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        return this.taskIndex.insertLineAfterLine(filePath, lineNumber, newContent);
    }

    async deleteLine(filePath: string, lineNumber: number): Promise<void> {
        return this.taskIndex.deleteLine(filePath, lineNumber);
    }

    // ===== Child-line operations =====
    //
    // These wrap raw line writes with a parent-ownership check derived from
    // ChildEntryBuilder. They ensure the targeted line is actually a writable
    // child entry of the named parent — the abstraction the UI now carries on
    // its handlers. Call these (not updateLine) from card / menu handlers so
    // a wrong parentTaskId or a stale bodyLine fails fast rather than
    // corrupting an unrelated line.

    async updateChildLine(parentTaskId: string, bodyLine: number, newContent: string): Promise<void> {
        const parent = this.requireWritableChildLine(parentTaskId, bodyLine, 'updateChildLine');
        return this.taskIndex.updateLine(parent.file, bodyLine, newContent);
    }

    async insertChildLineAfter(parentTaskId: string, bodyLine: number, newContent: string): Promise<void> {
        const parent = this.requireWritableChildLine(parentTaskId, bodyLine, 'insertChildLineAfter');
        return this.taskIndex.insertLineAfterLine(parent.file, bodyLine, newContent);
    }

    async deleteChildLine(parentTaskId: string, bodyLine: number): Promise<void> {
        const parent = this.requireWritableChildLine(parentTaskId, bodyLine, 'deleteChildLine');
        return this.taskIndex.deleteLine(parent.file, bodyLine);
    }

    /**
     * Validate that bodyLine is a writable (line / wikilink) child entry of
     * parentTaskId. Throws on missing parent, unknown bodyLine, or 'task' entry
     * — those should be edited via updateTask instead. Returns the parent for
     * file-path access.
     */
    private requireWritableChildLine(parentTaskId: string, bodyLine: number, op: string): Task {
        const parent = this.taskIndex.getTask(this.resolveTaskId(parentTaskId));
        if (!parent) {
            throw new Error(`${op}: parent task not found (${parentTaskId})`);
        }
        const entries = buildChildEntries(parent, (id) => this.taskIndex.getTask(id));
        const entry = entries.find(e => e.bodyLine === bodyLine);
        if (!entry) {
            throw new Error(`${op}: bodyLine ${bodyLine} is not a child entry of ${parentTaskId}`);
        }
        if (entry.kind === 'task') {
            throw new Error(`${op}: bodyLine ${bodyLine} belongs to a child task; use updateTask instead`);
        }
        return parent;
    }

    // ===== Frontmatter key writes (Task を介さない書き込み) =====
    //
    // Task ではなくファイルパス+キーで書き先が決まる操作（タイマーの対象 ID、
    // プロパティ欄のサジェスト由来の色・線種書き込み）向けの薄い素通し。
    // 実装は TaskRepository/FrontmatterWriter のまま変えない — 1 つの
    // vault.process に収まっている性質（確認と削除の原子性）や、no-op な
    // vault.process が modify を発火しない挙動もここでは変わらない。

    async setFrontmatterKeys(filePath: string, updates: Record<string, string | null>): Promise<void> {
        return this.taskIndex.getRepository().setFrontmatterKeys(filePath, updates);
    }

    async deleteFrontmatterKeyIfValue(filePath: string, key: string, expected: string): Promise<void> {
        return this.taskIndex.getRepository().deleteFrontmatterKeyIfValue(filePath, key, expected);
    }

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
