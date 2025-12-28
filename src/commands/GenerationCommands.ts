import { CommandStrategy, CommandContext, CommandResult } from './CommandStrategy';
import { FlowCommand, Task } from '../types';
import { TaskParser } from '../services/TaskParser';
import { RecurrenceUtils } from '../utils/RecurrenceUtils';
import { DateUtils } from '../utils/DateUtils';

export abstract class GenerationCommand implements CommandStrategy {
    abstract name: string;

    async execute(ctx: CommandContext, cmd: FlowCommand): Promise<CommandResult> {
        const interval = cmd.args[0];
        if (!interval) return { shouldDeleteOriginal: false };

        const nextTask = this.calculateNextTask(ctx.task, interval);

        // Handle Modifiers (e.g., .as())
        for (const mod of cmd.modifiers) {
            if (mod.name === 'as' && mod.args[0]) {
                nextTask.content = mod.args[0];
            }
        }

        // Identify other commands. We only filter out the *current* command from the list,
        // letting the specific Strategy decide what to keep from the rest.
        const otherCommands = ctx.task.commands?.filter(c => c.name !== cmd.name) || [];

        // Command Persistence Logic
        this.persistCommands(nextTask, cmd, otherCommands, ctx);

        const nextContent = TaskParser.format(nextTask);
        await ctx.repository.insertRecurrenceForTask(ctx.task, nextContent.trim());

        // Generation commands do NOT delete the original task by themselves
        return { shouldDeleteOriginal: false };
    }

    protected abstract persistCommands(nextTask: Task, currentCmd: FlowCommand, otherCommands: FlowCommand[], ctx: CommandContext): void;

    private calculateNextTask(task: Task, interval: string): Task {
        let baseDateObj: Date;
        let cleanInterval = interval;

        // Check for 'when done' logic
        const isWhenDone = interval.toLowerCase().includes('when done');
        if (isWhenDone) {
            baseDateObj = new Date(); // Today
            baseDateObj.setHours(0, 0, 0, 0);
            cleanInterval = interval.replace(/when done/i, '').trim();
        } else {
            if (task.startDate) {
                const [y, m, d] = task.startDate.split('-').map(Number);
                baseDateObj = new Date(y, m - 1, d);
            } else {
                baseDateObj = new Date();
                baseDateObj.setHours(0, 0, 0, 0);
            }
        }

        const nextDateObj = RecurrenceUtils.calculateNextDate(baseDateObj, cleanInterval);
        const nextDateStr = DateUtils.getLocalDateString(nextDateObj);

        return {
            ...task,
            id: '',
            status: 'todo',
            statusChar: ' ',
            startDate: nextDateStr,
            originalText: '',
            children: []
        };
    }
}

export class RepeatCommand extends GenerationCommand {
    name = 'repeat';

    protected persistCommands(nextTask: Task, currentCmd: FlowCommand, otherCommands: FlowCommand[], ctx: CommandContext): void {
        // Repeat: Keep exact same commands in exact same order
        // We clone the original command list
        nextTask.commands = [...(ctx.task.commands || [])];
    }
}

export class NextCommand extends GenerationCommand {
    name = 'next';

    protected persistCommands(nextTask: Task, currentCmd: FlowCommand, otherCommands: FlowCommand[], ctx: CommandContext): void {
        // Next: "Command all erase and copy"
        // We drop 'next' (consumable) AND all other commands (like 'repeat') for the new task.
        nextTask.commands = [];
    }
}
