import type { CliFlags } from 'obsidian';
import type TaskViewerPlugin from '../main';
import { createListHandler, createTodayHandler, createGetHandler } from './handlers/TaskQueryHandlers';
import { createQueryHandler } from './handlers/TemplateQueryHandler';
import { createCreateHandler, createUpdateHandler, createCompleteHandler, createDeleteHandler } from './handlers/TaskCrudHandlers';

/**
 * Register all CLI handlers for the Task Viewer plugin.
 * Call once from plugin.onload() after TaskIndex is initialized.
 */
export function registerCliHandlers(plugin: TaskViewerPlugin): void {
    // ── Query commands (read-only) ──

    const listFlags: CliFlags = {
        file: { value: '<path>', description: 'Filter by file path' },
        status: { value: '<chars>', description: 'Filter by status char(s), comma-separated' },
        date: { value: '<YYYY-MM-DD>', description: 'Show tasks active on this date' },
        tag: { value: '<tags>', description: 'Filter by tag(s), comma-separated' },
        limit: { value: '<number>', description: 'Max results (default: 100)' },
    };

    plugin.registerCliHandler(
        'obsidian-task-viewer:list',
        'List tasks with optional filters',
        listFlags,
        createListHandler(plugin),
    );

    plugin.registerCliHandler(
        'obsidian-task-viewer:today',
        'List tasks active today',
        null,
        createTodayHandler(plugin),
    );

    plugin.registerCliHandler(
        'obsidian-task-viewer:get',
        'Get a single task by ID',
        { id: { value: '<taskId>', description: 'Task ID', required: true } },
        createGetHandler(plugin),
    );

    // ── Template query ──

    plugin.registerCliHandler(
        'obsidian-task-viewer:query',
        'Query tasks using a saved view template',
        {
            template: { value: '<name>', description: 'Template basename', required: true },
            date: { value: '<YYYY-MM-DD>', description: 'Override date for relative filters' },
        },
        createQueryHandler(plugin),
    );

    // ── CRUD commands ──

    const createFlags: CliFlags = {
        file: { value: '<path>', description: 'Target file path', required: true },
        content: { value: '<text>', description: 'Task content', required: true },
        start: { value: '<date|datetime>', description: 'Start date (YYYY-MM-DD or YYYY-MM-DD HH:mm)' },
        end: { value: '<date|datetime>', description: 'End date/datetime' },
        due: { value: '<YYYY-MM-DD>', description: 'Due date' },
        status: { value: '<char>', description: 'Status character (default: space)' },
    };

    plugin.registerCliHandler(
        'obsidian-task-viewer:create',
        'Create a new inline task',
        createFlags,
        createCreateHandler(plugin),
    );

    plugin.registerCliHandler(
        'obsidian-task-viewer:update',
        'Update an existing task',
        {
            id: { value: '<taskId>', description: 'Task ID', required: true },
            content: { value: '<text>', description: 'New content' },
            start: { value: '<date|datetime>', description: 'New start date/datetime' },
            end: { value: '<date|datetime>', description: 'New end date/datetime' },
            due: { value: '<YYYY-MM-DD>', description: 'New due date' },
            status: { value: '<char>', description: 'New status character' },
        },
        createUpdateHandler(plugin),
    );

    plugin.registerCliHandler(
        'obsidian-task-viewer:complete',
        'Mark a task as complete',
        { id: { value: '<taskId>', description: 'Task ID', required: true } },
        createCompleteHandler(plugin),
    );

    plugin.registerCliHandler(
        'obsidian-task-viewer:delete',
        'Delete a task',
        { id: { value: '<taskId>', description: 'Task ID', required: true } },
        createDeleteHandler(plugin),
    );
}
