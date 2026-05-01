import { App, TFile, setIcon } from 'obsidian';
import { t } from '../../i18n';
import TaskViewerPlugin from '../../main';
import { HabitDefinition } from '../../types';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import { FrontmatterLineEditor } from '../../services/persistence/utils/FrontmatterLineEditor';
import { parseHabitKey, inferHabitType } from '../../utils/HabitUtils';

export class HabitTrackerRenderer {
    // Persists collapsed state across re-renders (same pattern as PinnedListRenderer)
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
        // Check if any date has habits
        const perDateHabits = dates.map(date => this.getHabitsForDate(date));
        if (perDateHabits.every(h => h.length === 0)) {
            container.style.display = 'none';
            return;
        }

        // Axis cell (column 1): toggle button + vertical "Habits" label
        const axisCell = container.createDiv('habits-section__cell habits-section__axis');
        axisCell.setAttribute('role', 'button');
        axisCell.setAttribute('tabindex', '0');
        axisCell.setAttribute('aria-label', t('habits.toggleHabits'));

        const toggleBtn = axisCell.createEl('button', { cls: 'section-toggle-btn' });
        toggleBtn.tabIndex = -1;

        axisCell.createEl('span', { cls: 'habits-section__label', text: t('habits.habits') });

        const applyCollapsedState = () => {
            container.toggleClass('habits-section--collapsed', this.isCollapsed);
            setIcon(toggleBtn, this.isCollapsed ? 'plus' : 'minus');
            axisCell.setAttribute('aria-expanded', (!this.isCollapsed).toString());
            axisCell.setAttribute('aria-label', this.isCollapsed ? t('habits.expandHabits') : t('habits.collapseHabits'));
        };

        const toggleCollapsed = () => {
            this.isCollapsed = !this.isCollapsed;
            applyCollapsedState();
        };

        axisCell.addEventListener('click', () => {
            toggleCollapsed();
        });

        axisCell.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleCollapsed();
            }
        });

        // Apply initial collapsed state
        applyCollapsedState();

        // Per-date cells — each date independently shows its own frontmatter keys
        dates.forEach((date, i) => {
            const cell = container.createDiv('habits-section__cell');
            if (i === 0) {
                cell.addClass('is-first-cell');
                cell.dataset.collapsedLabel = t('habits.habits');
            }
            if (i === dates.length - 1) cell.addClass('is-last-cell');
            cell.dataset.date = date;

            perDateHabits[i].forEach(habit => {
                const currentValue = this.getHabitValue(date, habit.name);
                this.renderHabitItem(cell, date, habit, currentValue);
            });
        });
    }

    // ==================== Habit Collection ====================

    /**
     * Get habits for a single date.
     * If a daily note exists → use its frontmatter keys (in order).
     * If no daily note → fall back to the template's frontmatter keys.
     */
    private getHabitsForDate(date: string): HabitDefinition[] {
        const [y, m, d] = date.split('-').map(Number);
        const file = DailyNoteUtils.getDailyNote(this.app, new Date(y, m - 1, d));

        let fm: Record<string, unknown> | null = null;
        if (file) {
            fm = this.app.metadataCache.getCache(file.path)?.frontmatter ?? null;
        }
        if (!fm) {
            fm = this.getTemplateFrontmatter();
        }
        if (!fm) return [];

        return this.extractHabits(fm);
    }

    private getTemplateFrontmatter(): Record<string, unknown> | null {
        const settings = DailyNoteUtils.getDailyNoteSettings(this.app);
        if (!settings.template) return null;
        let file: TFile | null = this.app.vault.getAbstractFileByPath(settings.template) as TFile | null;
        if (!file) file = this.app.vault.getAbstractFileByPath(settings.template + '.md') as TFile | null;
        if (!(file instanceof TFile)) return null;
        return this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    }

    /**
     * Extract HabitDefinition[] from frontmatter, filtering excluded keys.
     * 型は daily fm 値から推論。値が null/undefined（空値キー）の場合はテンプレ fm から型を拾う。
     * これにより値クリア時も boolean/number 習慣の型が保持される。
     */
    private extractHabits(fm: Record<string, unknown>): HabitDefinition[] {
        const excludeKeys = this.buildExcludeKeys();
        const templateFm = this.getTemplateFrontmatter();
        const habits: HabitDefinition[] = [];
        for (const [key, value] of Object.entries(fm)) {
            if (key.startsWith('_') || key === 'position') continue;
            if (excludeKeys.has(key)) continue;
            const typeSource = (value !== null && value !== undefined) ? value : templateFm?.[key];
            const { unit } = parseHabitKey(key);
            habits.push({ name: key, type: inferHabitType(typeSource), unit });
        }
        return habits;
    }

    private buildExcludeKeys(): Set<string> {
        const excludeKeys = new Set(this.plugin.settings.habitExcludeKeys);
        for (const value of Object.values(this.plugin.settings.tvFileKeys)) {
            if (typeof value === 'string') {
                excludeKeys.add(value);
            } else if (value && typeof value === 'object' && 'key' in value) {
                excludeKeys.add((value as { key: string }).key);
            }
        }
        return excludeKeys;
    }

    // ==================== Data Access ====================

    /**
     * Read a habit value from the daily note's frontmatter for a given date.
     * Returns undefined if daily note doesn't exist or key is not set.
     */
    private getHabitValue(date: string, habitName: string): boolean | string | number | undefined {
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
     *
     * - value === '' → 空値キー `habitName:` として書き込み（「今日は値なし」）
     * - それ以外 → String(value) で書き込み
     *
     * キー削除（「その日から習慣を外す」）は UI からは提供しない。
     * ユーザーが frontmatter を直接編集する運用。
     *
     * Uses vault.process() directly (NOT processFrontMatter) to avoid race conditions.
     */
    private async setHabitValue(date: string, habitName: string, value: boolean | string | number): Promise<void> {
        const [y, m, d] = date.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);

        let file = DailyNoteUtils.getDailyNote(this.app, dateObj);
        if (!file) {
            file = await DailyNoteUtils.createDailyNote(this.app, dateObj);
        }
        if (!file) return;

        await this.app.vault.process(file, (content) => {
            // frontmatter が無ければ空 frontmatter を先頭に付加して一本化
            const hasFm = FrontmatterLineEditor.findEnd(content.split('\n')) >= 0;
            const normalized = hasFm ? content : `---\n---\n${content}`;

            const lines = normalized.split('\n');
            const fmEnd = FrontmatterLineEditor.findEnd(lines);
            const fmValue = value === '' ? '' : String(value);

            return FrontmatterLineEditor.applyUpdates(lines, fmEnd, { [habitName]: fmValue });
        });
    }

    // ==================== Rendering ====================

    /**
     * Render one habit row (label + interactive value) inside a date cell.
     */
    private renderHabitItem(cell: HTMLElement, date: string, habit: HabitDefinition, currentValue: boolean | string | number | undefined): void {
        const row = cell.createDiv('habits-section__habit-row');
        const { displayName } = parseHabitKey(habit.name);
        row.createEl('span', { cls: 'habits-section__habit-label', text: displayName });

        if (habit.type === 'boolean') {
            this.renderBooleanToggle(row, date, habit, currentValue);
        } else {
            this.renderValueInput(row, date, habit, currentValue);
        }
    }

    /**
     * Boolean: native checkbox, toggling persists true/false.
     * false も明示書き込みして行を残し、inferHabitType での型保持を確実にする。
     */
    private renderBooleanToggle(container: HTMLElement, date: string, habit: HabitDefinition, currentValue: boolean | string | number | undefined): void {
        const checkbox = container.createEl('input', { cls: 'habits-section__checkbox' });
        checkbox.type = 'checkbox';
        checkbox.checked = currentValue === true;

        checkbox.addEventListener('change', async () => {
            await this.setHabitValue(date, habit.name, checkbox.checked);
        });
    }

    /**
     * Number / String: click shows inline <input>, Enter/blur saves, Escape cancels.
     */
    private renderValueInput(container: HTMLElement, date: string, habit: HabitDefinition, currentValue: boolean | string | number | undefined): void {
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
                let newValue: string | number;

                if (raw === '') {
                    newValue = ''; // 空値キー（「今日は値なし」）
                } else if (habit.type === 'number') {
                    const num = Number(raw);
                    newValue = isNaN(num) ? '' : num; // パース失敗もクリア扱い
                } else {
                    newValue = raw;
                }

                // Update display
                const newHasValue = newValue !== '';
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
