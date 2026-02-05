import { Task } from '../../../types';
import { ParserStrategy } from './ParserStrategy';

/**
 * Task Viewer native notation parser.
 * Supports: @start>end>deadline format with time support.
 */
export class AtNotationParser implements ParserStrategy {
    readonly id = 'at-notation';

    // Regex to match basic task structure: - [x] ...
    private static readonly BASIC_TASK_REGEX = /^(\s*)-\s*\[(.)]\s*(.*)$/;

    // Regex for locating the Date block start: @...
    // Matches @ followed by date-like chars, or 'future', or just > (for empty start)
    private static readonly DATE_BLOCK_REGEX = /(@(?:[\d\-T:]*)?)(?:>.*)?/;


    // Regex for Command: Name(Args)
    private static readonly COMMAND_REGEX = /([a-zA-Z0-9_]+)\((.*?)\)((?:\.[a-zA-Z0-9_]+\(.*?\))*)/g;
    private static readonly MODIFIER_REGEX = /\.([a-zA-Z0-9_]+)\((.*?)\)/g;

    parse(line: string, filePath: string, lineNumber: number): Task | null {
        // 1. Split Flow (==>)
        const flowSplit = line.split(/==>(.+)/);
        const taskPart = flowSplit[0];
        const flowPart = flowSplit[1] || '';

        const match = taskPart.match(AtNotationParser.BASIC_TASK_REGEX);
        if (!match) {
            return null;
        }

        const [, indent, statusChar, rawContent] = match;

        // Extraction
        let content = rawContent;
        let date = '';
        let startTime: string | undefined;
        let endTime: string | undefined;
        let endDate: string | undefined;
        let deadline: string | undefined;

        let commands: any[] = [];

        // Explicit field flags - track which fields were explicitly written
        let explicitStartDate = false;
        let explicitStartTime = false;
        let explicitEndDate = false;
        let explicitEndTime = false;

        // 2. Parse Flow Commands if present
        if (flowPart) {
            commands = this.parseFlowCommands(flowPart);
        }

        // 3. Extract Date Block
        // Updated Regex to capture the whole date/time/deadline chain
        const dateBlockMatch = content.match(/(@(?:[\d\-T:]*)?(?:(?:>|>>)(?:[\d\-T:]*))*)/);


        if (dateBlockMatch) {
            const fullDateBlock = dateBlockMatch[1];
            content = content.replace(fullDateBlock, '').trim();

            const rawBlock = fullDateBlock.substring(1); // Remove leading @

            // Split by '>'
            const parts = rawBlock.split('>');

            const rawStart = parts[0];
            const rawEnd = parts[1];
            const rawDeadline = parts[2];

            // --- 0. Start ---
            if (rawStart === '') {

                // Empty Start (@>...)
                // Do NOT set date = today. Leave undefined to indicate implicit start at Today.
                // date = undefined;
            } else {
                const parsed = this.parseDateTime(rawStart);
                if (parsed.date) {
                    date = parsed.date;
                    explicitStartDate = true;
                }
                if (parsed.time) {
                    startTime = parsed.time;
                    explicitStartTime = true;
                }
                if (!parsed.date) {
                    // If only time provided? Implies Today?
                    // Let's assume undefined logic applies here too if we want dynamic "Today"
                    // BUT legacy behavior might expect fixed date?
                    // Actually, @T10:00 -> Implicit "Today"
                    // So we also leave date undefined.
                }
            }

            // --- 1. End ---
            if (parts.length > 1) { // Has > separator
                if (rawEnd === undefined || rawEnd === '') {
                    // Empty End (@Start>>...) -> SD/D type: end = start
                    if (date) endDate = date;
                } else {
                    const parsed = this.parseDateTime(rawEnd);
                    if (parsed.date) {
                        endDate = parsed.date;
                        explicitEndDate = true;
                    }
                    if (parsed.time) {
                        endTime = parsed.time;
                        explicitEndTime = true;
                    }

                    if (!parsed.date && date) {
                        endDate = date;
                        // Date is inherited from start, not explicit
                    }
                }
            }

            // --- 2. Deadline ---
            if (parts.length > 2) {
                if (rawDeadline) {
                    const parsed = this.parseDateTime(rawDeadline);
                    deadline = parsed.date;
                    if (parsed.date && parsed.time) {
                        deadline += `T${parsed.time}`;
                    }
                }
            }
        }

        // Filter: Must have Date/Time OR EndDate/Time OR Deadline OR Future OR Commands to be considered a "Task"
        // Added startTime and endTime to allow time-only notation for child task inheritance
        if (!date && !startTime && !endDate && !endTime && !deadline && commands.length === 0) {

            return null;
        }



        // Validate task data during parse
        let validationWarning: string | undefined;

        // Rule 1: Check for invalid same-day time range (endTime < startTime)
        if (date && startTime && endTime && endDate && date === endDate) {
            const [startH, startM] = startTime.split(':').map(Number);
            const [endH, endM] = endTime.split(':').map(Number);
            const startMinutes = startH * 60 + startM;
            const endMinutes = endH * 60 + endM;

            if (endMinutes < startMinutes) {
                validationWarning = `Invalid time range: end time (${endTime}) is before start time (${startTime}) on the same day. Use explicit end date for overnight tasks (e.g., @${date}T${startTime}>${endDate + ' next day'}T${endTime}).`;
            }
        }

        // Rule 2: End time without start time
        if (endTime && !startTime) {
            validationWarning = `End time specified without start time.`;
        }

        // Rule 3: Deadline must have a date
        if (deadline && !deadline.match(/\d{4}-\d{2}-\d{2}/)) {
            validationWarning = `Deadline must include a date (YYYY-MM-DD).`;
        }

        return {
            id: `${filePath}:${lineNumber}`,
            file: filePath,
            line: lineNumber,
            content: content.trim(),
            statusChar,
            indent: 0,          // Will be set by TaskIndex
            childIds: [],       // Will be set by TaskIndex
            startDate: date, // Map parsed date to startDate
            startTime,
            endDate,
            endTime,
            deadline,
            explicitStartDate,
            explicitStartTime,
            explicitEndDate,
            explicitEndTime,
            commands,
            originalText: line,
            childLines: [],
            validationWarning
        };
    }

    private parseDateTime(str: string): { date?: string, time?: string } {
        const dateMatch = str.match(/(\d{4}-\d{2}-\d{2})/);
        const timeMatch = str.match(/(\d{2}:\d{2})/);
        return {
            date: dateMatch ? dateMatch[1] : undefined,
            time: timeMatch ? timeMatch[1] : undefined
        };
    }

    private parseFlowCommands(flowStr: string): any[] {
        const commands: any[] = [];
        let match;

        // Reset lastIndex because regex is global
        AtNotationParser.COMMAND_REGEX.lastIndex = 0;

        while ((match = AtNotationParser.COMMAND_REGEX.exec(flowStr)) !== null) {
            const name = match[1];
            const argsStr = match[2];
            const modifiersStr = match[3];

            const args = argsStr.split(',').map(s => s.trim()).filter(s => s !== '');
            const modifiers: any[] = [];

            if (modifiersStr) {
                let modMatch;
                // Reset modifier regex
                AtNotationParser.MODIFIER_REGEX.lastIndex = 0;
                while ((modMatch = AtNotationParser.MODIFIER_REGEX.exec(modifiersStr)) !== null) {
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

    format(task: Task): string {
        const statusChar = task.statusChar || ' ';
        let metaStr = '';
        let hasDateBlock = false;

        // Determine if we should use inherited (time-only) notation
        // startDateInherited covers both start and end dates (they are inherited together)
        const useInheritedNotation = task.startDateInherited && task.startTime;

        let startStr = '';
        if (useInheritedNotation) {

            // Inherited date - output time only
            startStr = `@${task.startTime}`;
            hasDateBlock = true;
        } else if (task.startDate) {
            startStr = `@${task.startDate}`;
            if (task.startTime) startStr += `T${task.startTime}`;
            hasDateBlock = true;
        } else if (task.startTime || task.endDate || task.endTime || task.deadline) {
            // Implicit Start with content to format (D type, S-Timed with implicit date, etc.)
            startStr = '@';
            if (task.startTime) startStr += `T${task.startTime}`;
            hasDateBlock = true;
        }

        if (hasDateBlock) {
            metaStr += ` ${startStr}`;

            // End Part Logic
            if (useInheritedNotation && task.endTime) {
                // Inherited end date - output time only
                metaStr += `>${task.endTime}`;
            } else if (task.endDate) {
                // endDate is explicitly set
                // If future (no startDate), isSameDay is false.
                const isSameDay = task.startDate ? (task.endDate === task.startDate) : false;

                const hasEndTime = !!task.endTime;
                const needsExplicitEnd = !isSameDay || hasEndTime;

                if (needsExplicitEnd) {
                    metaStr += '>';
                    if (!isSameDay) {
                        metaStr += task.endDate;
                        if (hasEndTime) metaStr += `T${task.endTime}`;
                    } else {
                        metaStr += task.endTime;
                    }
                } else {
                    // End=Start.
                    if (task.deadline) metaStr += '>';
                }
            } else if (task.endTime) {
                // endTime is set but endDate is not (same day case)
                // Output: >HH:mm
                metaStr += `>${task.endTime}`;
            } else {
                // No end date or time
                if (task.deadline) metaStr += '>';
            }

            // Deadline Part
            if (task.deadline) {
                metaStr += `>${task.deadline}`;
            }
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

    isTriggerableStatus(task: Task): boolean {
        // Trigger for any status that is not todo (space)
        // e.g. x, X, -, !, etc.
        return task.statusChar !== ' ';
    }
}
