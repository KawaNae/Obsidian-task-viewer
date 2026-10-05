import type { Task } from '../../types';
import type { GenBlock } from '../parsing/gen/GenBlockCollector';

/**
 * タスクストア - タスクのインメモリ管理とアクセス。変更を聞き手へ告げるのは
 * 索引の合流器（`NotifyCoalescer`）で、ストアは告げない。
 */
export class TaskStore {
    private tasks: Map<string, Task> = new Map();
    /**
     * filePath → (anchor → name): the row each `^id` of the file anchors
     * (`Task.anchor`), kept with the tasks as they go in and out. The scan
     * gives a row its anchor before it goes in, and nothing changes a
     * copy's anchor after.
     */
    private anchors: Map<string, Map<string, string>> = new Map();
    /** filePath → (block name → block). Rebuilt by each scan of that file. */
    private genBlocks: Map<string, Map<string, GenBlock>> = new Map();
    private revision: number = 0;
    private batchDepth: number = 0;
    private batchDirty: boolean = false;

    /** Current revision number. Incremented on every mutation. */
    getRevision(): number {
        return this.revision;
    }

    /** Bump revision without changing task data (for in-place mutations). */
    bumpRevision(): void {
        if (this.batchDepth > 0) { this.batchDirty = true; return; }
        this.revision++;
    }

    beginBatch(): void {
        this.batchDepth++;
    }

    endBatch(): void {
        if (this.batchDepth > 0) this.batchDepth--;
        if (this.batchDepth === 0 && this.batchDirty) {
            this.batchDirty = false;
            this.revision++;
        }
    }

    // ===== データアクセス =====

    /**
     * 全タスクを取得
     */
    getTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    /**
     * IDでタスクを取得
     */
    getTask(taskId: string): Task | undefined {
        return this.tasks.get(taskId);
    }

    /**
     * The row `anchor` anchors in `filePath`, or undefined when no row of the
     * file carries that `^id` alone. One lookup, however many rows are held.
     */
    getTaskByAnchor(filePath: string, anchor: string): Task | undefined {
        const name = this.anchors.get(filePath)?.get(anchor);
        return name === undefined ? undefined : this.tasks.get(name);
    }

    // ===== 内部操作 =====

    /**
     * タスクを設定
     */
    setTask(taskId: string, task: Task): void {
        this.forgetAnchor(taskId);
        this.tasks.set(taskId, task);
        if (task.anchor !== undefined) {
            let anchors = this.anchors.get(task.file);
            if (!anchors) this.anchors.set(task.file, anchors = new Map());
            anchors.set(task.anchor, taskId);
        }
        this.bumpRevision();
    }

    /**
     * タスクを削除
     */
    deleteTask(taskId: string): void {
        this.forgetAnchor(taskId);
        this.tasks.delete(taskId);
        this.bumpRevision();
    }

    /** Take the anchor the row `taskId` held, if any, out of the table. */
    private forgetAnchor(taskId: string): void {
        const held = this.tasks.get(taskId);
        if (held?.anchor === undefined) return;
        const anchors = this.anchors.get(held.file);
        if (anchors?.get(held.anchor) !== taskId) return;
        anchors.delete(held.anchor);
        if (anchors.size === 0) this.anchors.delete(held.file);
    }

    /**
     * 全タスクをクリア
     */
    clear(): void {
        this.tasks.clear();
        this.anchors.clear();
        this.genBlocks.clear();
        this.bumpRevision();
    }

    /**
     * 指定ファイルのタスクを全て削除し、消した名前を返す。
     */
    removeTasksByFile(filePath: string): string[] {
        const toRemove: string[] = [];
        for (const [id, task] of this.tasks) {
            if (task.file === filePath) {
                toRemove.push(id);
            }
        }
        // Generation blocks are keyed by file, not by task, so a file that
        // holds only blocks is forgotten here too.
        const hadBlocks = this.genBlocks.delete(filePath);
        this.anchors.delete(filePath);
        if (toRemove.length > 0 || hadBlocks) {
            for (const id of toRemove) {
                this.tasks.delete(id);
            }
            this.bumpRevision();
        }
        return toRemove;
    }

    // ===== Generation blocks =====

    /** Replace a file's blocks. The scan of that file is the only writer. */
    setGenBlocks(filePath: string, blocks: Map<string, GenBlock>): void {
        if (blocks.size > 0) {
            this.genBlocks.set(filePath, blocks);
        } else {
            this.genBlocks.delete(filePath);
        }
    }

    /**
     * A block by name. Resolution is file-local: a flow command reaches
     * only the blocks of its own file.
     */
    getGenBlock(filePath: string, name: string): GenBlock | undefined {
        return this.genBlocks.get(filePath)?.get(name);
    }

    /** All blocks of a file, empty when it has none. */
    getGenBlocks(filePath: string): Map<string, GenBlock> {
        return this.genBlocks.get(filePath) ?? new Map();
    }
}

