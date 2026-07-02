import { TvFileKeys, Task, WikilinkRef, ChildLine } from '../../../types';
import { createBaseTask } from '../TaskFactory';
import { TaskIdGenerator } from '../../display/TaskIdGenerator';
import { TagExtractor } from '../utils/TagExtractor';
import { ChildLineClassifier } from '../utils/ChildLineClassifier';
import { validateDateTimeRules } from '../utils/DateTimeRuleValidator';
import { isTaskBearingFile } from '../utils/FrontmatterPolicy';
import { FilePropertyResolver } from '../FilePropertyResolver';
import { normalizeYamlDate, parseDateTimeField } from '../utils/DateTimeFieldParser';

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
        frontmatterKeys: TvFileKeys,
        tvFileChildHeader: string,
        tvFileChildHeaderLevel: number
    ): FrontmatterParseResult | null {
        if (!isTaskBearingFile(frontmatter, frontmatterKeys)) return null;
        const fm = frontmatter as Record<string, any>;

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
            tvFileChildHeader,
            tvFileChildHeaderLevel
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
        for (let i = 0; i < bodyLines.length; i++) {
            const wikiMatch = bodyLines[i].match(ChildLineClassifier.WIKILINK_CHILD);
            if (wikiMatch) {
                wikilinkRefs.push({ target: wikiMatch[1].trim(), bodyLine: bodyStartIndex + i });
            }
        }

        const contentTags = TagExtractor.fromContent(content);
        const fmExtracted = FilePropertyResolver.extract(fm, frontmatterKeys);

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
            task: createBaseTask({
                id: TaskIdGenerator.generate('tv-file', filePath, 'fm-root'),
                file: filePath,
                line: -1,
                content,
                statusChar,
                parserId: 'tv-file',
                originalText: '',
            }, {
                childLines,
                childLineBodyOffsets: childBodyIndices,
                startDate: start.date,
                startTime: start.time,
                endDate: end.date,
                endTime: end.time,
                due,
                tags: TagExtractor.merge(contentTags, fmExtracted.tags ?? []),
                timerTargetId,
                properties: fmExtracted.properties,
                color: fmExtracted.color,
                linestyle: fmExtracted.linestyle,
                mask: fmExtracted.mask,
                validation,
            }),
            wikilinkRefs,
        };
    }

    /**
     * Normalize YAML scalar values emitted by metadata cache.
     */
    static normalizeYamlDate = normalizeYamlDate;
    static parseDateTimeField = parseDateTimeField;

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
