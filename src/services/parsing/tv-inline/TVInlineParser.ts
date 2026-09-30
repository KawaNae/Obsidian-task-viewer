import type { Task } from '../../../types';
import type { UnnamedTask } from '../TaskFactory';
import { t } from '../../../i18n';
import { createBaseTask } from '../TaskFactory';
import type { LeafParserStrategy } from '../strategies/ParserStrategy';
import { TagExtractor } from '../utils/TagExtractor';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';
import { validateDateTimeRules, type DateTimeValidationResult } from '../utils/DateTimeRuleValidator';
import { readDateBlock, taskContentText, withoutDateBlocks, type DateBlockReading } from './DateBlock';

/**
 * Task Viewer native inline parser.
 *
 * Handles all checkbox lines that this plugin owns:
 * - With scheduling block: `- [ ] foo @start>end>due`
 * - Without scheduling block: `- [ ] foo` (catch-all for non-external checkboxes)
 *
 * Its lines are written by `formatTaskLine` (TaskLineFormat), which emits
 * either the bare line (no dates) or the @notation block (with dates), so a
 * task gaining or losing dates stays this parser's line without
 * promotion/demotion bookkeeping.
 */
export class TVInlineParser implements LeafParserStrategy {
    readonly id = 'tv-inline';

    parse(line: string, filePath: string, lineNumber: number): UnnamedTask | null {
        const classified = TaskLineClassifier.classify(line);
        if (!classified) {
            return null;
        }
        const { statusChar } = classified;

        // 1. The trailing block ID (^id) is the content's last part, and the
        // command (`==>` and what follows) is no part of the content: it is
        // cut off here and read, with the task's `- ==>` lines, by `readFlow`
        // when the note is read — the line alone does not say the whole
        // program.
        const { text, blockId } = taskContentText(classified.rawContent);

        // 2. The date block (@start>end>due): the first block is the dates;
        // the others are kept verbatim, so that writing the row back keeps
        // them (`formatTaskLine`). The content is the text without any.
        const dates = readDateBlock(text);
        const content = dates ? withoutDateBlocks(text, dates) : text;
        const { startDate: date, startTime, endDate, endTime, due } = dates?.values ?? { startDate: '' };
        const extraDateBlocks = dates && dates.extraBlocks.length > 0
            ? dates.extraBlocks.map(extra => extra.text)
            : undefined;

        // No early return: TVInline accepts any classified checkbox line, with
        // or without a scheduling block. ParserChain order ensures external
        // notation parsers (tasks-plugin, day-planner) get first crack on lines
        // that match their syntax; everything else falls through to here.

        // 3. Validate date/time constraints: the line's own verdict. The
        // command's is the extraction's to add (`NoteTasks`), after these.
        let validation: Task['validation'];
        const ruleResult = this.validateDateBlock(date, startTime, endDate, endTime, due);
        const parseWarning = dates ? this.blockWarning(dates) : undefined;
        if (ruleResult) {
            validation = ruleResult;
        } else if (parseWarning) {
            validation = {
                severity: 'error',
                rule: 'parse-error',
                message: parseWarning,
                hint: '',
            };
        }

        return createBaseTask({
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
            extraDateBlocks,
            tags: TagExtractor.fromContent(content.trim()),
            blockId,
            validation,
        });
    }

    /**
     * What the notation does not read in a line's blocks: separators past
     * the second, and blocks past the first.
     */
    private blockWarning(dates: DateBlockReading): string | undefined {
        const warnings: string[] = [];
        if (dates.separators > 2) {
            warnings.push(t('validation.tooManySeparators', { count: dates.separators }));
        }
        if (dates.extraBlocks.length > 0) {
            warnings.push(t('validation.multipleDateBlocks', { count: dates.extraBlocks.length }));
        }
        return warnings.length > 0 ? warnings.join(' ') : undefined;
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
}
