import type { CliData } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import { TaskApiError } from '../../api/TaskApiTypes';
import { pickFields, resolveFields, cliOk, cliError, wrapCliResult } from '../CliOutputFormatter';

export function createCreateHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.file) return cliError('Missing required flag: --file');
        if (!params.content) return cliError('Missing required flag: --content');

        let fields: string[];
        try { fields = resolveFields(params['output-fields']); } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : String(e));
        }

        return wrapCliResult('create task', async () => {
            const result = await plugin.api.create({
                file: params.file,
                content: params.content,
                start: params.start,
                end: params.end,
                due: params.due,
                status: params.status,
                heading: params.heading,
            });
            return cliOk({ task: pickFields(result.task, fields) });
        });
    };
}

export function createUpdateHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.id) return cliError('Missing required flag: --id');

        let fields: string[];
        try { fields = resolveFields(params['output-fields']); } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : String(e));
        }

        return wrapCliResult('update task', async () => {
            const result = await plugin.api.update({
                id: params.id,
                content: params.content,
                start: params.start,
                end: params.end,
                due: params.due,
                status: params.status,
            });
            return cliOk({ task: pickFields(result.task, fields) });
        });
    };
}

export function createDeleteHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.id) return cliError('Missing required flag: --id');

        return wrapCliResult('delete task', async () => {
            const result = await plugin.api.delete({ id: params.id });
            return cliOk({ deleted: result.deleted });
        });
    };
}
