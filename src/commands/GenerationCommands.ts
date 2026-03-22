import { CommandStrategy, CommandContext, CommandResult } from './CommandStrategy';
import { FlowCommand, Task, ChildLine } from '../types';
import { TaskParser } from '../services/parsing/TaskParser';
import { RecurrenceUtils } from './RecurrenceUtils';
import { DateUtils } from '../utils/DateUtils';

export abstract class GenerationCommand implements CommandStrategy {
    abstract name: string;

    async execute(ctx: CommandContext, cmd: FlowCommand): Promise<CommandResult> {
        const interval = cmd.args[0];
        if (!interval) return { shouldDeleteOriginal: false };

        const nextTask = this.calculateNextTask(ctx.task, interval);

        // Handle Modifiers (e.g., .as())
        for (const mod of cmd.modifiers) {
            if (mod.name === 'as') {
                nextTask.content = mod.args[0] ?? '';
            }
        }

        // Identify other commands. We only filter out the *current* command from the list,
        // letting the specific Strategy decide what to keep from the rest.
        const otherCommands = ctx.task.commands?.filter(c => c.name !== cmd.name) || [];

        // Command Persistence Logic
        this.persistCommands(nextTask, cmd, otherCommands, ctx);

        const copyChildren = !cmd.modifiers.some(m => m.name === 'nochildren');

        const nextContent = TaskParser.format(nextTask);
        await ctx.repository.insertRecurrenceForTask(ctx.task, nextContent.trim(), nextTask, copyChildren);

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

        // 基準日の決定: startDate > endDate > due の優先度
        let baseDateObj: Date;

        if (isWhenDone) {
            baseDateObj = new Date(); // Today
            baseDateObj.setHours(0, 0, 0, 0);
        } else if (task.startDate) {
            baseDateObj = this.parseDate(task.startDate);
        } else if (task.endDate) {
            baseDateObj = this.parseDate(task.endDate);
        } else if (task.due) {
            baseDateObj = this.parseDate(task.due);
        } else {
            baseDateObj = new Date();
            baseDateObj.setHours(0, 0, 0, 0);
        }

        const nextDateObj = RecurrenceUtils.calculateNextDate(baseDateObj, cleanInterval);

        const commonOverrides = {
            id: '',
            statusChar: ' ' as const,
            startDateInherited: false,
            originalText: '',
            childLines: [] as ChildLine[],
            childLineBodyOffsets: [] as number[],
            blockId: undefined,
            timerTargetId: undefined,
            content: task.content.replace(/^(?:⏱️|🍅|⏳)\s*/, ''),
        };

        if (isWhenDone) {
            // when-done: nextDateObj を新しい startDate とし、元の span 幅を保持
            const nextDateStr = DateUtils.getLocalDateString(nextDateObj);
            const baseStartDate = task.startDate ? this.parseDate(task.startDate) : baseDateObj;

            return {
                ...task,
                ...commonOverrides,
                startDate: task.startDate ? this.preserveTime(nextDateStr, task.startDate) : undefined,
                endDate: task.endDate
                    ? this.shiftDateFromBase(nextDateStr, baseStartDate, task.endDate)
                    : (task.endTime && task.startDate) ? nextDateStr : undefined,
                due: task.due
                    ? this.shiftDateFromBase(nextDateStr, baseStartDate, task.due)
                    : undefined,
            };
        }

        // 通常パス: 基準日からのシフト日数で全日付を移動
        const shiftDays = Math.round(
            (nextDateObj.getTime() - baseDateObj.getTime()) / (1000 * 60 * 60 * 24)
        );

        return {
            ...task,
            ...commonOverrides,
            startDate: task.startDate ? DateUtils.shiftDateString(task.startDate, shiftDays) : undefined,
            endDate: task.endDate
                ? DateUtils.shiftDateString(task.endDate, shiftDays)
                : (task.endTime && task.startDate)
                    ? DateUtils.shiftDateString(task.startDate, shiftDays)
                    : undefined,
            due: task.due ? DateUtils.shiftDateString(task.due, shiftDays) : undefined,
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

    /** newBaseDate を起点に、originalStart→targetDate の日数差を適用（時刻保持） */
    private shiftDateFromBase(newBaseDateStr: string, originalStart: Date, targetDateStr: string): string {
        const targetDate = this.parseDate(targetDateStr);
        const diffDays = Math.round(
            (targetDate.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24)
        );
        return DateUtils.shiftDateString(this.preserveTime(newBaseDateStr, targetDateStr), diffDays);
    }

    /** newDateStr に originalDateStr の時刻部分を付与 */
    private preserveTime(newDateStr: string, originalDateStr: string): string {
        const timePart = originalDateStr.includes('T') ? originalDateStr.split('T')[1] : null;
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
