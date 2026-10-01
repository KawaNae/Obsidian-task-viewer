import type { CliFlags, CliHandler } from 'obsidian';
import type { CliRegistrar, PluginContext } from '../PluginContext';
import type { ExportHost } from '../services/export/ExportService';
import type { ApiHost } from '../api/TaskApi';
import { cliErrorOf } from './CliOutputFormatter';
import {
    toCliFlags,
    LIST_SCHEMA, TODAY_SCHEMA, GET_SCHEMA, CREATE_SCHEMA, UPDATE_SCHEMA,
    DELETE_SCHEMA, DUPLICATE_SCHEMA,
    TASKS_FOR_DATE_RANGE_SCHEMA, CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA,
    INSERT_CHILD_TASK_SCHEMA, EXPORT_IMAGE_SCHEMA,
} from '../api/OperationSchemas';
import { refuseEmptyFlags, validateCliParams } from './CliParamValidator';
import { createListHandler, createTodayHandler, createGetHandler } from './handlers/TaskQueryHandlers';
import { createCreateHandler, createUpdateHandler, createDeleteHandler } from './handlers/TaskCrudHandlers';
import { createDuplicateHandler, createTasksForDateRangeHandler, createCategorizedTasksForDateRangeHandler, createInsertChildTaskHandler, createGetStartHourHandler } from './handlers/TaskActionHandlers';
import { createExportImageHandler } from './handlers/ExportImageHandler';
import { createHelpHandler } from './handlers/HelpHandler';

/**
 * How the registrar checks a command's flags before its handler runs.
 * `strict`: only the declared flags, a boolean one without a value.
 * `handler`: the handler checks its flags itself — `export-image` takes the
 * flags of the view it exports, which are known only once the view is.
 */
type FlagCheck = 'strict' | 'handler';

/**
 * Register all CLI handlers for the Task Viewer plugin.
 * Call once from plugin.onload() after TaskIndex is initialized.
 *
 * Flag declarations are derived from OperationSchemas (the single source of
 * truth for the CLI/API parameter surface), and every handler is registered
 * through one wrapper: its flags are checked (`FlagCheck`) — unknown flags
 * error with a did-you-mean suggestion instead of being silently ignored —
 * a flag given empty is refused (`refuseEmptyFlags`), and an error it throws
 * comes back as a cliError.
 *
 * Whether a parameter is required and whether its value is one the
 * operation takes is the API's to check, once: a handler only turns the
 * flags' text into the API's types and passes them on.
 *
 * Commands (13): list, today, get, create, update, delete, duplicate, tasks-for-date-range,
 *                 categorized-tasks-for-date-range, insert-child-task, get-start-hour,
 *                 export-image, help
 */
export function registerCliHandlers(plugin: PluginContext & CliRegistrar & ApiHost & ExportHost): void {
    function register(action: string, description: string, flags: CliFlags | null, handler: CliHandler, check: FlagCheck = 'strict'): void {
        const wrapped: CliHandler = async (params) => {
            const err = (check === 'strict' ? validateCliParams(params, flags, action) : null) ?? refuseEmptyFlags(params);
            if (err) return err;
            try {
                return await handler(params);
            } catch (e) {
                return cliErrorOf(e);
            }
        };
        plugin.registerCliHandler(`obsidian-task-viewer:${action}`, description, flags, wrapped);
    }

    // ── Query commands (read-only) ──

    register('list', 'List tasks with optional filters. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(LIST_SCHEMA, { output: true }), createListHandler(plugin));

    register('today', 'List tasks active today (visual-date aware). Details: obsidian obsidian-task-viewer:help',
        toCliFlags(TODAY_SCHEMA, { output: true }), createTodayHandler(plugin));

    register('get', 'Get a single task by ID. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(GET_SCHEMA, { output: true }), createGetHandler(plugin));

    // ── CRUD commands ──

    register('create', 'Create a new inline task. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(CREATE_SCHEMA, { output: true }), createCreateHandler(plugin));

    register('update', 'Update an existing task. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(UPDATE_SCHEMA, { output: true }), createUpdateHandler(plugin));

    register('delete', 'Delete a task. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(DELETE_SCHEMA), createDeleteHandler(plugin));

    // ── Action commands ──

    register('duplicate', 'Duplicate a task with optional date shifting. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(DUPLICATE_SCHEMA), createDuplicateHandler(plugin));

    register('tasks-for-date-range', 'List tasks in a date range. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(TASKS_FOR_DATE_RANGE_SCHEMA, { output: true }), createTasksForDateRangeHandler(plugin));

    register('categorized-tasks-for-date-range', 'Get tasks in a date range, categorized into allDay/timed/dueOnly per date. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA), createCategorizedTasksForDateRangeHandler(plugin));

    register('insert-child-task', 'Insert a child task under a parent. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(INSERT_CHILD_TASK_SCHEMA), createInsertChildTaskHandler(plugin));

    register('get-start-hour', 'Get the current startHour setting (visual day boundary)',
        null, createGetStartHourHandler(plugin));

    // ── Export ──

    register('export-image', 'Export a view as a PNG image',
        toCliFlags(EXPORT_IMAGE_SCHEMA), createExportImageHandler(plugin), 'handler');

    // ── Help ──

    register('help', 'Show detailed CLI reference', null, createHelpHandler());

}
