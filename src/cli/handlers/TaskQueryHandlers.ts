import type { CliData } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import type { FilterState } from '../../services/filter/FilterTypes';
import { loadFilterFile } from '../../api/FilterFileLoader';
import { TaskApiError } from '../../api/TaskApiTypes';
import type { ListParams, TodayParams, ApiSortRule } from '../../api/TaskApiTypes';
import {
    formatOutput, formatSingleTask, resolveFields, cliError,
    type OutputFormat,
} from '../CliOutputFormatter';

const VALID_FORMATS = new Set(['json', 'tsv', 'jsonl']);

// ── CliData → typed params converters ──

function parseSortFlag(sortFlag: string): ApiSortRule[] {
    return sortFlag.split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(segment => {
            const [prop, dir] = segment.split(':');
            return {
                property: prop as ApiSortRule['property'],
                direction: (dir === 'desc' ? 'desc' : 'asc') as ApiSortRule['direction'],
            };
        });
}

function cliDataToListParams(params: CliData, preloadedFilter?: FilterState): ListParams {
    const result: ListParams = {};

    if (preloadedFilter) {
        result.filter = preloadedFilter;
    } else {
        if (params.file) result.file = params.file;
        if (params.status) result.status = params.status.split(',').map(s => s.trim()).filter(Boolean);
        if (params.tag) result.tag = params.tag.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
        if (params.content) result.content = params.content;
        if (params.date) result.date = params.date;
        if (params.from) result.from = params.from;
        if (params.to) result.to = params.to;
        if (params.due) result.due = params.due;
        if (params.leaf === 'true') result.leaf = true;
        if (params.property) result.property = params.property;
        if (params.color) result.color = params.color;
        if (params.type) result.type = params.type;
        if (params.root === 'true') result.root = true;
    }

    if (params.sort) result.sort = parseSortFlag(params.sort);
    if (params.limit) {
        const limit = parseInt(params.limit, 10);
        if (isNaN(limit) || limit < 0) throw new TaskApiError('--limit must be a non-negative integer');
        result.limit = limit;
    }
    if (params.offset) result.offset = Math.max(0, parseInt(params.offset, 10) || 0);

    return result;
}

function cliDataToTodayParams(params: CliData): TodayParams {
    const result: TodayParams = {};
    if (params.leaf === 'true') result.leaf = true;
    if (params.sort) result.sort = parseSortFlag(params.sort);
    if (params.limit) {
        const limit = parseInt(params.limit, 10);
        if (isNaN(limit) || limit < 0) throw new TaskApiError('--limit must be a non-negative integer');
        result.limit = limit;
    }
    if (params.offset) result.offset = Math.max(0, parseInt(params.offset, 10) || 0);
    return result;
}

// ── Format helpers ──

function validateFormat(params: CliData): string | null {
    if (params.format && !VALID_FORMATS.has(params.format)) {
        return `Invalid format: ${params.format}. Must be json, tsv, or jsonl`;
    }
    return null;
}

// ── Handlers ──

export function createListHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        const formatErr = validateFormat(params);
        if (formatErr) return cliError(formatErr);

        try {
            let preloadedFilter: FilterState | undefined;

            const filterFilePath = params['filter-file'];
            if (filterFilePath) {
                const result = await loadFilterFile(plugin.app, filterFilePath, params.list);
                if (typeof result === 'string') return cliError(result);
                preloadedFilter = result;
            }

            const apiParams = cliDataToListParams(params, preloadedFilter);
            const listResult = await plugin.api.list(apiParams);

            const format = (params.format as OutputFormat) || 'json';
            const fields = resolveFields(params.outputFields);
            return formatOutput(listResult.tasks, format, fields);
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : String(e));
        }
    };
}

export function createTodayHandler(plugin: TaskViewerPlugin) {
    return (params: CliData): string => {
        const formatErr = validateFormat(params);
        if (formatErr) return cliError(formatErr);

        try {
            const apiParams = cliDataToTodayParams(params);
            const result = plugin.api.today(apiParams);

            const format = (params.format as OutputFormat) || 'json';
            const fields = resolveFields(params.outputFields);
            return formatOutput(result.tasks, format, fields);
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : String(e));
        }
    };
}

export function createGetHandler(plugin: TaskViewerPlugin) {
    return (params: CliData): string => {
        if (!params.id) return cliError('Missing required flag: --id');
        const formatErr = validateFormat(params);
        if (formatErr) return cliError(formatErr);

        try {
            const displayTask = plugin.api.get({ id: params.id });
            const format = (params.format as OutputFormat) || 'json';
            const fields = resolveFields(params.outputFields);
            return formatSingleTask(displayTask, format, fields);
        } catch (e) {
            return cliError(e instanceof TaskApiError ? e.rawMessage : String(e));
        }
    };
}
