import type { StatusDefinition, Task } from '../../types';
import type { FilterProperty, FilterOperator, FilterCondition } from '../../services/filter/FilterTypes';
import { getStatusLabel } from '../../constants/statusOptions';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';
import { t } from '../../i18n';

export function resolveGlue(slot: string, property: FilterProperty, operator: FilterOperator): string {
    const glue = t(`filter.glue.${slot}.${property}.${operator}`);
    if (!glue.startsWith(`filter.glue.${slot}.`)) return glue;
    return '';
}

export function getValueDisplay(property: FilterProperty, value: string, statusDefs: StatusDefinition[]): string {
    if (property === 'file') return value.split('/').pop() || value;
    if (property === 'tag') return `#${value}`;
    if (property === 'status') {
        return getStatusLabel(value, statusDefs);
    }
    if (property === 'notation') {
        const key = `filter.notation.${value}`; return t(key) !== key ? t(key) : value;
    }
    return value;
}

export function getAvailableValues(property: FilterProperty, tasks: Task[]): string[] {
    switch (property) {
        case 'file': return FilterValueCollector.collectFiles(tasks);
        case 'tag': return FilterValueCollector.collectTags(tasks);
        case 'status': return FilterValueCollector.collectStatuses(tasks);
        case 'color': return FilterValueCollector.collectColors(tasks);
        case 'linestyle': return FilterValueCollector.collectLineStyles(tasks);
        case 'notation': return FilterValueCollector.collectNotations(tasks);
        case 'property': return FilterValueCollector.collectPropertyKeys(tasks);
        default: return [];
    }
}

/**
 * How a row's controls change its condition. The menu holds the filter;
 * `update` hands it the next condition, made from the one the menu holds
 * now — not the one the row was drawn with, since a control that keeps its
 * focus does not redraw the row.
 *
 * `redraw` draws the menu again after the change (a control whose look
 * depends on the value: a pill added, the date mode turned); `keep` leaves
 * the controls as they are (a text typed in place).
 */
export interface ConditionEditor<C extends FilterCondition> {
    current(): C;
    update(edit: (condition: C) => FilterCondition, after: 'redraw' | 'keep'): void;
}
