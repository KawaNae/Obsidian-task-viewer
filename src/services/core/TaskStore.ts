import type { Task, TaskViewerSettings, WikilinkRef } from '../../types';
import type { GenBlock } from '../parsing/gen/GenBlockCollector';

/**
 * タスクストア - タスクのインメモリ管理とアクセス
 * データアクセス、イベント管理、内部操作を提供
 */
export class TaskStore {
    private tasks: Map<string, Task> = new Map();
    private wikilinkRefs: Map<string, WikilinkRef[]> = new Map(); // taskId → refs
    /** filePath → (block name → block). Rebuilt by each scan of that file. */
    private genBlocks: Map<string, Map<string, GenBlock>> = new Map();
    private listeners: ((taskId?: string, changes?: string[]) => void)[] = [];
    private revision: number = 0;
    private batchDepth: number = 0;
    private batchDirty: boolean = false;

    constructor(private settings: TaskViewerSettings) { }

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

    // ===== 内部操作 =====

    /**
     * タスクを設定
     */
    setTask(taskId: string, task: Task): void {
        this.tasks.set(taskId, task);
        this.bumpRevision();
    }

    /**
     * タスクを削除
     */
    deleteTask(taskId: string): void {
        this.tasks.delete(taskId);
        this.bumpRevision();
    }

    /**
     * 全タスクをクリア
     */
    clear(): void {
        this.tasks.clear();
        this.wikilinkRefs.clear();
        this.genBlocks.clear();
        this.bumpRevision();
    }

    /**
     * 指定ファイルのタスクを全て削除
     */
    removeTasksByFile(filePath: string): void {
        const toRemove: string[] = [];
        for (const [id, task] of this.tasks) {
            if (task.file === filePath) {
                toRemove.push(id);
            }
        }
        // Generation blocks are keyed by file, not by task, so a file that
        // holds only blocks is forgotten here too.
        const hadBlocks = this.genBlocks.delete(filePath);
        if (toRemove.length > 0 || hadBlocks) {
            for (const id of toRemove) {
                this.tasks.delete(id);
                this.wikilinkRefs.delete(id);
            }
            this.bumpRevision();
        }
    }

    // ===== イベント管理 =====

    /**
     * 変更リスナーを登録
     * @returns アンサブスクライブ関数
     */
    onChange(callback: (taskId?: string, changes?: string[]) => void): () => void {
        this.listeners.push(callback);
        return () => {
            const idx = this.listeners.indexOf(callback);
            if (idx !== -1) {
                this.listeners.splice(idx, 1);
            }
        };
    }

    /**
     * 全リスナーに変更を通知
     */
    notifyListeners(taskId?: string, changes?: string[]): void {
        for (const listener of this.listeners) {
            listener(taskId, changes);
        }
    }

    /**
     * 全リスナーに変更を通知（各リスナーを個別のマクロタスクに分散）。
     * 初回スキャン等の重い通知で Chrome の Long Task 警告を回避するために使用。
     *
     * 分散に rAF ではなく setTimeout(0) を使う。store は DOM を持たないので
     * host window を解決できず、素の rAF は main window のフレームクロックに
     * 固定される — popout の view しか開いていない、あるいは main が最小化
     * されている状況では通知そのものが届かない（listener 側は自分の window の
     * rAF で coalesce するので、ここでフレーム境界に合わせる必要はない）。
     * timer は背景 window で throttle されるが「いずれ必ず発火する」は保たれ、
     * Long Task を割る目的は macrotask 境界で足りる。
     */
    notifyListenersStaggered(taskId?: string, changes?: string[]): void {
        for (const listener of this.listeners) {
            setTimeout(() => listener(taskId, changes), 0);
        }
    }

    /**
     * 設定を更新
     */
    updateSettings(settings: TaskViewerSettings): void {
        this.settings = settings;
    }

    // ===== Wikilink Refs =====

    setWikilinkRefs(taskId: string, refs: WikilinkRef[]): void {
        if (refs.length > 0) {
            this.wikilinkRefs.set(taskId, refs);
        } else {
            this.wikilinkRefs.delete(taskId);
        }
    }

    getWikilinkRefsMap(): Map<string, WikilinkRef[]> {
        return this.wikilinkRefs;
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

    /**
     * 内部タスクMapを取得（WikiLinkResolver用）
     * @internal
     */
    getTasksMap(): Map<string, Task> {
        return this.tasks;
    }
}

