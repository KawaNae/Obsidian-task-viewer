/**
 * IntervalTemplateLoader
 *
 * Loads interval timer templates from a user-configured vault folder.
 * Each template is a .md file with _tv-name in YAML frontmatter
 * and timer data (icon, groups) in a ```json code block.
 *
 * Template format:
 * ---
 * _tv-name: Deep Work Session
 * ---
 *
 * ```json
 * {
 *   "icon": "brain",
 *   "groups": [
 *     {
 *       "repeatCount": 10,
 *       "segments": [
 *         { "label": "Deep Work", "durationSeconds": 1500, "type": "work" },
 *         { "label": "Break", "durationSeconds": 300, "type": "break" }
 *       ]
 *     }
 *   ]
 * }
 * ```
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

export class IntervalTemplateLoader {
    constructor(private app: App) {}

    async loadTemplates(folderPath: string): Promise<IntervalTemplate[]> {
        if (!folderPath) return [];

        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return [];

        const templates: IntervalTemplate[] = [];
        for (const child of folder.children) {
            if (!(child instanceof TFile) || child.extension !== 'md') continue;
            const template = await this.loadTemplate(child);
            if (template) templates.push(template);
        }

        templates.sort((a, b) => a.name.localeCompare(b.name));
        return templates;
    }

    async findByBasename(folderPath: string, basename: string): Promise<IntervalTemplate | null> {
        if (!folderPath) return null;

        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return null;

        for (const child of folder.children) {
            if (!(child instanceof TFile) || child.extension !== 'md') continue;
            if (child.basename === basename) {
                return await this.loadTemplate(child);
            }
        }
        return null;
    }

    private async loadTemplate(file: TFile): Promise<IntervalTemplate | null> {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;

        const name = (fm && typeof fm['_tv-name'] === 'string' && fm['_tv-name'])
            ? fm['_tv-name']
            : file.basename;

        const content = await this.app.vault.cachedRead(file);
        const jsonData = this.extractJsonBlock(content);
        if (!jsonData) return null;

        const groups = this.parseGroups(jsonData.groups);
        if (groups.length === 0) return null;

        const icon = typeof jsonData.icon === 'string' && jsonData.icon
            ? jsonData.icon
            : 'rotate-cw';

        return {
            filePath: file.path,
            name,
            icon,
            groups,
            totalDurationLabel: this.formatTotalDuration(groups),
        };
    }

    private extractJsonBlock(content: string): Record<string, unknown> | null {
        const match = content.match(/```json\s*\n([\s\S]*?)\n```/);
        if (!match) return null;
        try {
            const parsed = JSON.parse(match[1]);
            return (parsed && typeof parsed === 'object') ? parsed : null;
        } catch {
            return null;
        }
    }

    private parseGroups(raw: unknown): IntervalGroup[] {
        if (!Array.isArray(raw)) return [];
        const groups: IntervalGroup[] = [];

        for (const entry of raw) {
            if (!entry || typeof entry !== 'object') continue;
            const obj = entry as Record<string, unknown>;

            const repeatCount = typeof obj.repeatCount === 'number' ? obj.repeatCount : 1;
            if (!Array.isArray(obj.segments)) continue;

            const segments: IntervalSegment[] = [];
            for (const seg of obj.segments) {
                if (!seg || typeof seg !== 'object') continue;
                const s = seg as Record<string, unknown>;

                const label = typeof s.label === 'string' ? s.label : '';
                const durationSeconds = typeof s.durationSeconds === 'number' ? s.durationSeconds : 0;
                if (!label || durationSeconds <= 0) continue;

                const rawType = typeof s.type === 'string' ? s.type.toLowerCase() : 'work';
                const type: 'work' | 'break' = rawType === 'break' ? 'break' : 'work';

                segments.push({ label, durationSeconds, type });
            }

            if (segments.length > 0) {
                groups.push({ segments, repeatCount });
            }
        }

        return groups;
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
