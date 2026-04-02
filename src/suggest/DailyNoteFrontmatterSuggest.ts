/**
 * DailyNoteFrontmatterSuggest
 *
 * Suggests frontmatter keys from daily note template and recent daily notes.
 * Auto-detects type (boolean/number/string) from values.
 */

import { App, AbstractInputSuggest, TFile } from 'obsidian';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import type { HabitDefinition, HabitType } from '../types';

export interface FrontmatterSuggestion {
    name: string;
    type: HabitType;
}

export class DailyNoteFrontmatterSuggest extends AbstractInputSuggest<FrontmatterSuggestion> {
    private existingHabits: HabitDefinition[];
    private selectCallback?: (suggestion: FrontmatterSuggestion) => void;

    constructor(
        app: App,
        inputEl: HTMLInputElement,
        existingHabits: HabitDefinition[],
        selectCallback?: (suggestion: FrontmatterSuggestion) => void,
    ) {
        super(app, inputEl);
        this.existingHabits = existingHabits;
        this.selectCallback = selectCallback;
    }

    protected getSuggestions(query: string): FrontmatterSuggestion[] {
        const suggestions = new Map<string, FrontmatterSuggestion>();

        // 1. Template frontmatter keys (priority source)
        this.collectFromTemplate(suggestions);

        // 2. Recent daily notes (supplementary)
        this.collectFromRecentDailyNotes(suggestions);

        // 3. Exclude already-defined habits
        const existingNames = new Set(this.existingHabits.map(h => h.name));

        const lowerQuery = query.toLowerCase();
        return Array.from(suggestions.values())
            .filter(s => !existingNames.has(s.name))
            .filter(s => !lowerQuery || s.name.toLowerCase().includes(lowerQuery))
            .sort((a, b) => {
                const aP = a.name.toLowerCase().startsWith(lowerQuery) ? 0 : 1;
                const bP = b.name.toLowerCase().startsWith(lowerQuery) ? 0 : 1;
                if (aP !== bP) return aP - bP;
                return a.name.localeCompare(b.name);
            })
            .slice(0, 20);
    }

    private collectFromTemplate(suggestions: Map<string, FrontmatterSuggestion>): void {
        const settings = DailyNoteUtils.getDailyNoteSettings(this.app);
        if (!settings.template) return;

        const templateFile = this.resolveTemplateFile(settings.template);
        if (!templateFile) return;

        const cache = this.app.metadataCache.getFileCache(templateFile);
        const fm = cache?.frontmatter;
        if (!fm) return;

        for (const [key, value] of Object.entries(fm)) {
            if (key.startsWith('_') || key === 'position') continue;
            suggestions.set(key, { name: key, type: inferType(value) });
        }
    }

    private resolveTemplateFile(templatePath: string): TFile | null {
        // Try as-is, then with .md extension
        let file = this.app.vault.getAbstractFileByPath(templatePath);
        if (file instanceof TFile) return file;

        file = this.app.vault.getAbstractFileByPath(templatePath + '.md');
        if (file instanceof TFile) return file;

        return null;
    }

    private collectFromRecentDailyNotes(suggestions: Map<string, FrontmatterSuggestion>): void {
        const now = new Date();
        for (let i = 0; i < 7; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const file = DailyNoteUtils.getDailyNote(this.app, date);
            if (!file) continue;

            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            if (!fm) continue;

            for (const [key, value] of Object.entries(fm)) {
                if (key.startsWith('_') || key === 'position') continue;
                // Don't overwrite template-sourced entries
                if (!suggestions.has(key)) {
                    suggestions.set(key, { name: key, type: inferType(value) });
                }
            }
        }
    }

    renderSuggestion(suggestion: FrontmatterSuggestion, el: HTMLElement): void {
        el.createSpan({ text: suggestion.name });
        el.createSpan({ text: ` (${suggestion.type})`, cls: 'suggestion-flair' });
    }

    selectSuggestion(suggestion: FrontmatterSuggestion): void {
        this.setValue(suggestion.name);
        this.selectCallback?.(suggestion);
        this.close();
    }

    updateExistingHabits(habits: HabitDefinition[]): void {
        this.existingHabits = habits;
    }
}

function inferType(value: unknown): HabitType {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    return 'string';
}
