import { CommandStrategy, CommandContext, CommandResult } from './CommandStrategy';
import { FlowCommand } from '../types';
import { TaskParser } from '../services/TaskParser';

export class MoveCommand implements CommandStrategy {
    name = 'move';

    async execute(ctx: CommandContext, cmd: FlowCommand): Promise<CommandResult> {
        const dest = cmd.args[0];
        if (!dest) return { shouldDeleteOriginal: false };

        // When moving, we typically strip ALL flow commands to keep the archive clean
        const archivedTask = { ...ctx.task, commands: [] };
        const content = TaskParser.format(archivedTask);

        await ctx.repository.appendTaskToFile(dest, content);

        return { shouldDeleteOriginal: true };
    }
}
