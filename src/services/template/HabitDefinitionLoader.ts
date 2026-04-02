/**
 * HabitDefinitionLoader
 *
 * Loads habit definitions from a vault markdown file.
 * Format: YAML frontmatter (_tv-type: habits) + JSON code block (array of HabitDefinition).
 */

import { App, TFile } from 'obsidian';
import type { HabitDefinition, HabitType } from '../../types';

const VALID_HABIT_TYPES = new Set<HabitType>(['boolean', 'number', 'string']);

export class HabitDefinitionLoader {
    constructor(private app: App) {}

    async load(filePath: string): Promise<HabitDefinition[]> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return [];

        try {
            const content = await this.app.vault.cachedRead(file);
            const raw = this.extractJsonBlock(content);
            return this.validateHabits(raw);
        } catch {
            return [];
        }
    }

    private extractJsonBlock(content: string): unknown {
        const match = content.match(/```json\s*\n([\s\S]*?)\n```/);
        if (!match) return null;
        try {
            return JSON.parse(match[1]);
        } catch {
            return null;
        }
    }

    private validateHabits(raw: unknown): HabitDefinition[] {
        if (!Array.isArray(raw)) return [];
        const habits: HabitDefinition[] = [];
        for (const entry of raw) {
            if (!entry || typeof entry !== 'object') continue;
            const { name, type, unit } = entry as Record<string, unknown>;
            if (typeof name !== 'string' || !name) continue;
            if (!VALID_HABIT_TYPES.has(type as HabitType)) continue;
            const habit: HabitDefinition = { name, type: type as HabitType };
            if (typeof unit === 'string' && unit) habit.unit = unit;
            habits.push(habit);
        }
        return habits;
    }
}
