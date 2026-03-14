import type { CliData } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import type { DisplayTask, PinnedListDefinition } from '../../types';
import { ViewTemplateLoader } from '../../services/template/ViewTemplateLoader';
import { toDisplayTasks } from '../../utils/DisplayTaskConverter';
import { TaskFilterEngine } from '../../services/filter/TaskFilterEngine';
import { TaskSorter } from '../../services/sort/TaskSorter';
import { hasConditions } from '../../services/filter/FilterTypes';
import { formatTaskList, cliError } from '../CliOutputFormatter';

export function createQueryHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        if (!params.template) return cliError('Missing required flag: --template');

        const { settings } = plugin;
        if (!settings.viewTemplateFolder) {
            return cliError('viewTemplateFolder is not configured in settings');
        }

        const loader = new ViewTemplateLoader(plugin.app);
        const summary = loader.findByBasename(settings.viewTemplateFolder, params.template);
        if (!summary) {
            return cliError(`Template not found: ${params.template}`);
        }

        const template = await loader.loadFullTemplate(summary.filePath);
        if (!template) {
            return cliError(`Failed to load template: ${params.template}`);
        }

        const taskIndex = plugin.getTaskIndex();
        const { startHour } = settings;
        const context = { taskLookup: (id: string) => taskIndex.getTask(id) };

        const allDisplayTasks = toDisplayTasks(taskIndex.getTasks(), startHour);

        // Apply view-level filter
        let viewFiltered: DisplayTask[];
        if (template.filterState && hasConditions(template.filterState)) {
            viewFiltered = allDisplayTasks.filter(t =>
                TaskFilterEngine.evaluate(t, template.filterState!, context),
            );
        } else {
            viewFiltered = allDisplayTasks;
        }

        // Collect pinned lists from pinnedLists or flattened grid
        const pinnedLists: PinnedListDefinition[] = template.pinnedLists
            ?? (template.grid ? template.grid.flat() : []);

        if (pinnedLists.length === 0) {
            // No pinned lists — return all view-filtered tasks as a single list
            TaskSorter.sort(viewFiltered, undefined);
            return JSON.stringify({
                template: template.name,
                viewType: template.viewType,
                lists: [{
                    name: template.name,
                    ...formatTaskList(viewFiltered),
                }],
            });
        }

        const lists = pinnedLists.map(list => {
            const source = list.applyViewFilter !== false ? viewFiltered : allDisplayTasks;
            const matched = source.filter(t =>
                TaskFilterEngine.evaluate(t, list.filterState, context),
            );
            TaskSorter.sort(matched, list.sortState);
            return {
                name: list.name,
                ...formatTaskList(matched),
            };
        });

        return JSON.stringify({
            template: template.name,
            viewType: template.viewType,
            lists,
        });
    };
}
