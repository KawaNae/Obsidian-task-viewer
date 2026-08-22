import type { CliData } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import { formatOutput, resolveFields, cliOk, cliError, wrapCliResult, validateFormat, parseLimit, defaultLimitForFormat, type OutputFormat } from '../CliOutputFormatter';
import { parseSortFlag } from '../CliFilterBuilder';

export function createDuplicateHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.id) return cliError('Missing required flag: --id');

        return wrapCliResult('duplicate task', async () => {
            const dayOffset = params['day-offset'] ? parseInt(params['day-offset'], 10) : undefined;
            const count = params.count ? parseInt(params.count, 10) : undefined;

            if (dayOffset !== undefined && isNaN(dayOffset)) {
                return cliError('--day-offset must be an integer');
            }
            if (count !== undefined && (isNaN(count) || count < 1)) {
                return cliError('--count must be a positive integer');
            }

            const result = await plugin.api.duplicate({ id: params.id, dayOffset, count });
            return cliOk({ duplicated: result.duplicated });
        });
    };
}

export function createConvertHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.id) return cliError('Missing required flag: --id');

        return wrapCliResult('convert task', async () => {
            const result = await plugin.api.convertToTvFile({ id: params.id });
            return cliOk({ convertedFrom: result.convertedFrom, newFile: result.newFile });
        });
    };
}

export function createCategorizedTasksForDateRangeHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.from) return cliError('Missing required flag: --from');
        if (!params.to) return cliError('Missing required flag: --to');

        return wrapCliResult('categorize tasks', () => {
            const result = plugin.api.categorizedTasksForDateRange({ from: params.from, to: params.to });
            return cliOk(result);
        });
    };
}

export function createInsertChildTaskHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params['parent-id']) return cliError('Missing required flag: --parent-id');
        if (!params.content) return cliError('Missing required flag: --content');

        return wrapCliResult('insert child task', async () => {
            const result = await plugin.api.insertChildTask({
                parentId: params['parent-id'],
                content: params.content,
            });
            return cliOk({ parentId: result.parentId });
        });
    };
}

export function createCreateTvFileHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.content) return cliError('Missing required flag: --content');

        return wrapCliResult('create frontmatter task', async () => {
            const result = await plugin.api.createTvFile({
                content: params.content,
                start: params.start,
                end: params.end,
                due: params.due,
                status: params.status,
            });
            return cliOk({ newFile: result.newFile });
        });
    };
}

export function createGetStartHourHandler(plugin: TaskViewerPlugin) {
    return (): string => {
        const result = plugin.api.getStartHour();
        return cliOk({ ...result });
    };
}

export function createTasksForDateRangeHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.from) return cliError('Missing required flag: --from');
        if (!params.to) return cliError('Missing required flag: --to');

        const formatErr = validateFormat(params.format);
        if (formatErr) return cliError(formatErr);

        return wrapCliResult('query date range', async () => {
            const format = (params.format as OutputFormat) || 'json';
            const sort = params.sort ? parseSortFlag(params.sort) : undefined;
            const limit = params.limit ? parseLimit(params.limit) : defaultLimitForFormat(format);

            const result = await plugin.api.tasksForDateRange({
                from: params.from,
                to: params.to,
                sort,
                limit,
            });
            const fields = resolveFields(params['output-fields']);
            const meta = { total: result.total, truncated: result.truncated, limit: result.limit };
            return formatOutput(result.tasks, format, fields, meta);
        });
    };
}
