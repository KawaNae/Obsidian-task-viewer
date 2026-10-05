import type { CliData } from 'obsidian';
import type { PluginContext } from '../../PluginContext';
import type { ApiHost } from '../../api/TaskApi';
import { formatOutput, resolveFields, cliOk, cliError, wrapCliResult, validateFormat, readIntFlag, readLimitFlag, type OutputFormat } from '../CliOutputFormatter';
import { parseSortFlag } from '../CliFilterBuilder';
import { cliDataToSimpleFilterParams } from './TaskQueryHandlers';

export function createDuplicateHandler(plugin: PluginContext & ApiHost) {
    return async (params: CliData): Promise<string> => {
        return wrapCliResult('duplicate task', async () => {
            const dayOffset = readIntFlag(params, 'dayOffset');
            const count = readIntFlag(params, 'count');
            const result = await plugin.api.duplicate({ id: params.id, dayOffset, count });
            return cliOk({ duplicated: result.duplicated });
        });
    };
}

export function createCategorizedTasksForDateRangeHandler(plugin: PluginContext & ApiHost) {
    return async (params: CliData): Promise<string> => {
        return wrapCliResult('categorize tasks', async () => {
            const result = await plugin.api.categorizedTasksForDateRange({
                from: params.from,
                to: params.to,
                ...cliDataToSimpleFilterParams(params),
                filterFile: params['filter-file'],
                list: params.list,
                startHour: readIntFlag(params, 'startHour'),
            });
            return cliOk(result);
        });
    };
}

export function createInsertChildTaskHandler(plugin: PluginContext & ApiHost) {
    return async (params: CliData): Promise<string> => {
        return wrapCliResult('insert child task', async () => {
            const result = await plugin.api.insertChildTask({
                parentId: params['parent-id'],
                content: params.content,
            });
            return cliOk({ parentId: result.parentId });
        });
    };
}

export function createGetStartHourHandler(plugin: PluginContext & ApiHost) {
    return (): string => {
        const result = plugin.api.getStartHour();
        return cliOk({ ...result });
    };
}

export function createTasksForDateRangeHandler(plugin: PluginContext & ApiHost) {
    return async (params: CliData): Promise<string> => {
        const formatErr = validateFormat(params.format);
        if (formatErr) return cliError(formatErr);

        return wrapCliResult('query date range', async () => {
            const format = (params.format as OutputFormat) || 'json';
            const sort = params.sort ? parseSortFlag(params.sort) : undefined;
            const limit = readLimitFlag(params, format);

            const result = await plugin.api.tasksForDateRange({
                from: params.from,
                to: params.to,
                ...cliDataToSimpleFilterParams(params),
                filterFile: params['filter-file'],
                list: params.list,
                startHour: readIntFlag(params, 'startHour'),
                sort,
                limit,
            });
            const fields = resolveFields(params['output-fields']);
            const meta = { total: result.total, truncated: result.truncated, limit: result.limit };
            return formatOutput(result.tasks, format, fields, meta);
        });
    };
}
