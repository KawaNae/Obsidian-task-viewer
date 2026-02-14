import { FrontmatterTaskKeys, Task } from '../../../types';

/**
 * Builds a frontmatter-backed Task from metadata cache data.
 */
export class FrontmatterTaskBuilder {
    /**
     * Parse frontmatter object and body lines into a Task.
     * Returns null when required task date fields are not present.
     */
    static parse(
        filePath: string,
        frontmatter: Record<string, any> | undefined,
        bodyLines: string[],
        bodyStartIndex: number = 0,
        frontmatterKeys: FrontmatterTaskKeys,
        frontmatterTaskHeader: string,
        frontmatterTaskHeaderLevel: number
    ): Task | null {
        if (!frontmatter) return null;

        if (
            !(frontmatterKeys.start in frontmatter)
            && !(frontmatterKeys.end in frontmatter)
            && !(frontmatterKeys.deadline in frontmatter)
        ) {
            return null;
        }

        const startNorm = this.normalizeYamlDate(frontmatter[frontmatterKeys.start]);
        const start = this.parseDateTimeField(startNorm);

        const endNorm = this.normalizeYamlDate(frontmatter[frontmatterKeys.end]);
        const end = this.parseDateTimeField(endNorm);

        const deadlineNorm = this.normalizeYamlDate(frontmatter[frontmatterKeys.deadline]);
        const deadlineParsed = this.parseDateTimeField(deadlineNorm);

        if (!start.date && !start.time && !end.date && !end.time && !deadlineParsed.date) {
            return null;
        }

        const rawStatus = frontmatter[frontmatterKeys.status];
        const statusChar = (rawStatus === null || rawStatus === undefined || String(rawStatus).trim() === '')
            ? ' '
            : String(rawStatus).trim()[0];

        const rawContent = frontmatter[frontmatterKeys.content];
        const content = (rawContent != null && String(rawContent).trim() !== '')
            ? String(rawContent).trim()
            : '';

        const rawTimerTargetId = frontmatter[frontmatterKeys.timerTargetId];
        const timerTargetId = (rawTimerTargetId == null || String(rawTimerTargetId).trim() === '')
            ? undefined
            : String(rawTimerTargetId).trim();

        let deadline: string | undefined;
        if (deadlineParsed.date) {
            deadline = deadlineParsed.time
                ? `${deadlineParsed.date}T${deadlineParsed.time}`
                : deadlineParsed.date;
        }

        const childLines: string[] = [];
        const childBodyIndices: number[] = [];

        const wikiLinkTargets: string[] = [];
        const wikiLinkBodyLines: number[] = [];

        const section = this.findHeaderSection(
            bodyLines,
            frontmatterTaskHeader,
            frontmatterTaskHeaderLevel
        );
        if (section) {
            const block = this.collectFirstContiguousListBlock(
                bodyLines,
                section.start,
                section.end
            );
            const wikiRegex = /^\s*(?:[-*+]|\d+[.)])\s+\[\[([^\]]+)\]\]\s*$/;

            for (const relIndex of block.lineIndices) {
                const line = bodyLines[relIndex];
                const absoluteLine = bodyStartIndex + relIndex;
                childLines.push(line);
                childBodyIndices.push(absoluteLine);

                const wikiMatch = line.match(wikiRegex);
                if (wikiMatch) {
                    wikiLinkTargets.push(wikiMatch[1].trim());
                    wikiLinkBodyLines.push(absoluteLine);
                }
            }
        }

        return {
            id: `${filePath}:-1`,
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
            deadline,
            explicitStartDate: !!start.date,
            explicitStartTime: !!start.time,
            explicitEndDate: !!end.date,
            explicitEndTime: !!end.time,
            wikiLinkTargets,
            wikiLinkBodyLines,
            originalText: '',
            commands: [],
            timerTargetId,
            parserId: 'frontmatter'
        };
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

    private static collectFirstContiguousListBlock(
        bodyLines: string[],
        sectionStart: number,
        sectionEnd: number
    ): { lineIndices: number[] } {
        const lineIndices: number[] = [];
        const listRegex = /^(\s*)(?:[-*+]|\d+[.)])\s+/;

        let firstRootIndex = -1;
        let rootIndent = 0;

        for (let i = sectionStart; i < sectionEnd; i++) {
            const listMatch = bodyLines[i].match(listRegex);
            if (!listMatch) continue;
            firstRootIndex = i;
            rootIndent = listMatch[1].length;
            break;
        }
        if (firstRootIndex < 0) return { lineIndices };

        for (let i = firstRootIndex; i < sectionEnd; i++) {
            const line = bodyLines[i];
            if (line.trim() === '') break;

            const listMatch = line.match(listRegex);
            const indent = line.match(/^(\s*)/)?.[1].length ?? 0;

            if (indent <= rootIndent && !listMatch) break;
            if (indent < rootIndent) break;

            lineIndices.push(i);
        }

        return { lineIndices };
    }
}
