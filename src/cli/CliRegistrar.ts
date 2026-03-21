import type { CliFlags } from 'obsidian';
import type TaskViewerPlugin from '../main';
import { createListHandler, createTodayHandler, createGetHandler } from './handlers/TaskQueryHandlers';

import { createCreateHandler, createUpdateHandler, createDeleteHandler } from './handlers/TaskCrudHandlers';
import { createHelpHandler } from './handlers/HelpHandler';

/**
 * Register all CLI handlers for the Task Viewer plugin.
 * Call once from plugin.onload() after TaskIndex is initialized.
 *
 * Commands (7): list, today, get, create, update, delete, help
 */
export function registerCliHandlers(plugin: TaskViewerPlugin): void {
    // ── Query commands (read-only) ──

    const listFlags: CliFlags = {
        file:    { value: '<path>',          description: 'Filter by file path' },
        status:  { value: '<chars>',         description: 'Filter by status char(s), comma-separated' },
        date:    { value: '<date|preset>',   description: 'Tasks active on date (spans and single-day)' },
        tag:     { value: '<tags>',          description: 'Filter by tag(s), comma-separated' },
        content: { value: '<text>',          description: 'Filter by content (contains)' },
        from:    { value: '<date|preset>',   description: 'Filter: startDate >= value' },
        to:      { value: '<date|preset>',   description: 'Filter: endDate <= value (null endDate excluded)' },
        due:     { value: '<date|preset>',   description: 'Due date equals' },
        leaf:    { description: 'Only leaf tasks (no children)' },
        property: { value: '<key:value>',   description: 'Filter by custom property (e.g. "優先度:高")' },
        color:   { value: '<colors>',        description: 'Filter by color(s), comma-separated' },
        type:    { value: '<types>',          description: 'Filter by task type (at-notation, frontmatter)' },
        root:    { description: 'Only root tasks (no parent)' },
        'filter-file': { value: '<path>',     description: 'FilterState JSON (.json) or view template (.md). Overrides simple filter flags' },
        list:    { value: '<name>',          description: 'Pinned list name (for .md templates with pinnedLists)' },
        sort:    { value: '<prop[:dir],..>', description: 'Sort (e.g. startDate:asc,due:desc)' },
        limit:   { value: '<number>',        description: 'Max results (default: 100)' },
        offset:  { value: '<number>',        description: 'Skip first N results' },
        format:  { value: 'json|tsv|jsonl',  description: 'Output format (default: json)' },
        outputFields: { value: '<key,key,...>', description: 'Output fields (default: id only). e.g. content,status,startDate' },
    };

    plugin.registerCliHandler(
        'obsidian-task-viewer:list',
        'List tasks with optional filters. Details: obsidian obsidian-task-viewer:help',
        listFlags,
        createListHandler(plugin),
    );

    const todayFlags: CliFlags = {
        leaf:   { description: 'Only leaf tasks (no children)' },
        sort:   { value: '<prop[:dir],..>', description: 'Sort' },
        limit:  { value: '<number>',        description: 'Max results' },
        offset: { value: '<number>',        description: 'Skip first N' },
        format: { value: 'json|tsv|jsonl',  description: 'Output format' },
        outputFields: { value: '<key,key,...>', description: 'Output fields (default: id only)' },
    };

    plugin.registerCliHandler(
        'obsidian-task-viewer:today',
        'List tasks active today (visual-date aware). Details: obsidian obsidian-task-viewer:help',
        todayFlags,
        createTodayHandler(plugin),
    );

    const getFlags: CliFlags = {
        id:     { value: '<taskId>',        description: 'Task ID', required: true },
        format: { value: 'json|tsv|jsonl',  description: 'Output format' },
        outputFields: { value: '<key,key,...>', description: 'Output fields (default: id only)' },
    };

    plugin.registerCliHandler(
        'obsidian-task-viewer:get',
        'Get a single task by ID. Details: obsidian obsidian-task-viewer:help',
        getFlags,
        createGetHandler(plugin),
    );

    // ── CRUD commands ──

    const createFlags: CliFlags = {
        file:    { value: '<path>',          description: 'Target file path', required: true },
        content: { value: '<text>',          description: 'Task content', required: true },
        start:   { value: '<date|datetime>', description: 'Start date (YYYY-MM-DD or YYYY-MM-DD HH:mm)' },
        end:     { value: '<date|datetime>', description: 'End date/datetime' },
        due:     { value: '<YYYY-MM-DD>',    description: 'Due date' },
        status:  { value: '<char>',          description: 'Status character (default: space)' },
        heading: { value: '<heading>',      description: 'Insert under heading (default: end of file)' },
        outputFields: { value: '<key,key,...>', description: 'Output fields (default: id only)' },
    };

    plugin.registerCliHandler(
        'obsidian-task-viewer:create',
        'Create a new inline task. Details: obsidian obsidian-task-viewer:help',
        createFlags,
        createCreateHandler(plugin),
    );

    plugin.registerCliHandler(
        'obsidian-task-viewer:update',
        'Update an existing task. Details: obsidian obsidian-task-viewer:help',
        {
            id:      { value: '<taskId>',        description: 'Task ID', required: true },
            content: { value: '<text>',          description: 'New content' },
            start:   { value: '<date|datetime>', description: 'New start date/datetime' },
            end:     { value: '<date|datetime>', description: 'New end date/datetime' },
            due:     { value: '<YYYY-MM-DD>',    description: 'New due date' },
            status:  { value: '<char>',          description: 'New status character' },
            outputFields: { value: '<key,key,...>', description: 'Output fields (default: id only)' },
        },
        createUpdateHandler(plugin),
    );

    plugin.registerCliHandler(
        'obsidian-task-viewer:delete',
        'Delete a task. Details: obsidian obsidian-task-viewer:help',
        { id: { value: '<taskId>', description: 'Task ID', required: true } },
        createDeleteHandler(plugin),
    );

    // ── Help ──

    plugin.registerCliHandler(
        'obsidian-task-viewer:help',
        'Show detailed CLI reference',
        null,
        createHelpHandler(),
    );
}
