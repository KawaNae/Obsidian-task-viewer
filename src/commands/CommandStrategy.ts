import { Task, FlowCommand } from '../types';
import { TaskRepository } from '../services/TaskRepository';

export interface CommandContext {
    repository: TaskRepository;
    task: Task;
}

export interface CommandResult {
    shouldDeleteOriginal: boolean;
}

export interface CommandStrategy {
    name: string;
    execute(ctx: CommandContext, cmd: FlowCommand): Promise<CommandResult>;
}
