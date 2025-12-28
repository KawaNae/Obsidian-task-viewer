import { Task } from '../types';

export class TaskParser {
    // Regex to match basic task structure: - [x] ...
    private static readonly BASIC_TASK_REGEX = /^(\s*)-\s*\[(.)\]\s*(.*)$/;

    // Regex for Date: Matches @Token where Token can contain >
    // Examples: @2025-01-01, @2025-01-01>2025-01-05>2025-01-10, @>End, @>>DL
    private static readonly DATE_TOKEN_REGEX = /@([a-zA-Z0-9\-:>]*)/;

    // Helper regex to validate Date parts
    private static readonly YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;
    private static readonly TIME_REGEX = /^(\d{4}-\d{2}-\d{2})?T?(\d{2}:\d{2})$/; // YYYY-MM-DDTHH:mm or HH:mm
    private static readonly TIME_ONLY_REGEX = /^(\d{1,2}):(\d{2})$/;

    // Regex for Command: Name(Args)
    // Matches: word(content)
    private static readonly COMMAND_REGEX = /([a-zA-Z0-9_]+)\((.*?)\)((?:\.[a-zA-Z0-9_]+\(.*?\))*)/g;
    private static readonly MODIFIER_REGEX = /\.([a-zA-Z0-9_]+)\((.*?)\)/g;

    static parse(line: string, filePath: string, lineNumber: number): Task | null {
        // 1. Split Flow (==>)
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
        let startDate: string | undefined;
        let endDate: string | undefined;
        let deadline: string | undefined;
        let isFuture: boolean | undefined;
        let startTime: string | undefined;
        let endTime: string | undefined;
        let commands: any[] = [];

        // 2. Parse Flow Commands
        if (flowPart) {
            commands = this.parseFlowCommands(flowPart);
        }

        // 3. Extract Date Token
        const dateMatch = content.match(this.DATE_TOKEN_REGEX);
        if (dateMatch) {
            const token = dateMatch[1]; // The part after @

            // Handle @>... or @>>... (Empty Start) handling
            // If token starts with >, it means the first part (Start) is empty.
            // Split correctly handles empty strings.
            // e.g., ">End" -> ["", "End"]
            // e.g., ">>DL" -> ["", "", "DL"]

            const parts = token.split('>');
            // parts[0] = Start, parts[1] = End, parts[2] = Deadline

            const startStr = parts[0];
            const endStr = parts[1];
            const dlStr = parts[2];

            // Valid conditions:
            // Any component is present.
            // @>End is VALID (Start=Implicit, End=Present)
            // @>>DL is VALID (Start=Implicit, End=Empty, DL=Present)
            // @2021-01-01 is VALID

            const isValid = (startStr || endStr || dlStr);

            if (isValid) {
                // Parse Start
                if (startStr) {
                    const s = this.parseDateString(startStr);
                    if (s) {
                        if (s.precision === 'someday') {
                            isFuture = true;
                        } else {
                            startDate = s.date;
                        }
                        startTime = s.time;
                    }
                }

                // Parse End
                if (endStr) {
                    const e = this.parseDateString(endStr);
                    if (e) {
                        if (e.date) endDate = e.date;
                        else if (e.time && startDate) {
                            // Time only provided for End, and Start Date exists? 
                            // Inherit Start Date.
                            endDate = startDate;
                        }

                        if (e.time) {
                            endTime = e.time;
                        }
                    }
                }

                // Parse Deadline
                if (dlStr) {
                    const d = this.parseDateString(dlStr);
                    if (d) {
                        // Preserve deadline time by storing as YYYY-MM-DDTHH:mm if time exists
                        if (d.date && d.time) {
                            deadline = `${d.date}T${d.time}`;
                        } else if (d.date) {
                            deadline = d.date;
                        }
                    }
                }
            } else {
                // Should not happen if regex matched something, but regex allows empty if * is used.
                // If it was just "@", token is empty string.
                // Treat as nothing?
            }

            content = content.replace(this.DATE_TOKEN_REGEX, '').trim();
        }

        // Filter: Must have Date OR Commands OR isFuture OR Deadline OR EndDate to be considered a "Task"
        // This hides simple "- [ ] item" lists.
        // NOTE: If Start is validly empty (E, D types), startDate is undefined. But endDate or deadline will be set.
        if (!startDate && !isFuture && !endDate && !deadline && commands.length === 0) {
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
            startDate,
            endDate,
            deadline,
            isFuture,
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

        const hasDate = !!task.startDate || task.isFuture;
        const hasEnd = !!task.endDate || !!task.endTime;
        const hasDeadline = !!task.deadline;

        if (hasDate || hasEnd || hasDeadline) {
            let timeStr = `@`;

            // Start
            if (task.startDate) {
                timeStr += `${task.startDate}`;
                if (task.startTime) {
                    timeStr += `T${task.startTime}`;
                }
            } else if (task.isFuture) {
                timeStr += `future`;
            }

            // End
            if (hasEnd) {
                timeStr += `>`;
                if (task.endDate) {
                    // Check if we can use shorthand (if EndDate == StartDate)
                    if (task.startDate && task.endDate === task.startDate && task.endTime) {
                        // Format: >HH:mm
                        timeStr += `${task.endTime}`;
                    } else {
                        timeStr += `${task.endDate}`;
                        if (task.endTime) {
                            timeStr += `T${task.endTime}`;
                        }
                    }
                } else if (task.endTime) {
                    // Should theoretically have a date if it has a time, handled above?
                    // Use case: Implicit start?
                    timeStr += `${task.endTime}`;
                }
            }

            // Deadline
            if (task.deadline) {
                if (!hasEnd) timeStr += `>`; // Double > if End missing
                timeStr += `>${task.deadline}`;
            }

            // Don't append empty @ if nothing matched (e.g. invalid state)
            if (timeStr !== '@') {
                metaStr += ` ${timeStr}`;
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
    static isTriggerableStatus(task: Task): boolean {
        // Trigger recurrence for: Done (x, X), Cancelled (-), or Important (!)
        if (task.status === 'done' || task.status === 'cancelled') return true;
        if (task.statusChar === '!') return true;
        return false;
    }

    // Updated helper: Removed Year/Month precision support
    private static parseDateString(str: string): { date: string, time?: string, precision?: 'day' | 'someday' } | null {
        if (!str) return null;
        const s = str.toLowerCase();
        if (s === 'someday' || s === 'future') return { date: '', precision: 'someday' };

        // Time Only (HH:mm)
        const timeOnlyMatch = str.match(this.TIME_ONLY_REGEX);
        if (timeOnlyMatch) {
            return { date: '', time: str, precision: 'day' };
        }

        if (str.includes('T')) {
            const [d, t] = str.split('T');
            // Basic validation
            if (this.YMD_REGEX.test(d) && /^\d{2}:\d{2}$/.test(t)) {
                return { date: d, time: t, precision: 'day' };
            }
        }

        if (this.YMD_REGEX.test(str)) return { date: str, precision: 'day' };

        return null;
    }
}
