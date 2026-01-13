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
        await ctx.repository.insertRecurrenceForTask(ctx.task, nextContent.trim(), nextTask);

        // Generation commands do NOT delete the original task by themselves
        return { shouldDeleteOriginal: false };
    }

    protected abstract persistCommands(nextTask: Task, currentCmd: FlowCommand, otherCommands: FlowCommand[], ctx: CommandContext): void;

    private calculateNextTask(task: Task, interval: string): Task {
        let cleanInterval = interval;

        // Check for 'when done' logic
        const isWhenDone = interval.toLowerCase().includes('when done');
        if (isWhenDone) {
            cleanInterval = interval.replace(/when done/i, '').trim();
        }

        // F蝙九ち繧ｹ繧ｯ縺ｮ蝣ｴ蜷・ F蝙九・縺ｾ縺ｾ邯ｭ謖・ｼ域律莉倥す繝輔ヨ縺ｪ縺暦ｼ・
        if (task.isFuture && !task.startDate && !task.endDate && !task.deadline) {
            return {
                ...task,
                id: '',
                status: 'todo',
                statusChar: ' ',
                originalText: '',
                childLines: [...task.childLines] // Preserve children for recurrence
            };
        }

        // 蝓ｺ貅匁律縺ｮ豎ｺ螳・ startDate > endDate > deadline 縺ｮ蜆ｪ蜈磯・
        let baseDateObj: Date;

        if (isWhenDone) {
            baseDateObj = new Date(); // Today
            baseDateObj.setHours(0, 0, 0, 0);
        } else if (task.startDate) {
            baseDateObj = this.parseDate(task.startDate);
        } else if (task.endDate) {
            baseDateObj = this.parseDate(task.endDate);
        } else if (task.deadline) {
            baseDateObj = this.parseDate(task.deadline);
        } else {
            // Fallback: 莉頑律繧貞渕貅・
            baseDateObj = new Date();
            baseDateObj.setHours(0, 0, 0, 0);
        }

        const nextDateObj = RecurrenceUtils.calculateNextDate(baseDateObj, cleanInterval);

        // 繧ｷ繝輔ヨ譌･謨ｰ繧定ｨ育ｮ・
        const shiftDays = Math.round(
            (nextDateObj.getTime() - baseDateObj.getTime()) / (1000 * 60 * 60 * 24)
        );

        return {
            ...task,
            id: '',
            status: 'todo',
            statusChar: ' ',
            startDate: task.startDate ? this.shiftDate(task.startDate, shiftDays) : undefined,
            endDate: task.endDate ? this.shiftDate(task.endDate, shiftDays) : undefined,
            deadline: task.deadline ? this.shiftDate(task.deadline, shiftDays) : undefined,
            isFuture: task.isFuture && !task.startDate, // F蝙九・邯ｭ謖・
            originalText: '',
            childLines: [...task.childLines] // Preserve children for recurrence
        };
    }

    /**
     * 譌･莉俶枚蟄怜・繧奪ate繧ｪ繝悶ず繧ｧ繧ｯ繝医↓螟画鋤
     * YYYY-MM-DD 縺ｾ縺溘・ YYYY-MM-DDTHH:mm 蠖｢蠑丞ｯｾ蠢・
     */
    private parseDate(dateStr: string): Date {
        const datePart = dateStr.split('T')[0];
        const [y, m, d] = datePart.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    /**
     * 譌･莉俶枚蟄怜・繧呈欠螳壽律謨ｰ繧ｷ繝輔ヨ
     * 譎ょ綾驛ｨ蛻・′縺ゅｋ蝣ｴ蜷医・菫晄戟
     */
    private shiftDate(dateStr: string, days: number): string {
        const hasTime = dateStr.includes('T');
        const datePart = dateStr.split('T')[0];
        const timePart = hasTime ? dateStr.split('T')[1] : null;

        const [y, m, d] = datePart.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        date.setDate(date.getDate() + days);

        const newDateStr = DateUtils.getLocalDateString(date);
        return timePart ? `${newDateStr}T${timePart}` : newDateStr;
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
