import { TFile } from 'obsidian';
import type { CliData } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import type { Task } from '../../types';
import { toDisplayTask } from '../../utils/DisplayTaskConverter';
import { formatTask, cliOk, cliError } from '../CliOutputFormatter';
import { parseDateTimeFlag } from '../CliFilterBuilder';

export function createCreateHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.file) return cliError('Missing required flag: --file');
        if (!params.content) return cliError('Missing required flag: --content');

        const file = plugin.app.vault.getAbstractFileByPath(params.file);
        if (!(file instanceof TFile)) {
            return cliError(`File not found: ${params.file}`);
        }

        const statusChar = params.status || ' ';
        const content = params.content;

        // Build at-notation line: - [x] content @start>end>due
        let line = `- [${statusChar}] ${content}`;

        const hasDateFields = params.start || params.end || params.due;
        if (hasDateFields) {
            let dateBlock = '';
            if (params.start) {
                const { date, time } = parseDateTimeFlag(params.start);
                dateBlock = `@${date}`;
                if (time) dateBlock += `T${time}`;
            } else {
                dateBlock = '@';
            }

            if (params.end) {
                const { date, time } = parseDateTimeFlag(params.end);
                dateBlock += `>${date}`;
                if (time) dateBlock += `T${time}`;
            }

            if (params.due) {
                // Ensure we have the end separator
                if (!params.end) dateBlock += '>';
                const { date } = parseDateTimeFlag(params.due);
                dateBlock += `>${date}`;
            }

            line += ` ${dateBlock}`;
        }

        try {
            const repo = plugin.getTaskRepository();
            await repo.appendTaskToFile(params.file, line);
            return cliOk({ status: 'ok', file: params.file, line });
        } catch (e) {
            return cliError(`Failed to create task: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}

export function createUpdateHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.id) return cliError('Missing required flag: --id');

        const taskIndex = plugin.getTaskIndex();
        const task = taskIndex.getTask(params.id);
        if (!task) return cliError(`Task not found: ${params.id}`);

        const updates: Partial<Task> = {};

        if (params.content !== undefined) updates.content = params.content;
        if (params.status !== undefined) updates.statusChar = params.status;

        if (params.start !== undefined) {
            const { date, time } = parseDateTimeFlag(params.start);
            if (date) updates.startDate = date;
            if (time) updates.startTime = time;
        }

        if (params.end !== undefined) {
            const { date, time } = parseDateTimeFlag(params.end);
            if (date) updates.endDate = date;
            if (time) updates.endTime = time;
        }

        if (params.due !== undefined) {
            const { date } = parseDateTimeFlag(params.due);
            updates.due = date;
        }

        try {
            await taskIndex.updateTask(params.id, updates);
            const updated = taskIndex.getTask(params.id);
            if (updated) {
                return JSON.stringify(formatTask(toDisplayTask(updated, plugin.settings.startHour)));
            }
            return cliOk({ status: 'ok', id: params.id });
        } catch (e) {
            return cliError(`Failed to update task: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}

export function createCompleteHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.id) return cliError('Missing required flag: --id');

        const taskIndex = plugin.getTaskIndex();
        const task = taskIndex.getTask(params.id);
        if (!task) return cliError(`Task not found: ${params.id}`);

        try {
            await taskIndex.updateTask(params.id, { statusChar: 'x' });
            const updated = taskIndex.getTask(params.id);
            if (updated) {
                return JSON.stringify(formatTask(toDisplayTask(updated, plugin.settings.startHour)));
            }
            return cliOk({ status: 'ok', id: params.id });
        } catch (e) {
            return cliError(`Failed to complete task: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}

export function createDeleteHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.id) return cliError('Missing required flag: --id');

        const taskIndex = plugin.getTaskIndex();
        const task = taskIndex.getTask(params.id);
        if (!task) return cliError(`Task not found: ${params.id}`);

        try {
            await taskIndex.deleteTask(params.id);
            return cliOk({ status: 'ok', deleted: params.id });
        } catch (e) {
            return cliError(`Failed to delete task: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}
