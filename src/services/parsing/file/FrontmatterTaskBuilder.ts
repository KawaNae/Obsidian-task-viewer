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
        frontmatterKeys: FrontmatterTaskKeys
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
        const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') || '';
        const content = (rawContent != null && String(rawContent).trim() !== '')
            ? String(rawContent).trim()
            : fileName;

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

        const listItemRegex = /^(\s*)-\s/;
        let minListIndent = Infinity;
        for (const line of bodyLines) {
            const m = line.match(listItemRegex);
            if (m) minListIndent = Math.min(minListIndent, m[1].length);
        }

        const wikiRegex = /^(\s*)-\s+\[\[([^\]]+)\]\]\s*$/;
        for (let i = 0; i < bodyLines.length; i++) {
            const match = bodyLines[i].match(wikiRegex);
            if (match && match[1].length === minListIndent) {
                wikiLinkTargets.push(match[2].trim());
                wikiLinkBodyLines.push(bodyStartIndex + i);
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
}