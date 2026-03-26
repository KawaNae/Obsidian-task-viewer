import type { Task, FlowCommand, FlowModifier } from '../../../types';
import { ParserStrategy } from '../strategies/ParserStrategy';
import { isTimerTargetId } from '../../../utils/TimerTargetIdUtils';
import { TaskIdGenerator } from '../../display/TaskIdGenerator';
import { TagExtractor } from '../utils/TagExtractor';
import { DateUtils } from '../../../utils/DateUtils';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';
import { validateDateTimeRules } from '../utils/DateTimeRuleValidator';

interface DateBlockResult {
    date: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    due?: string;
    validationWarning?: string;
}

/**
 * Task Viewer native notation parser.
 * Supports: @start>end>due format with time support.
 */
export class AtNotationParser implements ParserStrategy {
    readonly id = 'at-notation';
    readonly isReadOnly = false;

    // Regex for locating the Date block: @start>end>due
    // Each segment accepts: YYYY-MM-DD, YYYY-MM-DDTHH:mm, T?HH:mm, or empty
    // Rejects non-date @ patterns like @user, @notation
    private static readonly DATE_BLOCK_REGEX =
        /(@(?=[\d>T])(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|T?\d{2}:\d{2})?(?:>(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|\d{2}:\d{2})?)*)/;
    // Regex for Command: Name(Args)
    private static readonly COMMAND_REGEX = /([a-zA-Z0-9_]+)\((.*?)\)((?:\.[a-zA-Z0-9_]+\(.*?\))*)/g;
    private static readonly MODIFIER_REGEX = /\.([a-zA-Z0-9_]+)\((.*?)\)/g;

    parse(line: string, filePath: string, lineNumber: number): Task | null {
        // Extract trailing block ID (^id) before parsing task structure.
        let lineForParse = line;
        let blockId: string | undefined;
        let timerTargetId: string | undefined;
        const blockIdMatch = lineForParse.match(/\s\^([A-Za-z0-9-]+)\s*$/);
        if (blockIdMatch) {
            blockId = blockIdMatch[1];
            if (isTimerTargetId(blockId)) {
                timerTargetId = blockId;
            }
            lineForParse = lineForParse.slice(0, blockIdMatch.index).trimEnd();
        }

        // 1. Split flow commands (==>)
        const flowSplit = lineForParse.split(/==>(.+)/);
        const taskPart = flowSplit[0];
        const flowPart = flowSplit[1] || '';

        const classified = TaskLineClassifier.classify(taskPart);
        if (!classified) {
            return null;
        }

        const { statusChar, rawContent } = classified;

        // 2. Parse flow commands
        const commands = flowPart ? this.parseFlowCommands(flowPart) : [];

        // 3. Parse date block (@start>end>due)
        let content = rawContent;
        let date = '';
        let startTime: string | undefined;
        let endDate: string | undefined;
        let endTime: string | undefined;
        let due: string | undefined;
        let validationWarning: string | undefined;

        const dateBlock = this.parseDateBlock(rawContent);
        if (dateBlock) {
            ({ date, startTime, endDate, endTime, due,
               validationWarning } = dateBlock.fields);
            content = dateBlock.content;
        }

        // A task must have at least one scheduling field or a flow command
        const hasSchedulingData = !!(date || startTime || endDate || endTime || due);
        if (!hasSchedulingData && commands.length === 0) {
            return null;
        }

        // 4. Validate date/time constraints
        const fieldWarning = this.validateDateBlock(date, startTime, endDate, endTime, due);
        if (fieldWarning) {
            validationWarning = fieldWarning;
        }

        return {
            id: TaskIdGenerator.generate(
                this.id,
                filePath,
                TaskIdGenerator.resolveAnchor({
                    parserId: this.id,
                    line: lineNumber,
                    blockId,
                    timerTargetId,
                })
            ),
            file: filePath,
            line: lineNumber,
            content: content.trim(),
            statusChar,
            indent: 0,          // Will be set by TaskScanner
            childIds: [],       // Will be set by TaskScanner
            startDate: date,
            startTime,
            endDate,
            endTime,
            due,
            commands,
            tags: TagExtractor.fromContent(content.trim()),
            originalText: line,
            childLines: [],
            childLineBodyOffsets: [],
            parserId: this.id,
            blockId,
            timerTargetId,
            validationWarning,
            properties: {},     // Will be populated by TaskScanner from childLines
        };
    }

    /**
     * Parse the @start>end>due date block into structured fields.
     * Returns null if no date block was found in the content.
     */
    private parseDateBlock(content: string): { fields: DateBlockResult; content: string } | null {
        const dateBlockMatch = content.match(AtNotationParser.DATE_BLOCK_REGEX);
        if (!dateBlockMatch) {
            return null;
        }

        const fullDateBlock = dateBlockMatch[1];
        const cleanedContent = content.replace(fullDateBlock, '').trim();
        const rawBlock = fullDateBlock.substring(1); // Remove leading @
        const parts = rawBlock.split('>');

        let date = '';
        let startTime: string | undefined;
        let endDate: string | undefined;
        let endTime: string | undefined;
        let due: string | undefined;
        let validationWarning: string | undefined;

        // --- Start segment ---
        const rawStart = parts[0];
        if (rawStart !== '') {
            const parsed = this.parseDateTime(rawStart);
            if (parsed.date) {
                date = parsed.date;
            }
            if (parsed.time) {
                startTime = parsed.time;
            }
        }

        // --- End segment ---
        // endDate is only set when explicitly written (e.g. >2026-02-16T08:00).
        // Time-only end (>08:00) or empty end (>>due) leave endDate undefined;
        // DisplayTaskConverter resolves the implicit endDate at display time.
        if (parts.length > 1) {
            const rawEnd = parts[1];
            if (!rawEnd) {
                // Empty end (@start>>due): endDate stays undefined
            } else {
                const parsed = this.parseDateTime(rawEnd);
                if (parsed.date) {
                    endDate = parsed.date;
                }
                if (parsed.time) {
                    endTime = parsed.time;
                }
            }
        }

        // --- Due segment ---
        if (parts.length > 2 && parts[2]) {
            const parsed = this.parseDateTime(parts[2]);
            due = parsed.date;
            if (parsed.date && parsed.time) {
                due += `T${parsed.time}`;
            }
        }

        // --- Excess separator check ---
        if (parts.length > 3) {
            validationWarning = `Too many '>' separators in date block. Expected at most 2 (start>end>due), found ${parts.length - 1}.`;
        }

        return {
            fields: {
                date, startTime, endDate, endTime, due,
                validationWarning,
            },
            content: cleanedContent,
        };
    }

    /**
     * Validate parsed date/time fields using shared rules.
     * Returns a warning string if any rule is violated, undefined otherwise.
     */
    private validateDateBlock(
        date: string,
        startTime: string | undefined,
        endDate: string | undefined,
        endTime: string | undefined,
        due: string | undefined,
    ): string | undefined {
        const result = validateDateTimeRules({
            startDate: date || undefined,
            startTime, endDate, endTime, due,
            endDateImplicit: !endDate,
        });
        return result?.message;
    }

    private parseDateTime(str: string): { date?: string, time?: string } {
        const dateMatch = str.match(/(\d{4}-\d{2}-\d{2})/);
        const timeMatch = str.match(/(\d{2}:\d{2})/);

        let date: string | undefined;
        if (dateMatch) {
            const parts = dateMatch[1].match(/(\d{4})-(\d{2})-(\d{2})/)!;
            const month = Number(parts[2]), day = Number(parts[3]);
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                date = dateMatch[1];
            }
        }

        let time: string | undefined;
        if (timeMatch && DateUtils.isValidTimeString(timeMatch[1])) {
            time = timeMatch[1];
        }

        return { date, time };
    }

    private parseFlowCommands(flowStr: string): FlowCommand[] {
        const commands: FlowCommand[] = [];
        let match;

        // Reset lastIndex because regex is global
        AtNotationParser.COMMAND_REGEX.lastIndex = 0;

        while ((match = AtNotationParser.COMMAND_REGEX.exec(flowStr)) !== null) {
            const name = match[1];
            const argsStr = match[2];
            const modifiersStr = match[3];

            const args = argsStr.split(',').map(s => s.trim()).filter(s => s !== '');
            const modifiers: FlowModifier[] = [];

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
        } else if (task.startTime || task.endDate || task.endTime || task.due) {
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
                    if (task.due) metaStr += '>';
                }
            } else if (task.endTime) {
                // endTime is set but endDate is not (same day case)
                // Output: >HH:mm
                metaStr += `>${task.endTime}`;
            } else {
                // No end date or time
                if (task.due) metaStr += '>';
            }

            // Due Part
            if (task.due) {
                metaStr += `>${task.due}`;
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

        const blockIdStr = task.blockId ? ` ^${task.blockId}` : '';
        const marker = TaskLineClassifier.extractMarker(task.originalText);
        return `${marker} [${statusChar}] ${task.content}${metaStr}${flowStr}${blockIdStr}`;
    }

    isTriggerableStatus(task: Task): boolean {
        // Trigger for any status that is not todo (space)
        // e.g. x, X, -, !, etc.
        return task.statusChar !== ' ';
    }
}
