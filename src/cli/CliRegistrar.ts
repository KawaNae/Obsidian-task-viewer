import type { CliFlags, CliHandler } from 'obsidian';
import type { CliRegistrar, PluginContext } from '../PluginContext';
import type { ExportHost } from '../services/export/ExportService';
import type { ApiHost } from '../api/TaskApi';
import { cliErrorOf } from './CliOutputFormatter';
import { toCliFlags } from '../api/OperationSchemas';
import { CLI_COMMANDS, type CliOperation, type FlagCheck } from '../api/Reference';
import { refuseEmptyFlags, validateCliParams } from './CliParamValidator';
import { createListHandler, createTodayHandler, createGetHandler } from './handlers/TaskQueryHandlers';
import { createCreateHandler, createUpdateHandler, createDeleteHandler } from './handlers/TaskCrudHandlers';
import { createDuplicateHandler, createTasksForDateRangeHandler, createCategorizedTasksForDateRangeHandler, createInsertChildTaskHandler, createGetStartHourHandler } from './handlers/TaskActionHandlers';
import { createExportImageHandler } from './handlers/ExportImageHandler';
import { createHelpHandler } from './handlers/HelpHandler';

type Host = PluginContext & CliRegistrar & ApiHost & ExportHost;

/** The handler of each command. The commands are `CLI_COMMANDS`; a command without a handler is a compile error. */
const HANDLERS: { [K in CliOperation]: (plugin: Host) => CliHandler } = {
    list: createListHandler,
    today: createTodayHandler,
    get: createGetHandler,
    create: createCreateHandler,
    update: createUpdateHandler,
    delete: createDeleteHandler,
    duplicate: createDuplicateHandler,
    tasksForDateRange: createTasksForDateRangeHandler,
    categorizedTasksForDateRange: createCategorizedTasksForDateRangeHandler,
    insertChildTask: createInsertChildTaskHandler,
    getStartHour: createGetStartHourHandler,
    exportImage: createExportImageHandler,
    help: () => createHelpHandler(),
};

/**
 * Register all CLI handlers for the Task Viewer plugin.
 * Call once from plugin.onload() after TaskIndex is initialized.
 *
 * The commands, their summaries and their flags are the reference's table
 * (`CLI_COMMANDS`), which the help reads too: flag declarations are derived
 * from OperationSchemas (the single source of truth for the CLI/API
 * parameter surface). Every handler is registered through one wrapper: its
 * flags are checked (`FlagCheck`) — unknown flags error with a did-you-mean
 * suggestion instead of being silently ignored — a flag given empty is
 * refused (`refuseEmptyFlags`), and an error it throws comes back as a
 * cliError.
 *
 * Whether a parameter is required and whether its value is one the
 * operation takes is the API's to check, once: a handler only turns the
 * flags' text into the API's types and passes them on.
 */
export function registerCliHandlers(plugin: Host): void {
    function register(action: string, description: string, flags: CliFlags | null, handler: CliHandler, check: FlagCheck): void {
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

    for (const command of CLI_COMMANDS) {
        const flags = command.schema ? toCliFlags(command.schema, { output: command.output }) : null;
        const description = command.operation === 'help'
            ? command.summary
            : `${command.summary}. Details: obsidian obsidian-task-viewer:help`;
        register(command.name, description, flags, HANDLERS[command.operation](plugin), command.flagCheck);
    }
}
