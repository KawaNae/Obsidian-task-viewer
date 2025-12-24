import { CommandStrategy, CommandContext, CommandResult } from './CommandStrategy';
import { FlowCommand } from '../types';
import { TaskParser } from '../services/TaskParser';

export class MoveCommand implements CommandStrategy {
    name = 'move';

    async execute(ctx: CommandContext, cmd: FlowCommand): Promise<CommandResult> {
        let dest = cmd.args[0];
        if (!dest) return { shouldDeleteOriginal: false };

        // 1. Handle WikiLinks [[...]]
        // Remove surrounding [[ and ]] if present
        dest = dest.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();

        // 2. Normalize and Sanitize Path
        // Convert backslashes to forward slashes for internal consistency
        dest = dest.replace(/\\/g, '/');

        // Split into segments to safely sanitize each part (folder/file names)
        const segments = dest.split('/');
        const safeSegments = segments.map(segment => {
            // Replace Windows invalid characters: < > : " / \ | ? *
            // Note: / and \ are already handled as separators.
            // valid: < > : " | ? * 
            return segment.replace(/[<>:"|?*]/g, '_');
        });

        dest = safeSegments.join('/');

        // 3. Ensure .md extension
        if (!dest.toLowerCase().endsWith('.md')) {
            dest += '.md';
        }

        // When moving, we typically strip ALL flow commands to keep the archive clean
        const archivedTask = { ...ctx.task, commands: [] };
        const content = TaskParser.format(archivedTask);

        await ctx.repository.appendTaskToFile(dest, content);

        return { shouldDeleteOriginal: true };
    }
}
