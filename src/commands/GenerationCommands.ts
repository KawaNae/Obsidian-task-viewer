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
        let cleanInterval = interval;

        // Check for 'when done' logic
        const isWhenDone = interval.toLowerCase().includes('when done');
        if (isWhenDone) {
            cleanInterval = interval.replace(/when done/i, '').trim();
        }

        // F型タスクの場合: F型のまま維持（日付シフトなし）
        if (task.isFuture && !task.startDate && !task.endDate && !task.deadline) {
            return {
                ...task,
                id: '',
                status: 'todo',
                statusChar: ' ',
                originalText: '',
                children: []
            };
        }

        // 基準日の決定: startDate > endDate > deadline の優先順
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
            // Fallback: 今日を基準
            baseDateObj = new Date();
            baseDateObj.setHours(0, 0, 0, 0);
        }

        const nextDateObj = RecurrenceUtils.calculateNextDate(baseDateObj, cleanInterval);

        // シフト日数を計算
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
            isFuture: task.isFuture && !task.startDate, // F型の維持
            originalText: '',
            children: []
        };
    }

    /**
     * 日付文字列をDateオブジェクトに変換
     * YYYY-MM-DD または YYYY-MM-DDTHH:mm 形式対応
     */
    private parseDate(dateStr: string): Date {
        const datePart = dateStr.split('T')[0];
        const [y, m, d] = datePart.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    /**
     * 日付文字列を指定日数シフト
     * 時刻部分がある場合は保持
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
