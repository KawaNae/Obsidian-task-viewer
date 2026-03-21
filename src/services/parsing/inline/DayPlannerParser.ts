import type { Task } from '../../../types';
import { ReadOnlyParserBase } from './ReadOnlyParserBase';
import { DateUtils } from '../../../utils/DateUtils';

/**
 * Read-only parser for Day Planner format.
 * Parses: `- [ ] HH:MM - HH:MM content` or `- [ ] HH:MM content`
 *
 * Date is not encoded in the line — it comes from daily note filename
 * inheritance handled by TaskScanner.
 */
export class DayPlannerParser extends ReadOnlyParserBase {
    readonly id = 'day-planner';

    /** HH:MM[ - HH:MM] at start of content, followed by text. */
    private static readonly TIME_RANGE_REGEX = /^(\d{2}:\d{2})(?:\s*-\s*(\d{2}:\d{2}))?\s+(.+)$/;

    parse(line: string, filePath: string, lineNumber: number): Task | null {
        const classified = this.classify(line);
        if (!classified) return null;

        const match = classified.rawContent.match(DayPlannerParser.TIME_RANGE_REGEX);
        if (!match) return null;

        const startTime = match[1];
        const endTime = match[2] as string | undefined;
        const rawContent = match[3];

        if (!DateUtils.isValidTimeString(startTime)) return null;
        if (endTime && !DateUtils.isValidTimeString(endTime)) return null;

        const { content, blockId } = this.extractBlockId(rawContent);

        return this.buildTask({
            filePath,
            lineNumber,
            line,
            content: content.trim(),
            statusChar: classified.statusChar,
            startTime,
            endTime,
            blockId,
        });
    }
}
