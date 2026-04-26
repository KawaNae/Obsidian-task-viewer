import type { Task, TasksPluginMapping, TaskFieldMapping } from '../../../types';
import { ReadOnlyParserBase } from './ReadOnlyParserBase';

/**
 * Emoji field identifiers used by the Tasks plugin.
 * Only date-bearing emojis are extracted; priority/recurrence are stripped but not mapped.
 */
type EmojiFieldKey = 'start' | 'scheduled' | 'due' | 'done' | 'recurrence' | 'priority';

interface EmojiDef {
    emoji: string;
    key: EmojiFieldKey;
    hasDate: boolean;
}

const EMOJI_DEFS: EmojiDef[] = [
    { emoji: '📅', key: 'due',        hasDate: true },
    { emoji: '⏳', key: 'scheduled',  hasDate: true },
    { emoji: '🛫', key: 'start',      hasDate: true },
    { emoji: '✅', key: 'done',       hasDate: true },
    { emoji: '🔁', key: 'recurrence', hasDate: false },
    { emoji: '⏫', key: 'priority',   hasDate: false },
    { emoji: '🔼', key: 'priority',   hasDate: false },
    { emoji: '🔽', key: 'priority',   hasDate: false },
];

/** Build a combined regex that matches any emoji + optional date. */
const EMOJI_PATTERN = EMOJI_DEFS.map(d => d.emoji).join('|');
const EMOJI_FIELD_REGEX = new RegExp(`(${EMOJI_PATTERN})\\s*(\\d{4}-\\d{2}-\\d{2})?`, 'gu');

/** Quick check: line must contain at least one date-bearing emoji followed by a date. */
const HAS_DATE_EMOJI_REGEX = new RegExp(`(?:📅|⏳|🛫|✅)\\s*\\d{4}-\\d{2}-\\d{2}`, 'u');

/**
 * Read-only parser for the Obsidian Tasks plugin emoji notation.
 *
 * Parses: `- [ ] content 📅 2024-01-01 🛫 2024-01-02 ⏳ 2024-01-03`
 *
 * Field mapping (🛫/⏳/📅 → startDate/endDate/due) is configurable via TasksPluginMapping.
 */
export class TasksPluginParser extends ReadOnlyParserBase {
    readonly id = 'tasks-plugin';

    constructor(private mapping: TasksPluginMapping) {
        super();
    }

    parse(line: string, filePath: string, lineNumber: number): Task | null {
        const classified = this.classify(line);
        if (!classified) return null;

        // Quick reject: must have at least one date-bearing emoji + date
        if (!HAS_DATE_EMOJI_REGEX.test(classified.rawContent)) return null;

        const { content: contentAfterBlockId, blockId } = this.extractBlockId(classified.rawContent);

        // Extract all emoji fields and collect dates by key
        const dates: Partial<Record<EmojiFieldKey, string>> = {};
        let cleanContent = contentAfterBlockId;

        // Reset regex state
        EMOJI_FIELD_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null;
        const matchesToRemove: string[] = [];

        while ((match = EMOJI_FIELD_REGEX.exec(contentAfterBlockId)) !== null) {
            const emoji = match[1];
            const dateValue = match[2];
            const def = EMOJI_DEFS.find(d => d.emoji === emoji);
            if (def && dateValue && def.hasDate) {
                // First occurrence wins (🛫 appears before ⏳ if both present)
                if (!dates[def.key]) {
                    dates[def.key] = dateValue;
                }
            }
            matchesToRemove.push(match[0]);
        }

        // Remove emoji+date from content
        for (const m of matchesToRemove) {
            cleanContent = cleanContent.replace(m, '');
        }
        cleanContent = cleanContent.replace(/\s{2,}/g, ' ').trim();

        // Apply configurable mapping
        const mapped = this.applyMapping(dates);

        // Must have at least one mapped date field
        if (!mapped.startDate && !mapped.endDate && !mapped.due) return null;

        return this.buildTask({
            filePath,
            lineNumber,
            line,
            content: cleanContent,
            statusChar: classified.statusChar,
            startDate: mapped.startDate,
            endDate: mapped.endDate,
            due: mapped.due,
            blockId,
        });
    }

    /**
     * Apply the user-configured mapping from emoji fields to Task date fields.
     * When multiple emoji fields map to the same Task field, priority: start > scheduled > due.
     */
    private applyMapping(
        dates: Partial<Record<EmojiFieldKey, string>>,
    ): { startDate?: string; endDate?: string; due?: string } {
        const result: { startDate?: string; endDate?: string; due?: string } = {};

        // Process in priority order: start > scheduled > due
        const entries: { key: 'start' | 'scheduled' | 'due'; target: TaskFieldMapping }[] = [
            { key: 'start',     target: this.mapping.start },
            { key: 'scheduled', target: this.mapping.scheduled },
            { key: 'due',       target: this.mapping.due },
        ];

        for (const { key, target } of entries) {
            const date = dates[key];
            if (!date || target === 'ignore') continue;

            // First writer wins for each target field
            if (!result[target]) {
                result[target] = date;
            }
        }

        return result;
    }
}
