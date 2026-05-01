import { FrontmatterTaskKeys, Task, WikilinkRef, ChildLine, PropertyType, PropertyValue } from '../../../types';
import { TaskIdGenerator } from '../../display/TaskIdGenerator';
import { TagExtractor } from '../utils/TagExtractor';
import { ChildLineClassifier } from '../utils/ChildLineClassifier';
import { VALID_LINE_STYLES } from '../../../constants/style';
import { normalizeColor } from '../../../utils/ColorUtils';
import { validateDateTimeRules } from '../utils/DateTimeRuleValidator';
import { isTaskBearingFile } from '../utils/FrontmatterPolicy';

export interface FrontmatterParseResult {
    task: Task;
    wikilinkRefs: WikilinkRef[];
}

/**
 * Task Viewer file-level Task builder.
 *
 * Builds a Task from a file's frontmatter (TaskViewer's file-level format).
 * Also builds unscheduled tv-file tasks (no dates, groups inline tasks) —
 * identified via the derived isTvFileUnscheduled() helper.
 */
export class TVFileBuilder {
    /**
     * Parse frontmatter object and body lines into a Task.
     * Returns null when the file is not task-bearing (see isTaskBearingFile).
     */
    static parse(
        filePath: string,
        frontmatter: Record<string, any> | undefined,
        bodyLines: string[],
        bodyStartIndex: number = 0,
        frontmatterKeys: FrontmatterTaskKeys,
        frontmatterTaskHeader: string,
        frontmatterTaskHeaderLevel: number
    ): FrontmatterParseResult | null {
        if (!isTaskBearingFile(frontmatter, frontmatterKeys)) return null;
        const fm = frontmatter as Record<string, any>;

        // Extract custom properties from frontmatter (non-plugin keys)
        const excludedKeys = new Set<string>(Object.values(frontmatterKeys));
        excludedKeys.add('tags'); // Always exclude standard Obsidian tags key

        const startNorm = this.normalizeYamlDate(fm[frontmatterKeys.start]);
        const start = this.parseDateTimeField(startNorm);

        const endNorm = this.normalizeYamlDate(fm[frontmatterKeys.end]);
        const end = this.parseDateTimeField(endNorm);

        const dueNorm = this.normalizeYamlDate(fm[frontmatterKeys.due]);
        const dueParsed = this.parseDateTimeField(dueNorm);

        const hasDateFields = !!(start.date || start.time || end.date || end.time || dueParsed.date);

        const rawStatus = fm[frontmatterKeys.status];
        const statusChar = (rawStatus === null || rawStatus === undefined || String(rawStatus).trim() === '')
            ? ' '
            : String(rawStatus).trim()[0];

        const rawContent = fm[frontmatterKeys.content];
        const content = (rawContent != null && String(rawContent).trim() !== '')
            ? String(rawContent).trim()
            : '';

        const rawTimerTargetId = fm[frontmatterKeys.timerTargetId];
        const timerTargetId = (rawTimerTargetId == null || String(rawTimerTargetId).trim() === '')
            ? undefined
            : String(rawTimerTargetId).trim();

        let due: string | undefined;
        if (dueParsed.date) {
            due = dueParsed.time
                ? `${dueParsed.date}T${dueParsed.time}`
                : dueParsed.date;
        }

        const childLines: ChildLine[] = [];
        const childBodyIndices: number[] = [];

        // Collect childLines from configured heading section (for card display)
        const section = this.findHeaderSection(
            bodyLines,
            frontmatterTaskHeader,
            frontmatterTaskHeaderLevel
        );
        if (section) {
            const block = this.collectAllListItems(
                bodyLines,
                section.start,
                section.end
            );
            for (const relIndex of block.lineIndices) {
                const line = bodyLines[relIndex];
                const absoluteLine = bodyStartIndex + relIndex;
                childLines.push(ChildLineClassifier.classify(line));
                childBodyIndices.push(absoluteLine);
            }
        }

        // Extract wikilinkRefs from entire body (for parent-child resolution)
        // Safe because WikiLinkResolver.wireChild() validates the target exists as a frontmatter task
        const wikilinkRefs: WikilinkRef[] = [];
        const wikiRegex = /^\s*(?:[-*+]|\d+[.)])\s+\[\[([^\]]+)\]\]\s*$/;
        for (let i = 0; i < bodyLines.length; i++) {
            const wikiMatch = bodyLines[i].match(wikiRegex);
            if (wikiMatch) {
                wikilinkRefs.push({ target: wikiMatch[1].trim(), bodyLine: bodyStartIndex + i });
            }
        }

        const contentTags = TagExtractor.fromContent(content);
        const taskTags = TagExtractor.fromFrontmatter(fm['tags']);

        const fmProperties: Record<string, PropertyValue> = {};
        for (const [key, value] of Object.entries(fm)) {
            if (excludedKeys.has(key)) continue;
            if (value === null || value === undefined) continue;
            const type: PropertyType =
                typeof value === 'number' ? 'number'
                : typeof value === 'boolean' ? 'boolean'
                : Array.isArray(value) ? 'array'
                : 'string';
            fmProperties[key] = {
                value: Array.isArray(value) ? value.join(', ') : String(value),
                type,
            };
        }

        // Resolve color/linestyle/mask directly on the task
        const rawColor = fm[frontmatterKeys.color];
        const color = (typeof rawColor === 'string' && rawColor.trim()) ? normalizeColor(rawColor) : undefined;
        const linestyle = this.resolveLinestyle(fm[frontmatterKeys.linestyle]);
        const rawMask = fm[frontmatterKeys.mask];
        const mask = (typeof rawMask === 'string' && rawMask.trim()) ? rawMask.trim() : undefined;

        // Validate date/time constraints
        const validation = hasDateFields
            ? validateDateTimeRules({
                startDate: start.date || undefined,
                startTime: start.time,
                endDate: end.date || undefined,
                endTime: end.time,
                due,
                endDateImplicit: !end.date,
                isFrontmatter: true,
            }) ?? undefined
            : undefined;

        return {
            task: {
                id: TaskIdGenerator.generate('tv-file', filePath, 'fm-root'),
                file: filePath,
                line: -1,
                content,
                statusChar,
                indent: 0,
                childIds: [],
                childLines,
                childLineBodyOffsets: childBodyIndices,
                startDate: start.date,
                startTime: start.time,
                endDate: end.date,
                endTime: end.time,
                due,
                tags: TagExtractor.merge(contentTags, taskTags),
                originalText: '',
                commands: [],
                timerTargetId,
                parserId: 'tv-file',
                properties: fmProperties,
                color,
                linestyle,
                mask,
                validation,
            },
            wikilinkRefs,
        };
    }

    /**
     * Resolve and validate linestyle value.
     */
    private static resolveLinestyle(value: unknown): string | undefined {
        if (typeof value !== 'string') return undefined;
        const normalized = value.trim().toLowerCase();
        return VALID_LINE_STYLES.has(normalized) ? normalized : undefined;
    }

    /**
     * Normalize YAML scalar values emitted by metadata cache.
     */
    static normalizeYamlDate(value: unknown): string | null {
        if (value === null || value === undefined) return null;

        if (value instanceof Date) {
            const y = value.getFullYear();
            const m = (value.getMonth() + 1).toString().padStart(2, '0');
            const d = value.getDate().toString().padStart(2, '0');
            const h = value.getHours();
            const min = value.getMinutes();
            if (h === 0 && min === 0) {
                return `${y}-${m}-${d}`;
            }
            return `${y}-${m}-${d}T${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
        }

        if (typeof value === 'number') {
            if (value >= 0 && value < 1440) {
                const hours = Math.floor(value / 60);
                const minutes = value % 60;
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            }
            return null;
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
        }

        return String(value).trim() || null;
    }

    /**
     * Extract date/time fragments from a normalized field.
     */
    static parseDateTimeField(normalized: string | null): { date?: string; time?: string } {
        if (!normalized) return {};
        const dateMatch = normalized.match(/(\d{4}-\d{2}-\d{2})/);
        const timeMatch = normalized.match(/(\d{2}:\d{2})/);
        return {
            date: dateMatch ? dateMatch[1] : undefined,
            time: timeMatch ? timeMatch[1] : undefined
        };
    }

    private static findHeaderSection(
        bodyLines: string[],
        headerName: string,
        headerLevel: number
    ): { start: number; end: number } | null {
        const expected = headerName.trim();
        if (!expected || headerLevel < 1 || headerLevel > 6) return null;

        let start = -1;
        for (let i = 0; i < bodyLines.length; i++) {
            const header = this.parseHeaderLine(bodyLines[i]);
            if (!header) continue;
            if (header.level === headerLevel && header.text.trim() === expected) {
                start = i + 1;
                break;
            }
        }
        if (start < 0) return null;

        let end = bodyLines.length;
        for (let i = start; i < bodyLines.length; i++) {
            const header = this.parseHeaderLine(bodyLines[i]);
            if (!header) continue;
            if (header.level <= headerLevel) {
                end = i;
                break;
            }
        }

        return { start, end };
    }

    private static parseHeaderLine(line: string): { level: number; text: string } | null {
        const match = line.match(/^(#{1,6})\s+(.*)$/);
        if (!match) return null;
        return { level: match[1].length, text: match[2] };
    }

    private static collectAllListItems(
        bodyLines: string[],
        sectionStart: number,
        sectionEnd: number
    ): { lineIndices: number[] } {
        const lineIndices: number[] = [];
        const listRegex = /^(\s*)(?:[-*+]|\d+[.)])\s+/;

        let rootIndent: number | null = null;

        for (let i = sectionStart; i < sectionEnd; i++) {
            const line = bodyLines[i];
            if (line.trim() === '') continue; // 空行をスキップ（停止しない）

            const listMatch = line.match(listRegex);
            if (!listMatch) continue; // 非リスト行をスキップ

            const indent = listMatch[1].length;
            if (rootIndent === null) {
                rootIndent = indent;
            }

            // ルートレベル以上のインデントのリスト要素のみ収集
            if (indent >= rootIndent) {
                lineIndices.push(i);
            }
        }

        return { lineIndices };
    }
}
