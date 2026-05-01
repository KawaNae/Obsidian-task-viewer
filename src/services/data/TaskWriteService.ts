import type { TFile } from 'obsidian';
import type { DuplicateOptions, Task } from '../../types';
import type { TaskIndex } from '../core/TaskIndex';
import { buildChildEntries } from './ChildEntryBuilder';

/**
 * Write-side entry point for views and interaction handlers.
 * All task mutations go through this service.
 * Pure delegation layer — no business logic here.
 */
export class TaskWriteService {
    private deleteListeners: Array<(taskId: string) => void> = [];

    constructor(private taskIndex: TaskIndex) {}

    // ===== Task CRUD =====

    async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
        return this.taskIndex.updateTask(taskId, updates);
    }

    async deleteTask(taskId: string): Promise<void> {
        await this.taskIndex.deleteTask(taskId);
        for (const cb of this.deleteListeners) cb(taskId);
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
        return this.taskIndex.duplicateTask(taskId, options);
    }

    async convertToFrontmatterTask(taskId: string): Promise<string> {
        return this.taskIndex.convertToFrontmatterTask(taskId);
    }

    // ===== Task creation =====

    async createTask(filePath: string, taskLine: string, heading?: string): Promise<void> {
        return this.taskIndex.createTask(filePath, taskLine, heading);
    }

    async insertChildTask(parentTaskId: string, childLine: string): Promise<void> {
        return this.taskIndex.insertChildTask(parentTaskId, childLine);
    }

    async createFrontmatterTaskFromData(taskData: Partial<Task>): Promise<string> {
        return this.taskIndex.createFrontmatterTaskFromData(taskData);
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
     * Validate that bodyLine is a writable (plain / wikilink) child entry of
     * parentTaskId. Throws on missing parent, unknown bodyLine, or 'task' entry
     * — those should be edited via updateTask instead. Returns the parent for
     * file-path access.
     */
    private requireWritableChildLine(parentTaskId: string, bodyLine: number, op: string): Task {
        const parent = this.taskIndex.getTask(parentTaskId);
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

    // ===== Drag state control =====

    setDraggingFile(filePath: string | null): void {
        this.taskIndex.setDraggingFile(filePath);
    }

    notifyImmediate(taskId?: string, changes?: string[]): void {
        this.taskIndex.notifyImmediate(taskId, changes);
    }

    // ===== Scan control (for menu-triggered rescans) =====

    async requestScan(file: TFile): Promise<void> {
        return this.taskIndex.requestScan(file);
    }

    async waitForScan(filePath: string): Promise<void> {
        return this.taskIndex.waitForScan(filePath);
    }
}
