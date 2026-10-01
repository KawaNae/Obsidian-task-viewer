import type { CliData } from 'obsidian';
import type { PluginContext } from '../../PluginContext';
import type { ApiHost } from '../../api/TaskApi';
import { pickFields, resolveFields, cliOk, cliErrorOf, wrapCliResult } from '../CliOutputFormatter';

export function createCreateHandler(plugin: PluginContext & ApiHost) {
    return async (params: CliData): Promise<string> => {
        let fields: string[];
        try { fields = resolveFields(params['output-fields']); } catch (e) {
            return cliErrorOf(e);
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

export function createUpdateHandler(plugin: PluginContext & ApiHost) {
    return async (params: CliData): Promise<string> => {
        let fields: string[];
        try { fields = resolveFields(params['output-fields']); } catch (e) {
            return cliErrorOf(e);
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

export function createDeleteHandler(plugin: PluginContext & ApiHost) {
    return async (params: CliData): Promise<string> => {
        return wrapCliResult('delete task', async () => {
            const result = await plugin.api.delete({ id: params.id });
            return cliOk({ deleted: result.deleted });
        });
    };
}
