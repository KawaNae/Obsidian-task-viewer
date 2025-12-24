import { Task } from '../types';

export class TaskParser {
    // Regex to match basic task structure: - [x] ...
    private static readonly BASIC_TASK_REGEX = /^(\s*)-\s*\[(.)\]\s*(.*)$/;

    // Regex for Date: @YYYY-MM-DD...
    private static readonly DATE_REGEX = /@(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?(?:>(?:(\d{2}:\d{2})|(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})))?/;

    // Regex for Command: Name(Args)
    // Matches: word(content)
    // This is a naive regex, might fail with nested parenthesis but sufficient for now.
    private static readonly COMMAND_REGEX = /([a-zA-Z0-9_]+)\((.*?)\)((?:\.[a-zA-Z0-9_]+\(.*?\))*)/g;
    private static readonly MODIFIER_REGEX = /\.([a-zA-Z0-9_]+)\((.*?)\)/g;

    static parse(line: string, filePath: string, lineNumber: number): Task | null {
        // 1. Split Flow (==>)
        // Use a non-consuming split? No, just match.
        const flowSplit = line.split(/==>(.+)/);
        const taskPart = flowSplit[0];
        const flowPart = flowSplit[1] || '';

        const match = taskPart.match(this.BASIC_TASK_REGEX);
        if (!match) {
            return null;
        }

        const [, indent, statusChar, rawContent] = match;

        // Extraction
        let content = rawContent;
        let date = '';
        let startTime: string | undefined;
        let endTime: string | undefined;
        let commands: any[] = [];

        // 2. Parse Flow Commands if present
        if (flowPart) {
            commands = this.parseFlowCommands(flowPart);
        }

        // 3. Extract Date
        const dateMatch = content.match(this.DATE_REGEX);
        if (dateMatch) {
            date = dateMatch[1];
            startTime = dateMatch[2];
            const endTimeSimple = dateMatch[3];
            const endTimeFull = dateMatch[4];
            endTime = endTimeFull || endTimeSimple;

            content = content.replace(this.DATE_REGEX, '').trim();
        }

        // Filter: Must have Date OR Commands to be considered a "Task"
        if (!date && commands.length === 0) {
            return null;
        }

        let status: 'todo' | 'done' | 'cancelled' = 'todo';
        if (statusChar === 'x' || statusChar === 'X') status = 'done';
        if (statusChar === '-') status = 'cancelled';

        return {
            id: `${filePath}:${lineNumber}`,
            file: filePath,
            line: lineNumber,
            content: content.trim(),
            status,
            statusChar,
            date,
            startTime,
            endTime,
            commands,
            originalText: line,
            children: []
        };
    }

    private static parseFlowCommands(flowStr: string): any[] {
        const commands: any[] = [];
        let match;

        // Reset lastIndex because regex is global
        this.COMMAND_REGEX.lastIndex = 0;

        while ((match = this.COMMAND_REGEX.exec(flowStr)) !== null) {
            const name = match[1];
            const argsStr = match[2];
            const modifiersStr = match[3];

            const args = argsStr.split(',').map(s => s.trim()).filter(s => s !== '');
            const modifiers: any[] = [];

            if (modifiersStr) {
                let modMatch;
                // Reset modifier regex
                this.MODIFIER_REGEX.lastIndex = 0;
                while ((modMatch = this.MODIFIER_REGEX.exec(modifiersStr)) !== null) {
                    modifiers.push({
                        name: modMatch[1],
                        args: modMatch[2].split(',').map(s => s.trim()).filter(s => s !== '')
                    });
                }
            }

            commands.push({ name, args, modifiers });
        }

        return commands;
    }

    static format(task: Task): string {
        const statusChar = task.statusChar || (task.status === 'done' ? 'x' : (task.status === 'cancelled' ? '-' : ' '));
        let metaStr = '';

        if (task.date) {
            let timeStr = `@${task.date}`;
            if (task.startTime) {
                timeStr += `T${task.startTime}`;
                if (task.endTime) {
                    timeStr += `>${task.endTime}`;
                }
            }
            metaStr += ` ${timeStr}`;
        }

        let flowStr = '';
        if (task.commands && task.commands.length > 0) {
            const cmdStrs = task.commands.map(cmd => {
                let s = `${cmd.name}(${cmd.args.join(', ')})`;
                if (cmd.modifiers && cmd.modifiers.length > 0) {
                    s += cmd.modifiers.map(m => `.${m.name}(${m.args.join(', ')})`).join('');
                }
                return s;
            });
            flowStr = ` ==> ${cmdStrs.join(' ')}`;
        }

        return `- [${statusChar}] ${task.content}${metaStr}${flowStr}`;
    }
}
