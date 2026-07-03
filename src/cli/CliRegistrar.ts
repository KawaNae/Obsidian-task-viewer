import type { CliFlags, CliHandler } from 'obsidian';
import type TaskViewerPlugin from '../main';
import {
    toCliFlags,
    LIST_SCHEMA, TODAY_SCHEMA, GET_SCHEMA, CREATE_SCHEMA, UPDATE_SCHEMA,
    DELETE_SCHEMA, DUPLICATE_SCHEMA, CONVERT_SCHEMA,
    TASKS_FOR_DATE_RANGE_SCHEMA, CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA,
    INSERT_CHILD_TASK_SCHEMA, CREATE_TV_FILE_SCHEMA,
} from '../api/OperationSchemas';
import { validateCliParams } from './CliParamValidator';
import { createListHandler, createTodayHandler, createGetHandler } from './handlers/TaskQueryHandlers';
import { createCreateHandler, createUpdateHandler, createDeleteHandler } from './handlers/TaskCrudHandlers';
import { createDuplicateHandler, createConvertHandler, createTasksForDateRangeHandler, createCategorizedTasksForDateRangeHandler, createInsertChildTaskHandler, createCreateTvFileHandler, createGetStartHourHandler } from './handlers/TaskActionHandlers';
import { createHelpHandler } from './handlers/HelpHandler';

/**
 * Register all CLI handlers for the Task Viewer plugin.
 * Call once from plugin.onload() after TaskIndex is initialized.
 *
 * Flag declarations are derived from OperationSchemas (the single source of
 * truth for the CLI/API parameter surface), and every handler is wrapped
 * with strict validation: unknown flags error with a did-you-mean
 * suggestion instead of being silently ignored.
 *
 * Commands (14): list, today, get, create, update, delete, duplicate, convert, tasks-for-date-range,
 *                 categorized-tasks-for-date-range, insert-child-task, create-tv-file, get-start-hour, help
 */
export function registerCliHandlers(plugin: TaskViewerPlugin): void {
    function register(action: string, description: string, flags: CliFlags | null, handler: CliHandler): void {
        const wrapped: CliHandler = (params) => {
            const err = validateCliParams(params, flags, action);
            if (err) return err;
            return handler(params);
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

    register('convert', 'Convert tv-inline task to tv-file (frontmatter) task. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(CONVERT_SCHEMA), createConvertHandler(plugin));

    register('tasks-for-date-range', 'List tasks in a date range. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(TASKS_FOR_DATE_RANGE_SCHEMA, { output: true }), createTasksForDateRangeHandler(plugin));

    register('categorized-tasks-for-date-range', 'Get tasks in a date range, categorized into allDay/timed/dueOnly per date. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA), createCategorizedTasksForDateRangeHandler(plugin));

    register('insert-child-task', 'Insert a child task under a parent. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(INSERT_CHILD_TASK_SCHEMA), createInsertChildTaskHandler(plugin));

    register('create-tv-file', 'Create a new tv-file (frontmatter) task. Details: obsidian obsidian-task-viewer:help',
        toCliFlags(CREATE_TV_FILE_SCHEMA), createCreateTvFileHandler(plugin));

    register('get-start-hour', 'Get the current startHour setting (visual day boundary)',
        null, createGetStartHourHandler(plugin));

    // ── Help ──

    register('help', 'Show detailed CLI reference', null, createHelpHandler());
}
