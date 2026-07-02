import type { Task, TaskFlow } from '../../../types';
import { flowValidation, singleLineFlow } from '../../flow/FlowSegments';
import { createBaseTask } from '../TaskFactory';
import { LeafParserStrategy } from '../strategies/ParserStrategy';
import { isTimerTargetId } from '../../../utils/TimerTargetIdUtils';
import { TaskIdGenerator } from '../../display/TaskIdGenerator';
import { TagExtractor } from '../utils/TagExtractor';
import { parseDateTimeField } from '../utils/DateTimeFieldParser';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';
import { validateDateTimeRules, DateTimeValidationResult } from '../utils/DateTimeRuleValidator';

interface DateBlockResult {
    date: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    due?: string;
    validationWarning?: string; // parseDateBlock internal warning (excess separators)
}

/**
 * Task Viewer native inline parser.
 *
 * Handles all checkbox lines that this plugin owns:
 * - With scheduling block: `- [ ] foo @start>end>due`
 * - Without scheduling block: `- [ ] foo` (catch-all for non-external checkboxes)
 *
 * Acts as the single inline format authority — `format()` correctly emits
 * either the bare line (no dates) or the @notation block (with dates),
 * so a task gaining or losing dates is handled by the same parser without
 * promotion/demotion bookkeeping.
 */
export class TVInlineParser implements LeafParserStrategy {
    readonly id = 'tv-inline';
    readonly isReadOnly = false;

    // Regex for locating the Date block: @start>end>due
    // Each segment accepts: YYYY-MM-DD, YYYY-MM-DDTHH:mm, T?HH:mm, or empty
    // Rejects non-date @ patterns like @user, @notation
    private static readonly DATE_BLOCK_REGEX =
        /(@(?=[\d>T])(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|T?\d{2}:\d{2})?(?:>(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|\d{2}:\d{2})?)*)/;
    parse(line: string, filePath: string, lineNumber: number): Task | null {
        // Extract trailing block ID (^id) before parsing task structure.
        const { text: lineForParse, blockId } = TaskLineClassifier.extractBlockId(line);
        const timerTargetId = blockId && isTimerTargetId(blockId) ? blockId : undefined;

        // 1. Split flow commands (==>)
        const flowSplit = lineForParse.split(/==>(.+)/);
        const taskPart = flowSplit[0];
        const flowPart = flowSplit[1] || '';

        const classified = TaskLineClassifier.classify(taskPart);
        if (!classified) {
            return null;
        }

        const { statusChar, rawContent } = classified;

        // 2. Parse the flow command. `raw` always carries the verbatim text
        // so format() re-emits it losslessly even when parsing failed;
        // `program` is non-null only when the command is executable.
        // Line-level view only: `- ==>` child segments are merged (and the
        // program re-parsed from the joined source) by TreeTaskExtractor.
        const trimmedFlow = flowPart.trim();
        const flow: TaskFlow | undefined = trimmedFlow
            ? singleLineFlow(trimmedFlow)
            : undefined;

        // 3. Parse date block (@start>end>due)
        let content = rawContent;
        let date = '';
        let startTime: string | undefined;
        let endDate: string | undefined;
        let endTime: string | undefined;
        let due: string | undefined;
        let parseWarning: string | undefined;

        const dateBlock = this.parseDateBlock(rawContent);
        if (dateBlock) {
            ({ date, startTime, endDate, endTime, due,
               validationWarning: parseWarning } = dateBlock.fields);
            content = dateBlock.content;
        }

        // No early return: TVInline accepts any classified checkbox line, with
        // or without a scheduling block. ParserChain order ensures external
        // notation parsers (tasks-plugin, day-planner) get first crack on lines
        // that match their syntax; everything else falls through to here.

        // 4. Validate date/time constraints
        let validation: Task['validation'];
        const ruleResult = this.validateDateBlock(date, startTime, endDate, endTime, due);
        if (ruleResult) {
            validation = ruleResult;
        } else if (parseWarning) {
            validation = {
                severity: 'error',
                rule: 'parse-error',
                message: parseWarning,
                hint: '',
            };
        } else if (flow) {
            // Surface the first flow diagnostic through the existing
            // validation channel so a typo'd command is not a silent no-op
            // for users who never see editor decorations. May be superseded
            // when TreeTaskExtractor merges `- ==>` child segments and
            // re-validates the joined program.
            validation = flowValidation(flow);
        }

        return createBaseTask({
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
            parserId: this.id,
            originalText: line,
        }, {
            startDate: date,
            startTime,
            endDate,
            endTime,
            due,
            flow,
            tags: TagExtractor.fromContent(content.trim()),
            blockId,
            timerTargetId,
            validation,
        });
    }

    /**
     * Parse the @start>end>due date block into structured fields.
     * Returns null if no date block was found in the content.
     */
    private parseDateBlock(content: string): { fields: DateBlockResult; content: string } | null {
        const dateBlockMatch = content.match(TVInlineParser.DATE_BLOCK_REGEX);
        if (!dateBlockMatch) {
            return null;
        }

        const fullDateBlock = dateBlockMatch[1]; // first block = canonical

        // content は notation-free が不変条件。最初の date block を canonical と
        // して採用し、content 中に残る全 date-like トークンを除去する。これが
        // ないと format() の末尾再付与が次回 parse で先頭マッチを奪い、開始日が
        // 化ける(round-trip 破壊)。除去で生じた連続スペースは単一に畳む。
        const globalRe = new RegExp(TVInlineParser.DATE_BLOCK_REGEX.source, 'g');
        let dateBlockCount = 0;
        const cleanedContent = content
            .replace(globalRe, (m) => {
                if (m.length > 1) { dateBlockCount++; return ''; }
                return m;
            })
            .replace(/\s{2,}/g, ' ')
            .trim();

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
            const parsed = parseDateTimeField(rawStart);
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
                const parsed = parseDateTimeField(rawEnd);
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
            const parsed = parseDateTimeField(parts[2]);
            due = parsed.date;
            if (parsed.date && parsed.time) {
                due += `T${parsed.time}`;
            }
        }

        // --- Excess separator check ---
        if (parts.length > 3) {
            validationWarning = `Too many '>' separators in date block. Expected at most 2 (start>end>due), found ${parts.length - 1}.`;
        }

        // --- Multiple date blocks check ---
        if (dateBlockCount > 1) {
            const extra = `Multiple date blocks found; kept the first and discarded ${dateBlockCount - 1}.`;
            validationWarning = validationWarning ? `${validationWarning} ${extra}` : extra;
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
     */
    private validateDateBlock(
        date: string,
        startTime: string | undefined,
        endDate: string | undefined,
        endTime: string | undefined,
        due: string | undefined,
    ): DateTimeValidationResult | undefined {
        return validateDateTimeRules({
            startDate: date || undefined,
            startTime, endDate, endTime, due,
            endDateImplicit: !endDate,
        });
    }

    format(task: Task): string {
        const statusChar = task.statusChar || ' ';
        let metaStr = '';
        let hasDateBlock = false;

        let startStr = '';
        if (task.startDate) {
            startStr = `@${task.startDate}`;
            if (task.startTime) startStr += `T${task.startTime}`;
            hasDateBlock = true;
        } else if (task.startTime) {
            startStr = `@${task.startTime}`;
            hasDateBlock = true;
        } else if (task.endDate || task.endTime || task.due) {
            startStr = '@';
            hasDateBlock = true;
        }

        if (hasDateBlock) {
            metaStr += ` ${startStr}`;

            // End Part Logic
            if (task.endDate) {
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

        // Flow text is always re-emitted verbatim (round-trip safety, even
        // for unparseable commands). Canonical re-serialization happens only
        // when a fire generates the next instance (FlowPlanner). Only the
        // task-line segment is emitted here — `- ==>` child segments are
        // physical lines of their own and are never rewritten by format().
        const flowStr = task.flow?.raw ? ` ==> ${task.flow.raw}` : '';

        const blockIdStr = task.blockId ? ` ^${task.blockId}` : '';
        const marker = TaskLineClassifier.extractMarker(task.originalText);
        return `${marker} [${statusChar}] ${task.content}${metaStr}${flowStr}${blockIdStr}`;
    }
}
