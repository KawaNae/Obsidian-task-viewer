import { setIcon } from 'obsidian';
import type {
    FilterCondition, DateFilterValue, RelativeDatePreset,
} from '../../services/filter/FilterTypes';
import {
    getRelativeDateLabel,
} from '../../services/filter/FilterTypes';
import type { StatusDefinition, Task } from '../../types';
import type { FilterDropdownMenus } from './FilterDropdownMenus';
import { getToday, getAvailableValues, getValueDisplay, formatValueLabel } from './FilterValueHelpers';
import { t } from '../../i18n';

export class FilterConditionRenderer {
    constructor(
        private refreshPopover: () => void,
        private renderContent: () => void,
        private dropdowns: FilterDropdownMenus,
        private getStatusDefs: () => StatusDefinition[],
        private getLastTasks: () => Task[],
        private getOnFilterChange: () => (() => void) | undefined,
    ) {}

    renderValueSelector(row: HTMLElement, condition: FilterCondition): void {
        if (condition.property === 'content') {
            this.renderTextInput(row, condition);
        } else if (condition.property === 'property') {
            this.renderValueDropdown(row, condition);
        } else {
            this.renderPillValueSelector(row, condition);
        }
    }

    renderTextInput(row: HTMLElement, condition: FilterCondition): void {
        const input = row.createEl('input', {
            cls: 'filter-popover__text-input',
            type: 'text',
            placeholder: t('filter.enterText'),
        });
        if (typeof condition.value === 'string') {
            input.value = condition.value;
        }
        const applyValue = () => {
            condition.value = input.value;
            this.getOnFilterChange()?.();
        };
        input.addEventListener('change', applyValue);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                applyValue();
                (e.target as HTMLElement).blur();
            }
        });
    }

    renderValueDropdown(row: HTMLElement, condition: FilterCondition): void {
        const currentValues = Array.isArray(condition.value) ? condition.value as string[] : [];
        const label = formatValueLabel(condition.property, currentValues, this.getStatusDefs());

        const btn = row.createEl('button', {
            cls: `filter-popover__dropdown${currentValues.length === 0 ? ' filter-popover__dropdown--placeholder' : ''}`,
            text: label,
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.dropdowns.showValueMenu(btn, condition);
        });
    }

    renderPillValueSelector(row: HTMLElement, condition: FilterCondition): void {
        const container = row.createDiv('filter-popover__tag-value');
        const currentValues = Array.isArray(condition.value) ? condition.value as string[] : [];
        const prop = condition.property;

        // Pill群 (only if there are selected values)
        if (currentValues.length > 0) {
            const pillContainer = container.createDiv('filter-popover__tag-pills');
            for (const val of currentValues) {
                this.renderValuePill(pillContainer, val, condition);
            }
        }

        // Input + suggest
        const inputWrap = container.createDiv('filter-popover__tag-input-wrap');
        const input = inputWrap.createEl('input', {
            cls: 'filter-popover__tag-input',
            type: 'text',
            attr: { placeholder: prop === 'tag' ? t('filter.typeTag') : t('filter.typeToFilter') },
        });

        // Suggest state
        let suggestEl: HTMLElement | null = null;
        let selectedIdx = -1;
        let suggestItems: { el: HTMLElement; value: string }[] = [];
        let outsideHandler: ((e: MouseEvent) => void) | null = null;

        const closeSuggest = () => {
            if (suggestEl) {
                suggestEl.remove();
                suggestEl = null;
            }
            suggestItems = [];
            selectedIdx = -1;
            if (outsideHandler) {
                document.removeEventListener('pointerdown', outsideHandler, true);
                outsideHandler = null;
            }
        };

        const statusDefs = this.getStatusDefs();
        const tasks = this.getLastTasks();

        const addValue = (val: string) => {
            const normalized = prop === 'tag' ? val.trim().replace(/^#/, '') : prop === 'status' ? val : val.trim();
            if (!normalized) return;
            const arr = Array.isArray(condition.value) ? condition.value as string[] : [];
            if (!arr.includes(normalized)) {
                condition.value = [...arr, normalized];
                this.getOnFilterChange()?.();
            }
            input.value = '';
            closeSuggest();
            this.renderContent();
        };

        const showSuggest = (query: string, showAll: boolean) => {
            closeSuggest();
            const available = getAvailableValues(prop, tasks);
            const selected = new Set(Array.isArray(condition.value) ? condition.value as string[] : []);
            const q = prop === 'tag' ? query.toLowerCase().replace(/^#/, '') : query.toLowerCase();

            const filtered = available.filter(v => {
                if (selected.has(v)) return false;
                if (showAll || !q) return true;
                return getValueDisplay(prop, v, statusDefs).toLowerCase().includes(q) || v.toLowerCase().includes(q);
            });
            if (filtered.length === 0) return;

            suggestEl = document.createElement('div');
            suggestEl.className = 'filter-popover__tag-suggest';
            suggestItems = [];
            selectedIdx = -1;

            for (const val of filtered) {
                const item = suggestEl.createDiv('filter-popover__tag-suggest-item');
                if (prop === 'color') {
                    const swatch = item.createSpan('filter-popover__color-swatch');
                    swatch.style.backgroundColor = val;
                } else if (prop === 'status') {
                    const checkbox = item.createEl('input', { cls: 'task-list-item-checkbox filter-popover__status-checkbox' });
                    checkbox.type = 'checkbox';
                    checkbox.checked = val !== ' ';
                    checkbox.readOnly = true;
                    checkbox.tabIndex = -1;
                    if (val !== ' ') checkbox.dataset.task = val;
                }
                item.createSpan().setText(getValueDisplay(prop, val, statusDefs));
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    addValue(val);
                });
                suggestItems.push({ el: item, value: val });
            }

            document.body.appendChild(suggestEl);

            // Position below input
            const rect = inputWrap.getBoundingClientRect();
            let x = rect.left;
            let y = rect.bottom + 2;
            const suggestRect = suggestEl.getBoundingClientRect();
            if (x + suggestRect.width > window.innerWidth) {
                x = window.innerWidth - suggestRect.width - 8;
            }
            if (y + suggestRect.height > window.innerHeight) {
                y = rect.top - suggestRect.height - 2;
            }
            suggestEl.style.left = `${Math.max(8, x)}px`;
            suggestEl.style.top = `${Math.max(8, y)}px`;
            suggestEl.style.width = `${rect.width}px`;

            outsideHandler = (e: MouseEvent) => {
                const target = e.target as Node;
                if (suggestEl?.contains(target) || inputWrap.contains(target)) return;
                closeSuggest();
            };
            setTimeout(() => {
                document.addEventListener('pointerdown', outsideHandler!, true);
            }, 0);
        };

        const updateHighlight = () => {
            for (let i = 0; i < suggestItems.length; i++) {
                suggestItems[i].el.classList.toggle('filter-popover__tag-suggest-item--active', i === selectedIdx);
            }
            if (selectedIdx >= 0 && suggestItems[selectedIdx]) {
                suggestItems[selectedIdx].el.scrollIntoView({ block: 'nearest' });
            }
        };

        // Input events
        input.addEventListener('input', () => {
            showSuggest(input.value, false);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!suggestEl) {
                    showSuggest(input.value, !input.value);
                } else if (suggestItems.length > 0) {
                    selectedIdx = (selectedIdx + 1) % suggestItems.length;
                    updateHighlight();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (suggestItems.length > 0) {
                    selectedIdx = selectedIdx <= 0 ? suggestItems.length - 1 : selectedIdx - 1;
                    updateHighlight();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedIdx >= 0 && suggestItems[selectedIdx]) {
                    addValue(suggestItems[selectedIdx].value);
                } else if (input.value.trim()) {
                    addValue(input.value);
                }
            } else if (e.key === 'Escape') {
                closeSuggest();
            } else if (e.key === 'Backspace' && !input.value && currentValues.length > 0) {
                // Remove last pill on backspace in empty input
                const last = currentValues[currentValues.length - 1];
                const arr = Array.isArray(condition.value) ? condition.value as string[] : [];
                condition.value = arr.filter(v => v !== last);
                this.getOnFilterChange()?.();
                this.renderContent();
            }
        });

        input.addEventListener('focus', () => {
            showSuggest(input.value, !input.value);
        });
    }

    renderValuePill(container: HTMLElement, value: string, condition: FilterCondition): void {
        const statusDefs = this.getStatusDefs();
        const pill = container.createDiv('filter-popover__tag-pill');
        if (condition.property === 'color') {
            const swatch = pill.createSpan('filter-popover__color-swatch');
            swatch.style.backgroundColor = value;
        } else if (condition.property === 'status') {
            const checkbox = pill.createEl('input', { cls: 'task-list-item-checkbox filter-popover__status-checkbox' });
            checkbox.type = 'checkbox';
            checkbox.checked = value !== ' ';
            checkbox.readOnly = true;
            checkbox.tabIndex = -1;
            if (value !== ' ') checkbox.dataset.task = value;
        }
        pill.createSpan().setText(getValueDisplay(condition.property, value, statusDefs));
        const removeBtn = pill.createEl('button', { cls: 'filter-popover__tag-pill-remove' });
        setIcon(removeBtn.createSpan(), 'x');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const arr = Array.isArray(condition.value) ? condition.value as string[] : [];
            condition.value = arr.filter(v => v !== value);
            this.getOnFilterChange()?.();
            this.renderContent();
        });
    }

    renderDateValueSelector(row: HTMLElement, condition: FilterCondition): void {
        const container = row.createDiv('filter-popover__date-value');

        // Initialize value if needed
        if (condition.value == null || (typeof condition.value !== 'string' && typeof condition.value !== 'object')) {
            condition.value = { preset: 'today' } as DateFilterValue;
        }

        const dateVal = condition.value as DateFilterValue;
        const isRelative = typeof dateVal === 'object' && 'preset' in dateVal;

        // Mode toggle button: "Relative" / "Absolute"
        const modeBtn = container.createEl('button', {
            cls: 'filter-popover__dropdown filter-popover__date-mode-btn',
            text: isRelative ? t('filter.relative') : t('filter.absolute'),
        });
        modeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isRelative) {
                condition.value = getToday();
            } else {
                condition.value = { preset: 'today' } as DateFilterValue;
            }
            this.refreshPopover();
        });

        if (isRelative) {
            const relVal = dateVal as { preset: RelativeDatePreset; n?: number };
            // Relative preset dropdown
            const presetBtn = container.createEl('button', {
                cls: 'filter-popover__dropdown',
                text: relVal.preset === 'nextNDays'
                    ? t('filter.relativeDate.nextNDaysValue', { n: relVal.n ?? 7 })
                    : getRelativeDateLabel(relVal.preset),
            });
            presetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showRelativeDateMenu(presetBtn, condition);
            });

            // Number input for nextNDays
            if (relVal.preset === 'nextNDays') {
                const nInput = container.createEl('input', {
                    cls: 'filter-popover__n-input',
                    type: 'number',
                });
                nInput.value = String(relVal.n ?? 7);
                nInput.min = '1';
                nInput.placeholder = 'N';
                nInput.addEventListener('change', () => {
                    const n = parseInt(nInput.value, 10);
                    if (n > 0) {
                        condition.value = { preset: 'nextNDays', n } as DateFilterValue;
                        this.getOnFilterChange()?.();
                    }
                });
            }
        } else {
            // Absolute date: native date input
            const dateInput = container.createEl('input', {
                cls: 'filter-popover__date-input',
                type: 'date',
            });
            dateInput.value = (typeof dateVal === 'string' ? dateVal : '') || getToday();
            dateInput.addEventListener('change', () => {
                condition.value = dateInput.value;
                this.getOnFilterChange()?.();
            });
        }
    }

    showRelativeDateMenu(anchorEl: HTMLElement, condition: FilterCondition): void {
        const presets: RelativeDatePreset[] = ['today', 'thisWeek', 'nextWeek', 'pastWeek', 'nextNDays', 'thisMonth', 'thisYear'];
        const dateVal = condition.value as DateFilterValue;
        const currentPreset = typeof dateVal === 'object' && 'preset' in dateVal
            ? dateVal.preset : 'today';

        const items = presets.map(p => ({
            label: getRelativeDateLabel(p),
            value: p,
            checked: currentPreset === p,
        }));

        this.dropdowns.showSelectPopover(anchorEl, items, (val) => {
            const preset = val as RelativeDatePreset;
            condition.value = preset === 'nextNDays'
                ? { preset, n: 7 } as DateFilterValue
                : { preset } as DateFilterValue;
            this.refreshPopover();
        });
    }

    renderNumberValueSelector(row: HTMLElement, condition: FilterCondition): void {
        const container = row.createDiv('filter-popover__number-value');

        if (typeof condition.value !== 'number') {
            condition.value = 1;
            condition.unit = 'hours';
        }
        const unit = condition.unit ?? 'hours';

        // Unit toggle button (Hours / Minutes)
        const unitBtn = container.createEl('button', {
            cls: 'filter-popover__dropdown filter-popover__unit-btn',
            text: unit === 'hours' ? t('filter.hours') : t('filter.minutes'),
        });
        unitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            condition.unit = unit === 'hours' ? 'minutes' : 'hours';
            this.refreshPopover();
        });

        // Number input
        const input = container.createEl('input', {
            cls: 'filter-popover__n-input',
            type: 'number',
        });
        input.value = String(condition.value);
        input.min = '0';
        input.step = unit === 'hours' ? '0.5' : '1';
        input.addEventListener('change', () => {
            const n = parseFloat(input.value);
            if (Number.isFinite(n) && n >= 0) {
                condition.value = n;
                this.getOnFilterChange()?.();
            }
        });
    }
}
