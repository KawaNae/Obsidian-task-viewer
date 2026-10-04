import { setIcon } from 'obsidian';
import type {
    ContentCondition, DateCondition, LengthCondition, PropertyCondition, TagCondition, TextListCondition,
    DateFilterValue,
} from '../../services/filter/FilterTypes';
import {
    DEFAULT_NEXT_N_DAYS, RELATIVE_DATE_PRESETS, getRelativeDateLabel,
} from '../../services/filter/FilterTypes';
import type { StatusDefinition, Task } from '../../types';
import type { FilterDropdownMenus } from './FilterDropdownMenus';
import { getAvailableValues, getValueDisplay, type ConditionEditor } from './FilterValueHelpers';
import { DateUtils } from '../../utils/DateUtils';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';
import { t } from '../../i18n';
import type { PopoverStack } from '../sharedUI/PopoverStack';
import { SuggestController } from './SuggestController';
import { onFormEnter } from '../../modals/form/formEnter';

type ListCondition = TextListCondition | TagCondition;

/**
 * The value controls of one filter row. Each control reads the condition it
 * shows and hands its change to the row's editor; it never changes the
 * condition it was drawn with.
 */
export class FilterConditionRenderer {
    constructor(
        private dropdowns: FilterDropdownMenus,
        private getStatusDefs: () => StatusDefinition[],
        private getLastTasks: () => Task[],
        private getStack: () => PopoverStack,
    ) {}

    renderTextInput(row: HTMLElement, edit: ConditionEditor<ContentCondition>): void {
        const input = row.createEl('input', {
            cls: 'tv-ctrl__text-input',
            type: 'text',
            placeholder: t('filter.enterText'),
        });
        input.value = edit.current().value ?? '';
        const applyValue = () => {
            edit.update(c => ({ ...c, value: input.value }), 'keep');
        };
        input.addEventListener('change', applyValue);
        onFormEnter(input, () => {
            applyValue();
            input.blur();
        });
    }

    /**
     * Render the labeled grid for property filter (always 2 sub-rows):
     *   キー：[keyinput]
     *   値：[valueinput]
     * Labels share a grid column so colons align across rows. Value row is shown
     * even for isSet/isNotSet (engine ignores it) so layout stays stable.
     */
    renderPropertyRows(row: HTMLElement, edit: ConditionEditor<PropertyCondition>): void {
        const grid = row.createDiv('filter-popover__row-value filter-popover__property-grid');

        grid.createEl('span', {
            cls: 'filter-popover__property-label',
            text: t('filter.propertyKeyLabel'),
        });
        this.renderPropertyKeyInput(grid, edit);

        grid.createEl('span', {
            cls: 'filter-popover__property-label',
            text: t('filter.propertyValueLabel'),
        });
        this.renderPropertyValueInput(grid, edit);
    }

    private renderPropertyKeyInput(row: HTMLElement, edit: ConditionEditor<PropertyCondition>): void {
        const tasks = this.getLastTasks();
        this.renderSuggestInput(row, {
            initialValue: edit.current().key ?? '',
            placeholder: t('filter.typePropertyKey'),
            wrapClass: 'tv-ctrl__input-wrap',
            inputClass: 'tv-ctrl__input',
            suggestClass: 'filter-popover__property-key-suggest',
            getCandidates: () => FilterValueCollector.collectPropertyKeys(tasks),
            onCommit: (val) => {
                // Another key's values are not this one's: the value starts over.
                edit.update(c => ((c.key ?? '') === val ? c : { ...c, key: val, value: '' }), 'redraw');
            },
        });
    }

    private renderPropertyValueInput(row: HTMLElement, edit: ConditionEditor<PropertyCondition>): void {
        const tasks = this.getLastTasks();
        const key = edit.current().key ?? '';
        this.renderSuggestInput(row, {
            initialValue: edit.current().value ?? '',
            placeholder: t('filter.typePropertyValue'),
            wrapClass: 'filter-popover__property-value-wrap',
            inputClass: 'tv-ctrl__text-input',
            suggestClass: 'filter-popover__property-value-suggest',
            getCandidates: () => key ? FilterValueCollector.collectPropertyValuesForKey(tasks, key) : [],
            onCommit: (val) => {
                edit.update(c => ({ ...c, value: val }), 'keep');
            },
        });
    }

    private renderSuggestInput(
        container: HTMLElement,
        opts: {
            initialValue: string;
            placeholder: string;
            wrapClass: string;
            inputClass: string;
            suggestClass: string;
            getCandidates: () => string[];
            onCommit: (value: string) => void;
        },
    ): void {
        const inputWrap = container.createDiv(opts.wrapClass);
        const input = inputWrap.createEl('input', {
            cls: opts.inputClass,
            type: 'text',
            attr: { placeholder: opts.placeholder },
        });
        input.value = opts.initialValue;

        const suggest = new SuggestController(this.getStack(), inputWrap, opts.suggestClass, 'min');

        const showSuggest = (query: string, showAll: boolean) => {
            const q = query.toLowerCase();
            const filtered = opts.getCandidates().filter(v => {
                if (showAll || !q) return true;
                return v.toLowerCase().includes(q);
            });
            suggest.show(
                filtered,
                (item, val) => { item.createSpan().setText(val); },
                (val) => {
                    input.value = val;
                    suggest.close();
                    opts.onCommit(val);
                },
            );
        };

        input.addEventListener('input', () => {
            showSuggest(input.value, false);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!suggest.isOpen) showSuggest(input.value, !input.value);
                else suggest.moveHighlight(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                suggest.moveHighlight(-1);
            } else if (e.key === 'Escape') {
                suggest.close();
            }
        });
        onFormEnter(input, () => {
            const picked = suggest.highlightedValue ?? input.value;
            input.value = picked;
            suggest.close();
            opts.onCommit(picked);
            input.blur();
        });
        input.addEventListener('focus', () => {
            showSuggest(input.value, !input.value);
        });
        input.addEventListener('change', () => {
            opts.onCommit(input.value);
        });
    }

    renderPillValueSelector(row: HTMLElement, edit: ConditionEditor<ListCondition>): void {
        const container = row.createDiv('filter-popover__tag-value');
        const prop = edit.current().property;
        const valuesOf = (c: ListCondition): readonly string[] => c.value ?? [];
        const currentValues = valuesOf(edit.current());

        // Pill群 (only if there are selected values)
        if (currentValues.length > 0) {
            const pillContainer = container.createDiv('tv-ctrl__pills');
            for (const val of currentValues) {
                this.renderValuePill(pillContainer, val, edit);
            }
        }

        // Input + suggest
        const inputWrap = container.createDiv('tv-ctrl__input-wrap');
        const input = inputWrap.createEl('input', {
            cls: 'tv-ctrl__input',
            type: 'text',
            attr: { placeholder: prop === 'tag' ? t('filter.typeTag') : t('filter.typeToFilter') },
        });

        // Suggest state
        const suggest = new SuggestController(this.getStack(), inputWrap, '', 'exact');

        const statusDefs = this.getStatusDefs();
        const tasks = this.getLastTasks();

        const addValue = (val: string) => {
            const normalized = prop === 'tag' ? val.trim().replace(/^#/, '') : prop === 'status' ? val : val.trim();
            if (!normalized) return;
            input.value = '';
            suggest.close();
            edit.update(c => (valuesOf(c).includes(normalized) ? c : { ...c, value: [...valuesOf(c), normalized] }), 'redraw');
        };

        const showSuggest = (query: string, showAll: boolean) => {
            const available = getAvailableValues(prop, tasks);
            const selected = new Set(valuesOf(edit.current()));
            const q = prop === 'tag' ? query.toLowerCase().replace(/^#/, '') : query.toLowerCase();

            const filtered = available.filter(v => {
                if (selected.has(v)) return false;
                if (showAll || !q) return true;
                return getValueDisplay(prop, v, statusDefs).toLowerCase().includes(q) || v.toLowerCase().includes(q);
            });

            suggest.show(
                filtered,
                (item, val) => {
                    if (prop === 'color') {
                        const swatch = item.createSpan('tv-ctrl__color-swatch');
                        swatch.style.backgroundColor = val;
                    } else if (prop === 'status') {
                        const checkbox = item.createEl('input', { cls: 'task-list-item-checkbox tv-ctrl__status-checkbox' });
                        checkbox.type = 'checkbox';
                        checkbox.checked = val !== ' ';
                        checkbox.readOnly = true;
                        checkbox.tabIndex = -1;
                        if (val !== ' ') checkbox.dataset.task = val;
                    }
                    item.createSpan().setText(getValueDisplay(prop, val, statusDefs));
                },
                (val) => addValue(val),
            );
        };

        // Input events
        input.addEventListener('input', () => {
            showSuggest(input.value, false);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!suggest.isOpen) showSuggest(input.value, !input.value);
                else suggest.moveHighlight(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                suggest.moveHighlight(-1);
            } else if (e.key === 'Escape') {
                suggest.close();
            } else if (e.key === 'Backspace' && !input.value && valuesOf(edit.current()).length > 0) {
                // Remove last pill on backspace in empty input
                edit.update(c => ({ ...c, value: valuesOf(c).slice(0, -1) }), 'redraw');
            }
        });
        onFormEnter(input, () => {
            const hl = suggest.highlightedValue;
            if (hl !== null) {
                addValue(hl);
            } else if (input.value.trim()) {
                addValue(input.value);
            }
        });

        input.addEventListener('focus', () => {
            showSuggest(input.value, !input.value);
        });
    }

    private renderValuePill(container: HTMLElement, value: string, edit: ConditionEditor<ListCondition>): void {
        const statusDefs = this.getStatusDefs();
        const property = edit.current().property;
        const pill = container.createDiv('tv-ctrl__pill');
        if (property === 'color') {
            const swatch = pill.createSpan('tv-ctrl__color-swatch');
            swatch.style.backgroundColor = value;
        } else if (property === 'status') {
            const checkbox = pill.createEl('input', { cls: 'task-list-item-checkbox tv-ctrl__status-checkbox' });
            checkbox.type = 'checkbox';
            checkbox.checked = value !== ' ';
            checkbox.readOnly = true;
            checkbox.tabIndex = -1;
            if (value !== ' ') checkbox.dataset.task = value;
        }
        pill.createSpan().setText(getValueDisplay(property, value, statusDefs));
        const removeBtn = pill.createEl('button', { cls: 'tv-icon-btn tv-ctrl__pill-remove' });
        setIcon(removeBtn.createSpan(), 'x');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            edit.update(c => ({ ...c, value: (c.value ?? []).filter(v => v !== value) }), 'redraw');
        });
    }

    /**
     * A date row's value: a preset, or a day. A row with no day chosen yet
     * (none, or `''`) shows the day input empty: it constrains nothing.
     */
    renderDateValueSelector(row: HTMLElement, edit: ConditionEditor<DateCondition>): void {
        const container = row.createDiv('filter-popover__date-value');
        const dateVal = edit.current().value;
        const relVal = typeof dateVal === 'object' ? dateVal : null;

        // Mode toggle button: "Relative" / "Absolute"
        const modeBtn = container.createEl('button', {
            cls: 'filter-popover__dropdown filter-popover__date-mode-btn',
            text: relVal ? t('filter.relative') : t('filter.absolute'),
        });
        modeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const value: DateFilterValue = relVal ? DateUtils.getToday() : { preset: 'today' };
            edit.update(c => ({ ...c, value }), 'redraw');
        });

        if (relVal) {
            // Relative preset dropdown
            const presetBtn = container.createEl('button', {
                cls: 'filter-popover__dropdown',
                text: relVal.preset === 'nextNDays'
                    ? t('filter.relativeDate.nextNDaysValue', { n: relVal.n ?? DEFAULT_NEXT_N_DAYS })
                    : getRelativeDateLabel(relVal.preset),
            });
            presetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showRelativeDateMenu(presetBtn, edit);
            });

            // Number input for nextNDays
            if (relVal.preset === 'nextNDays') {
                const nInput = container.createEl('input', {
                    cls: 'tv-ctrl__text-input',
                    type: 'number',
                });
                nInput.style.width = '52px';
                nInput.value = String(relVal.n ?? DEFAULT_NEXT_N_DAYS);
                nInput.min = '1';
                nInput.placeholder = 'N';
                nInput.addEventListener('change', () => {
                    const n = parseInt(nInput.value, 10);
                    if (n > 0) edit.update(c => ({ ...c, value: { preset: 'nextNDays', n } }), 'keep');
                });
            }
        } else {
            // Absolute date: native date input
            const dateInput = container.createEl('input', {
                cls: 'tv-ctrl__text-input filter-popover__date-input',
                type: 'date',
            });
            dateInput.value = typeof dateVal === 'string' ? dateVal : '';
            dateInput.addEventListener('change', () => {
                edit.update(c => ({ ...c, value: dateInput.value }), 'keep');
            });
        }
    }

    private showRelativeDateMenu(anchorEl: HTMLElement, edit: ConditionEditor<DateCondition>): void {
        const dateVal = edit.current().value;
        const currentPreset = typeof dateVal === 'object' ? dateVal.preset : 'today';

        const items = RELATIVE_DATE_PRESETS.map(p => ({
            label: getRelativeDateLabel(p),
            value: p,
            checked: currentPreset === p,
        }));

        this.dropdowns.showSelectPopover(anchorEl, items, (val) => {
            const preset = RELATIVE_DATE_PRESETS.find(p => p === val);
            if (!preset) return;
            const value: DateFilterValue = preset === 'nextNDays' ? { preset, n: DEFAULT_NEXT_N_DAYS } : { preset };
            edit.update(c => ({ ...c, value }), 'redraw');
        });
    }

    /** A length row's value and unit. A row with no number chosen yet shows the input empty. */
    renderNumberValueSelector(row: HTMLElement, edit: ConditionEditor<LengthCondition>): void {
        const container = row.createDiv('filter-popover__number-value');
        const condition = edit.current();
        const unit = condition.unit ?? 'hours';

        // Unit toggle button (Hours / Minutes)
        const unitBtn = container.createEl('button', {
            cls: 'filter-popover__dropdown filter-popover__unit-btn',
            text: unit === 'hours' ? t('filter.hours') : t('filter.minutes'),
        });
        unitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            edit.update(c => ({ ...c, unit: (c.unit ?? 'hours') === 'hours' ? 'minutes' : 'hours' }), 'redraw');
        });

        // Number input
        const input = container.createEl('input', {
            cls: 'tv-ctrl__text-input',
            type: 'number',
        });
        input.style.width = '52px';
        input.value = condition.value === undefined ? '' : String(condition.value);
        input.min = '0';
        input.step = unit === 'hours' ? '0.5' : '1';
        input.addEventListener('change', () => {
            const n = parseFloat(input.value);
            if (Number.isFinite(n) && n >= 0) edit.update(c => ({ ...c, value: n }), 'keep');
        });
    }
}
