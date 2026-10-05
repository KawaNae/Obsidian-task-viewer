import { setIcon, type App } from 'obsidian';
import type {
    ContentCondition, DateCondition, LengthCondition, PeriodCondition, PropertyCondition, TagCondition, TextListCondition,
    DateFilterValue, DateRangeValue, PresetValue, SingleDateValue,
} from '../../services/filter/FilterTypes';
import {
    DEFAULT_NEXT_N_DAYS, LENGTH_RANGE, NEXT_N_DAYS_RANGE, RELATIVE_DATE_PRESETS, getRelativeDateLabel,
    isDateRange, isDateTimeText, isPresetValue, isReversedRange, takesRange,
} from '../../services/filter/FilterTypes';
import { asDate, asPreset, asRange } from '../../services/filter/FilterEdit';
import type { WindowContext } from '../../utils/DayWindow';
import type { Task, TaskViewerSettings } from '../../types';
import type { FilterDropdownMenus } from './FilterDropdownMenus';
import { getAvailableValues, getValueDisplay, type ConditionEditor } from './FilterValueHelpers';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';
import { t } from '../../i18n';
import { ValueSuggest, type ValueSuggestOptions } from '../../suggest/ValueSuggest';
import { onFormEnter } from '../../modals/form/formEnter';
import { bindField } from '../../modals/form/bindField';
import { IssueBoard, readIssue } from '../../modals/form/FormIssue';
import { FloatInput, IntInput } from '../../utils/values/NumberValues';
import { DateInput } from '../../utils/values/DateValues';
import { createPickerTextField } from '../../modals/form/PickerTextField';
import { optional, type FieldCodec } from '../../utils/values/Read';

type ListCondition = TextListCondition | TagCondition;
/** A row whose value is a date filter value. */
export type DateRowCondition = DateCondition | PeriodCondition;
/** The kinds of value the kind button picks. */
type DateKind = 'date' | 'preset' | 'range';
/** A row's date fields: its one value, or a range's two ends. */
type DateSlot = 'value' | 'from' | 'to';

/** What the menu reads of the settings: the statuses' names, and the week and the day relative values count from. */
export type FilterMenuSettings = Pick<TaskViewerSettings, 'statusDefinitions' | 'weekStartDay' | 'startHour'>;

/**
 * The value controls of one filter row. Each control reads the condition it
 * shows and hands its change to the row's editor; it never changes the
 * condition it was drawn with.
 */
export class FilterConditionRenderer {
    /** The lists under the controls drawn since the last {@link closeLists}. */
    private lists: ValueSuggest[] = [];

    constructor(
        private app: App,
        private dropdowns: FilterDropdownMenus,
        private settings: () => FilterMenuSettings,
        private getLastTasks: () => Task[],
    ) {}

    /** Close the lists the controls opened: before the controls are drawn anew, and as the menu closes. */
    closeLists(): void {
        for (const list of this.lists) list.close();
        this.lists = [];
    }

    /** A list of values under `input` (Obsidian's, as every list under a field of ours is). */
    private offer(input: HTMLInputElement, opts: ValueSuggestOptions): ValueSuggest {
        const list = new ValueSuggest(this.app, input, opts);
        this.lists.push(list);
        return list;
    }

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
        this.renderValueInput(row, {
            initialValue: edit.current().key ?? '',
            placeholder: t('filter.typePropertyKey'),
            wrapClass: 'tv-ctrl__input-wrap',
            inputClass: 'tv-ctrl__input',
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
        this.renderValueInput(row, {
            initialValue: edit.current().value ?? '',
            placeholder: t('filter.typePropertyValue'),
            wrapClass: 'filter-popover__property-value-wrap',
            inputClass: 'tv-ctrl__text-input',
            getCandidates: () => key ? FilterValueCollector.collectPropertyValuesForKey(tasks, key) : [],
            onCommit: (val) => {
                edit.update(c => ({ ...c, value: val }), 'keep');
            },
        });
    }

    /**
     * A text field of one value, its candidates in a list under it. The
     * value is committed once: by an item picked, by the form's Enter (which
     * leaves the field), or by leaving the field; a commit of the value
     * committed last does nothing, so the blur that follows an Enter or a
     * pick does not commit it again.
     */
    private renderValueInput(
        container: HTMLElement,
        opts: {
            initialValue: string;
            placeholder: string;
            wrapClass: string;
            inputClass: string;
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

        let committed = opts.initialValue;
        const commit = (value: string) => {
            if (value === committed) return;
            committed = value;
            opts.onCommit(value);
        };

        const list = this.offer(input, {
            candidates: (query) => {
                const q = query.toLowerCase();
                return opts.getCandidates().filter(v => !q || v.toLowerCase().includes(q));
            },
            pick: (value) => {
                input.value = value;
                commit(value);
            },
        });
        onFormEnter(input, () => {
            commit(input.value);
            input.blur();
        }, { takesEnter: () => list.listShown });
        input.addEventListener('blur', () => commit(input.value));
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

        // The field, its values in a list under it
        const inputWrap = container.createDiv('tv-ctrl__input-wrap');
        const input = inputWrap.createEl('input', {
            cls: 'tv-ctrl__input',
            type: 'text',
            attr: { placeholder: prop === 'tag' ? t('filter.typeTag') : t('filter.typeToFilter') },
        });

        const statusDefs = this.settings().statusDefinitions;
        const tasks = this.getLastTasks();

        const addValue = (val: string) => {
            const normalized = prop === 'tag' ? val.trim().replace(/^#/, '') : prop === 'status' ? val : val.trim();
            if (!normalized) return;
            input.value = '';
            edit.update(c => (valuesOf(c).includes(normalized) ? c : { ...c, value: [...valuesOf(c), normalized] }), 'redraw');
        };

        const list = this.offer(input, {
            candidates: (query) => {
                const available = getAvailableValues(prop, tasks);
                const selected = new Set(valuesOf(edit.current()));
                const q = prop === 'tag' ? query.trim().toLowerCase().replace(/^#/, '') : query.trim().toLowerCase();
                return available.filter(v => {
                    if (selected.has(v)) return false;
                    if (!q) return true;
                    return getValueDisplay(prop, v, statusDefs).toLowerCase().includes(q) || v.toLowerCase().includes(q);
                });
            },
            render: (val, el) => {
                // A swatch or a checkbox before the label, as the pills show them.
                const item = el.createSpan({ cls: 'tv-ctrl__suggestion' });
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
            pick: (val) => addValue(val),
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && valuesOf(edit.current()).length > 0) {
                // Remove last pill on backspace in empty input
                edit.update(c => ({ ...c, value: valuesOf(c).slice(0, -1) }), 'redraw');
            }
        });
        // An Enter with no list open adds what is typed.
        onFormEnter(input, () => {
            if (input.value.trim()) addValue(input.value);
        }, { takesEnter: () => list.listShown });
    }

    private renderValuePill(container: HTMLElement, value: string, edit: ConditionEditor<ListCondition>): void {
        const statusDefs = this.settings().statusDefinitions;
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
     * A date or period row's value, of one of three kinds the kind button
     * picks: a date, a preset, or a range (where the row takes one,
     * `takesRange`). A date is a field of the day (`DateInput`); a value
     * with a time shows its day there and the time faint beside it, and
     * keeps the time when the day changes. A row with no date chosen yet
     * (none, or `''`) shows its field empty: it constrains nothing.
     */
    renderDateValueSelector(row: HTMLElement, edit: ConditionEditor<DateRowCondition>): void {
        const container = row.createDiv('filter-popover__date-value');
        const value = edit.current().value ?? '';
        const kind: DateKind = isDateRange(value) ? 'range' : isPresetValue(value) ? 'preset' : 'date';
        const inputs: Partial<Record<DateSlot, HTMLElement>> = {};
        const issues = this.issueBoard(row, inputs);

        const kindBtn = container.createEl('button', {
            cls: 'filter-popover__dropdown filter-popover__date-kind-btn',
            text: t(`filter.dateKind.${kind}`),
        });
        kindBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showDateKindMenu(kindBtn, edit, kind);
        });

        if (isPresetValue(value)) {
            this.renderPresetValue(container, row, edit, value);
            return;
        }
        if (isDateRange(value)) {
            const box = container.createDiv('filter-popover__range');
            const end = (side: 'from' | 'to') => this.renderDateField(box, issues, inputs, side, {
                value: () => {
                    const now = edit.current().value;
                    return now !== undefined && isDateRange(now) ? now[side] : undefined;
                },
                commit: (next) => {
                    const now = edit.current().value;
                    const range: DateRangeValue = { ...(now !== undefined && isDateRange(now) ? now : {}), [side]: next };
                    if (isReversedRange(range)) {
                        issues.set('reversed', [{ at: side, tone: 'error', text: t('filter.rangeReversed') }]);
                        return false;
                    }
                    issues.set('reversed', []);
                    edit.update(c => ({ ...c, value: range }), 'keep');
                    return true;
                },
                label: side === 'from' ? t('filter.rangeFrom') : t('filter.rangeTo'),
            });
            end('from');
            box.createSpan({ cls: 'filter-popover__range-sep', text: '〜' });
            end('to');
            return;
        }
        this.renderDateField(container, issues, inputs, 'value', {
            value: () => {
                const now = edit.current().value;
                return now !== undefined && !isDateRange(now) ? now : undefined;
            },
            commit: (next) => {
                edit.update(c => ({ ...c, value: next }), 'keep');
                return true;
            },
        });
    }

    /** Turn the value to another kind (`asDate`, `asPreset`, `asRange`); a range only where the row takes one. */
    private showDateKindMenu(anchorEl: HTMLElement, edit: ConditionEditor<DateRowCondition>, current: DateKind): void {
        const { property, operator } = edit.current();
        const kinds: DateKind[] = takesRange(property, operator) ? ['date', 'preset', 'range'] : ['date', 'preset'];
        const items = kinds.map(k => ({ label: t(`filter.dateKind.${k}`), value: k, checked: k === current }));
        this.dropdowns.showSelectPopover(anchorEl, items, (val) => {
            const kind = kinds.find(k => k === val);
            if (!kind || kind === current) return;
            const now = edit.current().value ?? '';
            const ctx = this.windowContext();
            const value: DateFilterValue = kind === 'date' ? asDate(now, ctx) : kind === 'preset' ? asPreset(now) : asRange(now, ctx);
            edit.update(c => ({ ...c, value }), 'redraw');
        });
    }

    /** A preset's button, and the N of `nextNDays`. */
    private renderPresetValue(container: HTMLElement, row: HTMLElement, edit: ConditionEditor<DateRowCondition>, value: PresetValue): void {
        const presetBtn = container.createEl('button', { cls: 'filter-popover__dropdown', text: presetLabel(value) });
        presetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showRelativeDateMenu(presetBtn, edit);
        });

        // N of nextNDays: a whole number, one or more
        if (value.preset === 'nextNDays') {
            this.renderNumberField(container, row, {
                codec: IntInput.codec(NEXT_N_DAYS_RANGE),
                current: () => {
                    const now = edit.current().value;
                    return (now !== undefined && isPresetValue(now) ? now.n : undefined) ?? DEFAULT_NEXT_N_DAYS;
                },
                commit: (n) => edit.update(c => ({ ...c, value: { preset: 'nextNDays', n } }), 'keep'),
                placeholder: 'N',
                inputMode: 'numeric',
            });
        }
    }

    /**
     * A field of a day (段10's field: text, a picker, a clear button),
     * bound to the date of `value` (`bindField`). What does not read is said
     * under the row's value line and is not committed. A value with a time
     * shows the time faint beside the field and keeps it when the day
     * changes; emptying the field takes the time too. A preset (a range's
     * end) shows the field empty with the preset's name as its placeholder,
     * and stays until a day is put in.
     */
    private renderDateField(
        container: HTMLElement,
        issues: IssueBoard<DateSlot>,
        inputs: Partial<Record<DateSlot, HTMLElement>>,
        at: DateSlot,
        opts: {
            value(): SingleDateValue | undefined;
            /** Commit the end's next value; false when the menu does not take it (a reversed range). */
            commit(next: SingleDateValue): boolean;
            label?: string;
        },
    ): void {
        const slot = container.createDiv('filter-popover__date-slot');
        const codec = optional(DateInput);
        const current = (): string | undefined => {
            const v = opts.value();
            if (v === undefined || v === '' || isPresetValue(v)) return undefined;
            return isDateTimeText(v) ? v.slice(0, 10) : v;
        };
        const timeOf = (): string => {
            const v = opts.value();
            return v !== undefined && isDateTimeText(v) ? v.slice(11) : '';
        };
        const initial = opts.value();
        const placeholder = initial !== undefined && isPresetValue(initial) ? presetLabel(initial) : 'YYYY-MM-DD';

        const field = createPickerTextField(slot, 'date', placeholder, codec.show(current()), {
            onPick: () => bound.commit(),
            onClear: () => bound.commit(),
        });
        field.el.addClass('filter-popover__date-field');
        if (opts.label) field.input.setAttribute('aria-label', opts.label);
        inputs[at] = field.input;

        const time = slot.createSpan({ cls: 'filter-popover__date-time' });
        const showTime = () => {
            const text = timeOf();
            time.setText(text);
            time.toggle(text !== '');
        };
        showTime();

        const bound = bindField(field.input, {
            codec,
            current,
            commit: (day) => {
                const clock = timeOf();
                const next: SingleDateValue = day === undefined ? '' : clock ? `${day}T${clock}` : day;
                if (!opts.commit(next)) return false;
                showTime();
                return true;
            },
            issues: (issue) => issues.set(`read:${at}`, readIssue(at, issue)),
            put: (text) => field.setText(text),
        });
    }

    private showRelativeDateMenu(anchorEl: HTMLElement, edit: ConditionEditor<DateRowCondition>): void {
        const dateVal = edit.current().value;
        const currentPreset = dateVal !== undefined && isPresetValue(dateVal) ? dateVal.preset : 'today';

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

        // The length: a number, 0 or more; an empty field is no number chosen
        this.renderNumberField(container, row, {
            codec: optional(FloatInput.codec(LENGTH_RANGE)),
            current: () => edit.current().value,
            commit: (value) => edit.update(c => ({ ...c, value }), 'keep'),
            inputMode: 'decimal',
        });
    }

    /**
     * A number field of a row (`bindField`): read as typed by `codec`, and
     * what does not read said under the row's value line, the field marked;
     * a blur or the form's Enter commits once a value that reads, and one
     * that does not is kept as typed and not committed (入力の論点 E).
     */
    private renderNumberField<T>(
        container: HTMLElement,
        line: HTMLElement,
        opts: {
            codec: FieldCodec<T>;
            current(): T;
            commit(value: T): void;
            placeholder?: string;
            inputMode: 'numeric' | 'decimal';
        },
    ): void {
        const input = container.createEl('input', {
            cls: 'tv-ctrl__text-input filter-popover__number-input',
            type: 'text',
        });
        input.inputMode = opts.inputMode;
        if (opts.placeholder) input.placeholder = opts.placeholder;
        input.value = opts.codec.show(opts.current());
        const issues = this.issueBoard<'value'>(line, { value: input });
        bindField(input, {
            codec: opts.codec,
            current: opts.current,
            commit: (value) => opts.commit(value),
            issues: (issue) => issues.set('read', readIssue('value', issue)),
        });
    }

    /**
     * Where a row's fields say what is wrong: a line under the row's value
     * line, each field marked by its error. `inputs` names the fields; one
     * drawn after the board is made is put in it then.
     */
    private issueBoard<F extends string>(line: HTMLElement, inputs: Partial<Record<F, HTMLElement>>): IssueBoard<F> {
        const says = line.createDiv({ cls: 'tv-form__says filter-popover__says' });
        return new IssueBoard<F>({ field: (at) => ({ input: inputs[at] ?? null, message: says }), form: says });
    }

    /** What relative values count from: the settings' week and day, and now. */
    private windowContext(): WindowContext {
        const { weekStartDay, startHour } = this.settings();
        return { weekStartDay, startHour, now: new Date() };
    }
}

/** The name of a preset, `nextNDays` with its N. */
function presetLabel(value: PresetValue): string {
    return value.preset === 'nextNDays'
        ? t('filter.relativeDate.nextNDaysValue', { n: value.n ?? DEFAULT_NEXT_N_DAYS })
        : getRelativeDateLabel(value.preset);
}
