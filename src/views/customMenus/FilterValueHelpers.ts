import type { StatusDefinition, Task } from '../../types';
import type { FilterProperty, FilterOperator } from '../../services/filter/FilterTypes';
import { getStatusLabel } from '../../constants/statusOptions';
import { FilterValueCollector } from '../../services/filter/FilterValueCollector';
import { TASK_KIND_VALUES } from '../../services/filter/parserTaxonomy';
import { t } from '../../i18n';

export function getToday(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function resolveGlue(slot: string, property: FilterProperty, operator: FilterOperator): string {
    const glue = t(`filter.glue.${slot}.${property}.${operator}`);
    if (!glue.startsWith(`filter.glue.${slot}.`)) return glue;
    return '';
}

export function formatValueLabel(property: FilterProperty, values: string[], statusDefs: StatusDefinition[]): string {
    if (values.length === 0) return t('filter.select');
    if (values.length === 1) {
        const v = values[0];
        if (property === 'file') return v.split('/').pop() || v;
        if (property === 'tag') return `#${v}`;
        if (property === 'status') return getStatusLabelForChar(v, statusDefs);
        if (property === 'kind') { const key = `filter.kind.${v}`; return t(key) !== key ? t(key) : v; }
        if (property === 'notation') { const key = `filter.notation.${v}`; return t(key) !== key ? t(key) : v; }
        return v;
    }
    return t('filter.nSelected', { n: values.length });
}

export function getValueDisplay(property: FilterProperty, value: string, statusDefs: StatusDefinition[]): string {
    if (property === 'file') return value.split('/').pop() || value;
    if (property === 'tag') return `#${value}`;
    if (property === 'status') {
        return getStatusLabelForChar(value, statusDefs);
    }
    if (property === 'kind') {
        const key = `filter.kind.${value}`; return t(key) !== key ? t(key) : value;
    }
    if (property === 'notation') {
        const key = `filter.notation.${value}`; return t(key) !== key ? t(key) : value;
    }
    return value;
}

export function getStatusLabelForChar(statusChar: string, statusDefs: StatusDefinition[]): string {
    return getStatusLabel(statusChar, statusDefs);
}

export function getAvailableValues(property: FilterProperty, tasks: Task[]): string[] {
    switch (property) {
        case 'file': return FilterValueCollector.collectFiles(tasks);
        case 'tag': return FilterValueCollector.collectTags(tasks);
        case 'status': return FilterValueCollector.collectStatuses(tasks);
        case 'color': return FilterValueCollector.collectColors(tasks);
        case 'linestyle': return FilterValueCollector.collectLineStyles(tasks);
        case 'kind': return [...TASK_KIND_VALUES];
        case 'notation': return FilterValueCollector.collectNotations(tasks);
        case 'property': return FilterValueCollector.collectPropertyKeys(tasks);
        default: return [];
    }
}

export function getPropertyValuesForKey(tasks: Task[], key: string): string[] {
    return FilterValueCollector.collectPropertyValuesForKey(tasks, key);
}
