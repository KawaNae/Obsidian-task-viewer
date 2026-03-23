import type { TFile } from 'obsidian';
import type { DuplicateOptions, Task } from '../../types';
import type { TaskIndex } from '../core/TaskIndex';

/**
 * Write-side entry point for views and interaction handlers.
 * All task mutations go through this service.
 * Pure delegation layer — no business logic here.
 */
export class TaskWriteService {
    constructor(private taskIndex: TaskIndex) {}

    // ===== Task CRUD =====

    async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
        return this.taskIndex.updateTask(taskId, updates);
    }

    async deleteTask(taskId: string): Promise<void> {
        return this.taskIndex.deleteTask(taskId);
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

    async updateLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        return this.taskIndex.updateLine(filePath, lineNumber, newContent);
    }

    async insertLineAfterLine(filePath: string, lineNumber: number, newContent: string): Promise<void> {
        return this.taskIndex.insertLineAfterLine(filePath, lineNumber, newContent);
    }

    async deleteLine(filePath: string, lineNumber: number): Promise<void> {
        return this.taskIndex.deleteLine(filePath, lineNumber);
    }

    // ===== Drag state control =====

    setDraggingFile(filePath: string | null): void {
        this.taskIndex.setDraggingFile(filePath);
    }

    notifyImmediate(): void {
        this.taskIndex.notifyImmediate();
    }

    // ===== Scan control (for menu-triggered rescans) =====

    async requestScan(file: TFile): Promise<void> {
        return this.taskIndex.requestScan(file);
    }

    async waitForScan(filePath: string): Promise<void> {
        return this.taskIndex.waitForScan(filePath);
    }
}
