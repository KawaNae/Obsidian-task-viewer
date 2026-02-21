import TaskViewerPlugin from '../main';
import { Task } from '../types';
import { TimerInstance } from './TimerInstance';

/**
 * Shared timer target resolution helpers.
 */
export class TimerTaskResolver {
    constructor(private plugin: TaskViewerPlugin) { }

    resolveInlineTask(timer: Pick<TimerInstance, 'taskId' | 'taskFile' | 'taskOriginalText' | 'timerTargetId'>): Task | undefined {
        const taskIndex = this.plugin.getTaskIndex();
        const allTasks = taskIndex.getTasks();

        if (timer.timerTargetId) {
            const byTargetInFile = timer.taskFile
                ? allTasks.find((task) =>
                    task.parserId === 'at-notation'
                    && task.file === timer.taskFile
                    && (task.timerTargetId === timer.timerTargetId || task.blockId === timer.timerTargetId)
                )
                : undefined;
            if (byTargetInFile) {
                return byTargetInFile;
            }

            const byTarget = allTasks.find((task) =>
                task.parserId === 'at-notation'
                && (task.timerTargetId === timer.timerTargetId || task.blockId === timer.timerTargetId)
            );
            if (byTarget) {
                return byTarget;
            }
        }

        const byId = taskIndex.getTask(timer.taskId);
        if (byId && byId.parserId === 'at-notation') {
            if (!timer.taskFile || byId.file === timer.taskFile) {
                return byId;
            }
        }

        if (timer.taskOriginalText && timer.taskFile) {
            const byOriginalText = allTasks.find((task) =>
                task.parserId === 'at-notation'
                && task.file === timer.taskFile
                && task.originalText === timer.taskOriginalText
            );
            if (byOriginalText) {
                return byOriginalText;
            }
        }

        return undefined;
    }

    resolveFrontmatterTask(timer: Pick<TimerInstance, 'taskId' | 'taskFile' | 'timerTargetId'>): Task | undefined {
        const taskIndex = this.plugin.getTaskIndex();
        const allTasks = taskIndex.getTasks();

        if (timer.timerTargetId) {
            const byTargetInFile = timer.taskFile
                ? allTasks.find((task) =>
                    task.parserId === 'frontmatter'
                    && task.file === timer.taskFile
                    && task.timerTargetId === timer.timerTargetId
                )
                : undefined;
            if (byTargetInFile) {
                return byTargetInFile;
            }

            const byTarget = allTasks.find((task) =>
                task.parserId === 'frontmatter'
                && task.timerTargetId === timer.timerTargetId
            );
            if (byTarget) {
                return byTarget;
            }
        }

        const byId = taskIndex.getTask(timer.taskId);
        if (byId && byId.parserId === 'frontmatter') {
            return byId;
        }

        if (!timer.taskFile) {
            return undefined;
        }

        return allTasks.find((task) => task.parserId === 'frontmatter' && task.file === timer.taskFile);
    }
}

