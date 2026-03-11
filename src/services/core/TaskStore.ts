import type { Task, TaskViewerSettings, WikilinkRef } from '../../types';

/**
 * タスクストア - タスクのインメモリ管理とアクセス
 * データアクセス、イベント管理、内部操作を提供
 */
export class TaskStore {
    private tasks: Map<string, Task> = new Map();
    private wikilinkRefs: Map<string, WikilinkRef[]> = new Map(); // taskId → refs
    private listeners: ((taskId?: string, changes?: string[]) => void)[] = [];

    constructor(private settings: TaskViewerSettings) { }

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
    }

    /**
     * タスクを削除
     */
    deleteTask(taskId: string): void {
        this.tasks.delete(taskId);
    }

    /**
     * 全タスクをクリア
     */
    clear(): void {
        this.tasks.clear();
        this.wikilinkRefs.clear();
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
        for (const id of toRemove) {
            this.tasks.delete(id);
            this.wikilinkRefs.delete(id);
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
     * 全リスナーに変更を通知（各リスナーを個別の rAF に分散）。
     * 初回スキャン等の重い通知で Chrome の Long Task 警告を回避するために使用。
     */
    notifyListenersStaggered(taskId?: string, changes?: string[]): void {
        for (const listener of this.listeners) {
            requestAnimationFrame(() => listener(taskId, changes));
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

    /**
     * 内部タスクMapを取得（WikiLinkResolver用）
     * @internal
     */
    getTasksMap(): Map<string, Task> {
        return this.tasks;
    }
}

