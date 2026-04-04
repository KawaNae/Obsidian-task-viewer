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

    /** Returns habit definitions, or null if the file could not be read/parsed. */
    async load(filePath: string): Promise<HabitDefinition[] | null> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            console.warn(`[TaskViewer] Habit definition file not found: ${filePath}`);
            return null;
        }

        try {
            const content = await this.app.vault.read(file);
            const raw = this.extractJsonBlock(content);
            if (raw === null) {
                console.warn(`[TaskViewer] No valid JSON code block in: ${filePath}`);
                return null;
            }
            return this.validateHabits(raw);
        } catch (e) {
            console.warn(`[TaskViewer] Failed to read habit definition file: ${filePath}`, e);
            return null;
        }
    }

    private extractJsonBlock(content: string): unknown {
        const match = content.match(/```json\s*\n([\s\S]*?)\n```/);
        if (!match) return null;
        try {
            return JSON.parse(match[1]);
        } catch (e) {
            console.warn('[TaskViewer] Failed to parse habit JSON block', e);
            return null;
        }
    }

    private validateHabits(raw: unknown): HabitDefinition[] {
        if (!Array.isArray(raw)) {
            console.warn('[TaskViewer] Habit definition is not an array');
            return [];
        }
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
