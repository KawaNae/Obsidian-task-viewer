import type { PluginContext } from '../PluginContext';
import { type Task, isTvFile, isTvInline } from '../types';
import type { TimerInstance } from './TimerInstance';

/** 解決に失敗した理由。文言を選ぶためだけに使う。 */
export type TimerResolveFailure = 'read-only' | 'not-found';

/**
 * Shared timer target resolution helpers.
 */
export class TimerTaskResolver {
    constructor(private plugin: PluginContext) { }

    /**
     * 解決に失敗した理由を分ける。
     *
     * 解決手段はどれも候補に tvInline / tvFile を要求するので、day-planner や
     * tasks-plugin のタスクは「見つからない」のと同じ経路で落ちる。しかし原因は
     * 別物で、こちらは最初から書き込めない形式であり、あちらは行を見失った状態
     * である。同じ文言（削除・移動・リネームの可能性）を出すと原因を取り違える。
     *
     * 解決が失敗したときだけ呼ぶ。除外された候補が実在するかどうかは id で
     * 引き直さないと分からない。
     */
    explainFailure(timer: Pick<TimerInstance, 'taskId'>): TimerResolveFailure {
        const task = this.plugin.getTaskIndex().getTask(timer.taskId);
        return task?.isReadOnly ? 'read-only' : 'not-found';
    }

    resolveTvInline(timer: Pick<TimerInstance, 'taskId' | 'taskFile' | 'taskOriginalText' | 'timerTargetId'>): Task | undefined {
        const taskIndex = this.plugin.getTaskIndex();
        const allTasks = taskIndex.getTasks();

        if (timer.timerTargetId) {
            const byTargetInFile = timer.taskFile
                ? allTasks.find((task) =>
                    isTvInline(task)
                    && task.file === timer.taskFile
                    && (task.timerTargetId === timer.timerTargetId || task.blockId === timer.timerTargetId)
                )
                : undefined;
            if (byTargetInFile) {
                return byTargetInFile;
            }

            const byTarget = allTasks.find((task) =>
                isTvInline(task)
                && (task.timerTargetId === timer.timerTargetId || task.blockId === timer.timerTargetId)
            );
            if (byTarget) {
                return byTarget;
            }
        }

        const byId = taskIndex.getTask(timer.taskId);
        if (byId && isTvInline(byId)) {
            if (!timer.taskFile || byId.file === timer.taskFile) {
                return byId;
            }
        }

        if (timer.taskOriginalText && timer.taskFile) {
            const byOriginalText = allTasks.find((task) =>
                isTvInline(task)
                && task.file === timer.taskFile
                && task.originalText === timer.taskOriginalText
            );
            if (byOriginalText) {
                return byOriginalText;
            }
        }

        return undefined;
    }

    resolveTvFile(timer: Pick<TimerInstance, 'taskId' | 'taskFile' | 'timerTargetId'>): Task | undefined {
        const taskIndex = this.plugin.getTaskIndex();
        const allTasks = taskIndex.getTasks();

        if (timer.timerTargetId) {
            const byTargetInFile = timer.taskFile
                ? allTasks.find((task) =>
                    isTvFile(task)
                    && task.file === timer.taskFile
                    && task.timerTargetId === timer.timerTargetId
                )
                : undefined;
            if (byTargetInFile) {
                return byTargetInFile;
            }

            const byTarget = allTasks.find((task) =>
                isTvFile(task)
                && task.timerTargetId === timer.timerTargetId
            );
            if (byTarget) {
                return byTarget;
            }
        }

        const byId = taskIndex.getTask(timer.taskId);
        if (byId && isTvFile(byId)) {
            return byId;
        }

        if (!timer.taskFile) {
            return undefined;
        }

        return allTasks.find((task) => isTvFile(task) && task.file === timer.taskFile);
    }
}

