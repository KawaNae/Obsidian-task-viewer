import type { App } from 'obsidian';
import type { Task } from '../../types';
import { TaskHubPanel, type TaskHubDeps, type TaskHubPanelOptions } from './TaskHubPanel';

export function createTaskHubOpener(
    app: App,
    deps: TaskHubDeps,
    afterOpen?: () => void,
): (task: Task, options?: TaskHubPanelOptions) => void {
    return (task, options) => {
        new TaskHubPanel(app, task, deps, options).open();
        afterOpen?.();
    };
}
