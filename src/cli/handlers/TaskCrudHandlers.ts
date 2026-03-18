import type { CliData } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import { TaskApiError } from '../../api/TaskApiTypes';
import { pickFields, resolveFields, cliOk, cliError } from '../CliOutputFormatter';

export function createCreateHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.file) return cliError('Missing required flag: --file');
        if (!params.content) return cliError('Missing required flag: --content');

        try {
            const result = await plugin.api.create({
                file: params.file,
                content: params.content,
                start: params.start,
                end: params.end,
                due: params.due,
                status: params.status,
                heading: params.heading,
            });
            return cliOk({ task: pickFields(result.task, resolveFields(params.outputFields)) });
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.message : `Failed to create task: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}

export function createUpdateHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.id) return cliError('Missing required flag: --id');

        try {
            const result = await plugin.api.update({
                id: params.id,
                content: params.content,
                start: params.start,
                end: params.end,
                due: params.due,
                status: params.status,
            });
            return cliOk({ task: pickFields(result.task, resolveFields(params.outputFields)) });
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.message : `Failed to update task: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}

export function createDeleteHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.id) return cliError('Missing required flag: --id');

        try {
            const result = await plugin.api.delete({ id: params.id });
            return cliOk({ deleted: result.deleted });
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.message : `Failed to delete task: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
}
