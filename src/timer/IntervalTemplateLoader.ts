/**
 * IntervalTemplateLoader
 *
 * Loads interval timer templates from a user-configured vault folder.
 * Each template is a .md file with tv-segments defined in YAML frontmatter.
 *
 * Template format:
 * ---
 * tv-name: Deep Work Session
 * tv-icon: brain
 * tv-segments:
 *   - x10:
 *       - Deep Work, 00:25:00, work
 *       - Break, 00:05:00, break
 *   - x3:
 *       - Review, 00:10:00
 * ---
 */

import { App, TFile, TFolder } from 'obsidian';
import { IntervalGroup, IntervalSegment } from './TimerInstance';

export interface IntervalTemplate {
    filePath: string;
    name: string;
    icon: string;
    groups: IntervalGroup[];
    totalDurationLabel: string;
}

const GROUP_KEY_REGEX = /^x(\d+)$/;
const HMS_REGEX = /^\d{2}:\d{2}:\d{2}$/;

export class IntervalTemplateLoader {
    constructor(private app: App) {}

    async loadTemplates(folderPath: string): Promise<IntervalTemplate[]> {
        if (!folderPath) return [];

        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return [];

        const templates: IntervalTemplate[] = [];
        for (const child of folder.children) {
            if (!(child instanceof TFile) || child.extension !== 'md') continue;
            const template = this.loadTemplate(child);
            if (template) templates.push(template);
        }

        templates.sort((a, b) => a.name.localeCompare(b.name));
        return templates;
    }

    private loadTemplate(file: TFile): IntervalTemplate | null {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm) return null;

        const rawSegments = fm['tv-segments'];
        if (!Array.isArray(rawSegments) || rawSegments.length === 0) return null;

        const groups = this.parseGroups(rawSegments);
        if (groups.length === 0) return null;

        const name = typeof fm['tv-name'] === 'string' && fm['tv-name']
            ? fm['tv-name']
            : file.basename;

        const icon = typeof fm['tv-icon'] === 'string' && fm['tv-icon']
            ? fm['tv-icon']
            : 'rotate-cw';

        return {
            filePath: file.path,
            name,
            icon,
            groups,
            totalDurationLabel: this.formatTotalDuration(groups),
        };
    }

    private parseGroups(rawSegments: unknown[]): IntervalGroup[] {
        const groups: IntervalGroup[] = [];

        for (const entry of rawSegments) {
            if (typeof entry !== 'object' || entry === null) continue;

            const keys = Object.keys(entry as Record<string, unknown>);
            if (keys.length === 0) continue;

            const key = keys[0];
            const match = key.match(GROUP_KEY_REGEX);
            if (!match) continue;

            const repeatCount = parseInt(match[1], 10);
            const rawLines = (entry as Record<string, unknown>)[key];
            if (!Array.isArray(rawLines)) continue;

            const segments: IntervalSegment[] = [];
            for (const line of rawLines) {
                if (typeof line !== 'string') continue;
                const segment = this.parseSegmentLine(line);
                if (segment) segments.push(segment);
            }

            if (segments.length > 0) {
                groups.push({ segments, repeatCount });
            }
        }

        return groups;
    }

    private parseSegmentLine(line: string): IntervalSegment | null {
        const parts = line.split(',').map(s => s.trim());
        if (parts.length < 2) return null;

        const label = parts[0];
        if (!label) return null;

        const durationStr = parts[1];
        const seconds = parseHMS(durationStr);
        if (seconds <= 0) return null;

        const rawType = parts[2]?.toLowerCase();
        const type: 'work' | 'break' = rawType === 'break' ? 'break' : 'work';

        return { label, durationSeconds: seconds, type };
    }

    private formatTotalDuration(groups: IntervalGroup[]): string {
        let totalSeconds = 0;
        let hasInfinite = false;

        for (const group of groups) {
            if (group.repeatCount === 0) {
                hasInfinite = true;
                continue;
            }
            const groupSeconds = group.segments.reduce((sum, s) => sum + s.durationSeconds, 0);
            totalSeconds += groupSeconds * Math.max(1, group.repeatCount);
        }

        if (hasInfinite) return '∞';

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
        if (hours > 0) return `${hours}h`;
        return `${minutes}m`;
    }
}

/** Parse HH:MM:SS string to total seconds. Returns 0 on invalid input. */
export function parseHMS(str: string): number {
    if (!str || !HMS_REGEX.test(str)) return 0;
    const [h, m, s] = str.split(':').map(Number);
    return h * 3600 + m * 60 + s;
}
