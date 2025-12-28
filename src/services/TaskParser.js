"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskParser = void 0;
class TaskParser {
    static parse(line, filePath, lineNumber) {
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
        let date = '';
        let startTime;
        let endTime;
        let endDate;
        let deadline;
        let isFuture = false;
        let isFloatingStart = false;
        let commands = [];
        // 2. Parse Flow Commands if present
        if (flowPart) {
            commands = this.parseFlowCommands(flowPart);
        }
        // 3. Extract Date Block
        // Updated Regex to capture the whole date/time/deadline chain
        const dateBlockMatch = content.match(/(@(?:future|[\d\-T:]*)?(?:(?:>|>>)(?:[\d\-T:]*))*)/);
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
            if (rawStart === 'future') {
                isFuture = true;
            }
            else if (rawStart === '') {
                // Empty Start (@>...)
                const today = new Date().toISOString().split('T')[0];
                date = today;
                isFloatingStart = true;
            }
            else {
                const parsed = this.parseDateTime(rawStart);
                if (parsed.date)
                    date = parsed.date;
                if (parsed.time)
                    startTime = parsed.time;
                if (!parsed.date) {
                    // If only time provided? Implies Today?
                    const today = new Date().toISOString().split('T')[0];
                    date = today;
                }
            }
            // --- 1. End ---
            if (parts.length > 1) { // Has > separator
                if (rawEnd === undefined || rawEnd === '') {
                    // Empty End (@Start>>...) -> SD/D type: end = start
                    if (date)
                        endDate = date;
                }
                else {
                    const parsed = this.parseDateTime(rawEnd);
                    if (parsed.date)
                        endDate = parsed.date;
                    if (parsed.time)
                        endTime = parsed.time;
                    if (!parsed.date && date) {
                        endDate = date;
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
        // Filter: Must have Date OR Commands to be considered a "Task"
        if (!date && !isFuture && commands.length === 0) {
            return null;
        }
        if (date)
            isFuture = false;
        let status = 'todo';
        if (statusChar === 'x' || statusChar === 'X')
            status = 'done';
        if (statusChar === '-')
            status = 'cancelled';
        return {
            id: `${filePath}:${lineNumber}`,
            file: filePath,
            line: lineNumber,
            content: content.trim(),
            status,
            statusChar,
            startDate: date, // Map parsed date to startDate
            startTime,
            endDate,
            endTime,
            deadline,
            isFuture,
            isFloatingStart,
            commands,
            originalText: line,
            children: []
        };
    }
    static parseDateTime(str) {
        const dateMatch = str.match(/(\d{4}-\d{2}-\d{2})/);
        const timeMatch = str.match(/(\d{2}:\d{2})/);
        return {
            date: dateMatch ? dateMatch[1] : undefined,
            time: timeMatch ? timeMatch[1] : undefined
        };
    }
    static parseFlowCommands(flowStr) {
        const commands = [];
        let match;
        // Reset lastIndex because regex is global
        this.COMMAND_REGEX.lastIndex = 0;
        while ((match = this.COMMAND_REGEX.exec(flowStr)) !== null) {
            const name = match[1];
            const argsStr = match[2];
            const modifiersStr = match[3];
            const args = argsStr.split(',').map(s => s.trim()).filter(s => s !== '');
            const modifiers = [];
            if (modifiersStr) {
                let modMatch;
                // Reset modifier regex
                this.MODIFIER_REGEX.lastIndex = 0; // Fix typo: this
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
    static format(task) {
        const statusChar = task.statusChar || (task.status === 'done' ? 'x' : (task.status === 'cancelled' ? '-' : ' '));
        let metaStr = '';
        let hasDateBlock = false;
        let startStr = '';
        if (task.isFuture && !task.startDate) {
            startStr = '@future';
            hasDateBlock = true;
        }
        else if (task.startDate) {
            if (task.isFloatingStart) {
                startStr = '@';
            }
            else {
                startStr = `@${task.startDate}`;
                if (task.startTime)
                    startStr += `T${task.startTime}`;
            }
            hasDateBlock = true;
        }
        if (hasDateBlock) {
            metaStr += ` ${startStr}`;
            // End Part Logic
            if (task.endDate) {
                // If future (no startDate), isSameDay is false.
                const isSameDay = task.startDate ? (task.endDate === task.startDate) : false;
                const hasEndTime = !!task.endTime;
                const needsExplicitEnd = !isSameDay || hasEndTime;
                if (needsExplicitEnd) {
                    metaStr += '>';
                    if (!isSameDay) {
                        metaStr += task.endDate;
                        if (hasEndTime)
                            metaStr += `T${task.endTime}`;
                    }
                    else {
                        metaStr += task.endTime;
                    }
                }
                else {
                    // End=Start.
                    if (task.deadline)
                        metaStr += '>';
                }
            }
            else {
                if (task.deadline)
                    metaStr += '>';
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
    static isTriggerableStatus(task) {
        // Trigger for any status that is not todo (space)
        // e.g. x, X, -, !, etc.
        return task.statusChar !== ' ';
    }
}
exports.TaskParser = TaskParser;
// Regex to match basic task structure: - [x] ...
TaskParser.BASIC_TASK_REGEX = /^(\s*)-\s*\[(.)\]\s*(.*)$/;
// Regex for locating the Date block start: @...
// Matches @ followed by date-like chars, or 'future', or just > (for empty start)
TaskParser.DATE_BLOCK_REGEX = /(@(?:future|[\d\-T:]*)?)(?:>.*)?/;
// Regex for Command: Name(Args)
TaskParser.COMMAND_REGEX = /([a-zA-Z0-9_]+)\((.*?)\)((?:\.[a-zA-Z0-9_]+\(.*?\))*)/g;
TaskParser.MODIFIER_REGEX = /\.([a-zA-Z0-9_]+)\((.*?)\)/g;
