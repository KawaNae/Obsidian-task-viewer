export interface SelectionHost {
    getSelectedTaskId(): string | null;
    selectTask(taskId: string | null): void;
}
