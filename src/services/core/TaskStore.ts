import type { Task, TaskViewerSettings } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

/**
 * タスクストア - タスクのインメモリ管理とアクセス
 * データアクセス、イベント管理、内部操作を提供
 */
export class TaskStore {
    private tasks: Map<string, Task> = new Map();
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

    /**
     * 指定日付のタスクを取得
     */
    getTasksForDate(date: string, startHour?: number): Task[] {
        const today = startHour !== undefined ?
            DateUtils.getVisualDateOfNow(startHour) :
            DateUtils.getToday();
        return this.getTasks().filter(t => {
            // D-type tasks (Deadline only) は除外
            if (!t.startDate && !t.startTime && t.deadline) {
                return false;
            }
            const effectiveStart = t.startDate || today;
            return effectiveStart === date;
        });
    }

    /**
     * ビジュアル日のタスクを取得（startHour基準）
     */
    getTasksForVisualDay(visualDate: string, startHour: number): Task[] {
        // 1. 当日のタスク (startHour - 23:59)
        const currentDayTasks = this.getTasksForDate(visualDate, startHour).filter(t => {
            if (!t.startTime) return true;
            const [h] = t.startTime.split(':').map(Number);
            return h >= startHour;
        });

        // 2. 翌日のタスク (00:00 - startHour-1)
        const nextDate = new Date(visualDate);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split('T')[0];

        const nextDayTasks = this.getTasksForDate(nextDateStr, startHour).filter(t => {
            if (!t.startTime) return false;
            const [h] = t.startTime.split(':').map(Number);
            return h < startHour;
        });

        return [...currentDayTasks, ...nextDayTasks];
    }

    /**
     * deadlineを持つ全タスクを取得
     */
    getDeadlineTasks(): Task[] {
        return this.getTasks().filter(t => !!t.deadline);
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
     * 設定を更新
     */
    updateSettings(settings: TaskViewerSettings): void {
        this.settings = settings;
    }

    /**
     * 内部タスクMapを取得（WikiLinkResolver用）
     * @internal
     */
    getTasksMap(): Map<string, Task> {
        return this.tasks;
    }
}

