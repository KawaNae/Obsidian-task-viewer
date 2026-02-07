import { App, TFile, setIcon } from 'obsidian';
import TaskViewerPlugin from '../../../main';
import { HabitDefinition } from '../../../types';
import { DailyNoteUtils } from '../../../utils/DailyNoteUtils';
import { FrontmatterKeyOrderer } from '../../../services/persistence/utils/FrontmatterKeyOrderer';
import { FrontmatterLineEditor } from '../../../services/persistence/utils/FrontmatterLineEditor';

export class HabitTrackerRenderer {
    // Persists collapsed state across re-renders (same pattern as DeadlineListRenderer)
    private isCollapsed: boolean = false;

    constructor(
        private app: App,
        private plugin: TaskViewerPlugin
    ) {}

    /**
     * Render the Habits grid row.
     * @param container The `timeline-row habits-section` div created by GridRenderer.
     * @param dates Visible date columns (YYYY-MM-DD[]).
     */
    public render(container: HTMLElement, dates: string[]): void {
        const habits = this.plugin.settings.habits;
        if (habits.length === 0) return;

        // Axis cell (column 1): toggle button + vertical "Habits" label
        const axisCell = container.createDiv('habits-section__cell habits-section__axis');

        const toggleBtn = axisCell.createEl('button', { cls: 'section-toggle-btn' });
        setIcon(toggleBtn, this.isCollapsed ? 'plus' : 'minus');
        toggleBtn.setAttribute('aria-label', 'Toggle Habits section');

        axisCell.createEl('span', { cls: 'habits-section__label', text: 'Habits' });

        toggleBtn.addEventListener('click', () => {
            this.isCollapsed = !this.isCollapsed;
            container.toggleClass('collapsed', this.isCollapsed);
            setIcon(toggleBtn, this.isCollapsed ? 'plus' : 'minus');
        });

        // Apply initial collapsed state
        if (this.isCollapsed) {
            container.addClass('collapsed');
        }

        // Per-date cells
        dates.forEach((date, i) => {
            const cell = container.createDiv('habits-section__cell');
            if (i === 0) cell.addClass('is-first-cell');
            if (i === dates.length - 1) cell.addClass('is-last-cell');
            cell.dataset.date = date;

            // Render each habit item in this cell
            habits.forEach(habit => {
                const currentValue = this.getHabitValue(date, habit.name);
                this.renderHabitItem(cell, date, habit, currentValue);
            });
        });
    }

    // ==================== Data Access ====================

    /**
     * Read a habit value from the daily note's frontmatter for a given date.
     * Returns undefined if daily note doesn't exist or key is not set.
     */
    private getHabitValue(date: string, habitName: string): any {
        const [y, m, d] = date.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        const file = DailyNoteUtils.getDailyNote(this.app, dateObj);
        if (!file) return undefined;
        const cache = this.app.metadataCache.getCache(file.path);
        return cache?.frontmatter?.[habitName];
    }

    /**
     * Write a habit value to the daily note's frontmatter.
     * Auto-creates the daily note if it doesn't exist.
     * value === undefined/null/'' → delete the key.
     *
     * Uses vault.process() directly (NOT processFrontMatter) to avoid race conditions.
     */
    private async setHabitValue(date: string, habitName: string, value: any): Promise<void> {
        const [y, m, d] = date.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);

        let file = DailyNoteUtils.getDailyNote(this.app, dateObj);
        if (!file) {
            file = await DailyNoteUtils.createDailyNote(this.app, dateObj);
        }
        if (!file) return;

        const keyOrderer = new FrontmatterKeyOrderer(this.plugin.settings);

        await this.app.vault.process(file, (content) => {
            const lines = content.split('\n');
            const fmEnd = FrontmatterLineEditor.findEnd(lines);

            if (fmEnd < 0) {
                // No frontmatter: create one with habit key
                if (value === undefined || value === null || value === '') return content;
                return `---\n${habitName}: ${value}\n---\n${content}`;
            }

            const { allFields, originalIndices, nextKeyIndex } = FrontmatterLineEditor.parseFields(lines, fmEnd);

            // Apply habit update
            let keyIndex = nextKeyIndex;
            if (value === undefined || value === null || value === '') {
                allFields.delete(habitName);
                originalIndices.delete(habitName);
            } else {
                allFields.set(habitName, String(value));
                if (!originalIndices.has(habitName)) {
                    originalIndices.set(habitName, keyIndex++);
                }
            }

            return FrontmatterLineEditor.rebuild(lines, fmEnd, allFields, originalIndices, keyOrderer);
        });
    }

    // ==================== Rendering ====================

    /**
     * Render one habit row (label + interactive value) inside a date cell.
     */
    private renderHabitItem(cell: HTMLElement, date: string, habit: HabitDefinition, currentValue: any): void {
        const row = cell.createDiv('habits-section__habit-row');
        row.createEl('span', { cls: 'habits-section__habit-label', text: habit.name });

        if (habit.type === 'boolean') {
            this.renderBooleanToggle(row, date, habit, currentValue);
        } else {
            this.renderValueInput(row, date, habit, currentValue);
        }
    }

    /**
     * Boolean: native checkbox, toggling persists true / deletes the key.
     */
    private renderBooleanToggle(container: HTMLElement, date: string, habit: HabitDefinition, currentValue: any): void {
        const checkbox = container.createEl('input', { cls: 'habits-section__checkbox' });
        checkbox.type = 'checkbox';
        checkbox.checked = currentValue === true;

        checkbox.addEventListener('change', async () => {
            await this.setHabitValue(date, habit.name, checkbox.checked ? true : undefined);
        });
    }

    /**
     * Number / String: click shows inline <input>, Enter/blur saves, Escape cancels.
     */
    private renderValueInput(container: HTMLElement, date: string, habit: HabitDefinition, currentValue: any): void {
        const hasValue = currentValue !== undefined && currentValue !== null;
        const displayText = hasValue ? String(currentValue) : '—';

        const display = container.createEl('span', {
            cls: 'habits-section__value-display',
            text: displayText
        });
        display.toggleClass('is-set', hasValue);

        // Unit suffix (number type + unit defined のときのみ)
        const unitSpan = habit.unit
            ? container.createEl('span', { cls: 'habits-section__unit', text: habit.unit })
            : null;
        if (unitSpan) unitSpan.toggleClass('is-set', hasValue);

        display.addEventListener('click', () => {
            // Prevent duplicate input if already editing
            if (container.querySelector('.habits-section__input')) return;

            display.style.display = 'none';

            const inputType = habit.type === 'number' ? 'number' : 'text';
            const input = document.createElement('input');
            input.className = 'habits-section__input';
            input.type = inputType;
            input.value = hasValue ? String(currentValue) : '';

            // unit の直前に挿入 → label | input | unit の順序を維持
            if (unitSpan) {
                container.insertBefore(input, unitSpan);
                unitSpan.addClass('is-set'); // 編集中は単位ラベルを表示
            } else {
                container.appendChild(input);
            }

            input.focus();
            input.select();

            let escaped = false;

            const commit = async () => {
                if (escaped) return;
                const raw = input.value.trim();
                let newValue: any;

                if (raw === '') {
                    newValue = undefined; // delete key
                } else if (habit.type === 'number') {
                    const num = Number(raw);
                    newValue = isNaN(num) ? undefined : num;
                } else {
                    newValue = raw;
                }

                // Update display
                const newHasValue = newValue !== undefined;
                display.textContent = newHasValue ? String(newValue) : '—';
                display.toggleClass('is-set', newHasValue);
                if (unitSpan) unitSpan.toggleClass('is-set', newHasValue);
                display.style.display = '';
                input.remove();

                // Persist
                await this.setHabitValue(date, habit.name, newValue);
            };

            input.addEventListener('blur', commit);

            input.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur(); // triggers commit via blur handler
                } else if (e.key === 'Escape') {
                    escaped = true;
                    input.remove();
                    if (unitSpan) unitSpan.toggleClass('is-set', hasValue);
                    display.style.display = '';
                }
            });
        });
    }
}
