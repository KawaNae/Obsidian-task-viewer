import type { CliData } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import type { DisplayTask } from '../../types';
import { toDisplayTasks } from '../../utils/DisplayTaskConverter';
import { TaskFilterEngine } from '../../services/filter/TaskFilterEngine';
import { TaskSorter } from '../../services/sort/TaskSorter';
import { DateUtils } from '../../utils/DateUtils';
import { buildFilterFromFlags } from '../CliFilterBuilder';
import { formatTask, formatTaskList, cliOk, cliError } from '../CliOutputFormatter';
import { toDisplayTask } from '../../utils/DisplayTaskConverter';

export function createListHandler(plugin: TaskViewerPlugin) {
    return (params: CliData): string => {
        const taskIndex = plugin.getTaskIndex();
        const { startHour } = plugin.settings;
        const limit = params.limit ? parseInt(params.limit, 10) : 100;

        const displayTasks = toDisplayTasks(taskIndex.getTasks(), startHour);

        const filterState = buildFilterFromFlags(params);
        let filtered: DisplayTask[];
        if (filterState) {
            const context = { taskLookup: (id: string) => taskIndex.getTask(id) };
            filtered = displayTasks.filter(t => TaskFilterEngine.evaluate(t, filterState, context));
        } else {
            filtered = displayTasks;
        }

        TaskSorter.sort(filtered, undefined);

        const limited = filtered.slice(0, limit > 0 ? limit : 100);
        return JSON.stringify(formatTaskList(limited));
    };
}

export function createTodayHandler(plugin: TaskViewerPlugin) {
    return (params: CliData): string => {
        const taskIndex = plugin.getTaskIndex();
        const { startHour } = plugin.settings;
        const today = DateUtils.getVisualDateOfNow(startHour);

        const displayTasks = toDisplayTasks(taskIndex.getTasks(), startHour);

        // Tasks active today: effectiveStartDate <= today AND (effectiveEndDate >= today OR no endDate)
        const filtered = displayTasks.filter(t => {
            const start = t.effectiveStartDate;
            const end = t.effectiveEndDate;
            if (!start && !t.due) return false;

            // Due-only tasks: show if due today
            if (!start && t.due) return t.due === today;

            // Has start: check if active range includes today
            if (start && start > today) return false;
            if (end && end < today) return false;
            if (!end && start && start < today) return false;

            return true;
        });

        TaskSorter.sort(filtered, undefined);
        return JSON.stringify(formatTaskList(filtered));
    };
}

export function createGetHandler(plugin: TaskViewerPlugin) {
    return (params: CliData): string => {
        if (!params.id) return cliError('Missing required flag: --id');

        const taskIndex = plugin.getTaskIndex();
        const task = taskIndex.getTask(params.id);
        if (!task) return cliError(`Task not found: ${params.id}`);

        const displayTask = toDisplayTask(task, plugin.settings.startHour);
        return JSON.stringify(formatTask(displayTask));
    };
}
