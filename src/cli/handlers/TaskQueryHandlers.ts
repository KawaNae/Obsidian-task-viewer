import type { CliData } from 'obsidian';
import type { PluginContext } from '../../PluginContext';
import type { ApiHost } from '../../api/TaskApi';
import type { SimpleFilterParams } from '../../api/TaskApiTypes';
import type { ListParams, TodayParams } from '../../api/TaskApiTypes';
import { parseSortFlag } from '../CliFilterBuilder';
import { refuseWindowOnToday } from '../../api/QueryShorthand';
import { TODAY_SCHEMA, toCliFlags } from '../../api/OperationSchemas';
import { validateCliParams } from '../CliParamValidator';
import {
    formatOutput, formatSingleTask, resolveFields, cliError, wrapCliResult,
    validateFormat, readLimitFlag, readIntFlag,
    type OutputFormat,
} from '../CliOutputFormatter';

// ── CliData → typed params converters ──

/**
 * Maps the simple per-field filter flags every query takes. The window
 * (`date`, `from`, `to`) and the filter file are read by each command, as
 * each takes them.
 */
export function cliDataToSimpleFilterParams(params: CliData): SimpleFilterParams {
    const result: SimpleFilterParams = {};
    if (params.file) result.file = params.file;
    if (params.status) result.status = params.status.split(',').map(s => s.trim()).filter(Boolean);
    if (params.tag) result.tag = params.tag.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
    if (params.content) result.content = params.content;
    if (params.due) result.due = params.due;
    if (params.leaf === 'true') result.leaf = true;
    if (params.property) result.property = params.property;
    if (params.color) result.color = params.color;
    if (params.type) result.type = params.type;
    if (params.root === 'true') result.root = true;
    return result;
}

/**
 * The flags of a query but its window, as the API's params: the simple
 * fields, the filter file and the list in it, start-hour, sort and limit. A filter file
 * goes to the API as it is: the API reads it, and takes it together with
 * the rest, as it does for any caller.
 */
function cliDataToQueryParams(params: CliData, format: OutputFormat): TodayParams {
    const result: TodayParams = cliDataToSimpleFilterParams(params);
    if (params['filter-file']) result.filterFile = params['filter-file'];
    if (params.list) result.list = params.list;
    if (params.sort) result.sort = parseSortFlag(params.sort);
    result.limit = readLimitFlag(params, format);
    const startHour = readIntFlag(params, 'startHour');
    if (startHour !== undefined) result.startHour = startHour;
    return result;
}

/** `list`'s flags as the API's params: a query's, and its window. */
function cliDataToListParams(params: CliData, format: OutputFormat): ListParams {
    const result: ListParams = cliDataToQueryParams(params, format);
    if (params.date) result.date = params.date;
    if (params.from) result.from = params.from;
    if (params.to) result.to = params.to;
    return result;
}


// ── Handlers ──

export function createListHandler(plugin: PluginContext & ApiHost) {
    return async (params: CliData): Promise<string> => {
        const formatErr = validateFormat(params.format);
        if (formatErr) return cliError(formatErr);

        return wrapCliResult('list tasks', async () => {
            const format = (params.format as OutputFormat) || 'json';
            const apiParams = cliDataToListParams(params, format);
            const listResult = await plugin.api.list(apiParams);
            const fields = resolveFields(params['output-fields']);
            const meta = { total: listResult.total, truncated: listResult.truncated, limit: listResult.limit };
            return formatOutput(listResult.tasks, format, fields, meta);
        });
    };
}

/**
 * `today` takes `list`'s flags but the window, and checks its flags itself
 * (`FlagCheck` 'handler'): a window flag is refused for what it is — today
 * is `date=today` — before it would be an unknown flag.
 */
export function createTodayHandler(plugin: PluginContext & ApiHost) {
    const flags = toCliFlags(TODAY_SCHEMA, { output: true });
    return async (params: CliData): Promise<string> => {
        return wrapCliResult("list today's tasks", async () => {
            refuseWindowOnToday(params);
            const flagErr = validateCliParams(params, flags, 'today');
            if (flagErr) return flagErr;
            const formatErr = validateFormat(params.format);
            if (formatErr) return cliError(formatErr);

            const format = (params.format as OutputFormat) || 'json';
            const result = await plugin.api.today(cliDataToQueryParams(params, format));
            const fields = resolveFields(params['output-fields']);
            const meta = { total: result.total, truncated: result.truncated, limit: result.limit };
            return formatOutput(result.tasks, format, fields, meta);
        });
    };
}

export function createGetHandler(plugin: PluginContext & ApiHost) {
    return async (params: CliData): Promise<string> => {
        const formatErr = validateFormat(params.format);
        if (formatErr) return cliError(formatErr);

        return wrapCliResult('get task', () => {
            const displayTask = plugin.api.get({ id: params.id, startHour: readIntFlag(params, 'startHour') });
            const format = (params.format as OutputFormat) || 'json';
            const fields = resolveFields(params['output-fields']);
            return formatSingleTask(displayTask, format, fields);
        });
    };
}
