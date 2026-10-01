import type { FilterCondition, FilterProperty, FilterTarget } from '../../services/filter/FilterTypes';
import {
    PROPERTY_OPERATORS,
    getOperatorLabel,
    getPropertyLabel,
    PROPERTY_ICONS,
} from '../../services/filter/FilterTypes';
import { conditionOn, withOperator, withTarget } from '../../services/filter/FilterEdit';
import type { ConditionEditor } from './FilterValueHelpers';
import { t } from '../../i18n';
import type { PopoverStack } from '../sharedUI/PopoverStack';
import { type SelectItem, openSelectPopover } from '../sharedUI/PopoverSelectMenu';

export type { SelectItem };

/** The order the property menu lists the properties in. */
const MENU_PROPERTIES: readonly FilterProperty[] = [
    'file', 'tag', 'status', 'content',
    'startDate', 'endDate', 'due', 'anyDate',
    'length', 'color', 'linestyle', 'notation',
    'parent', 'children', 'property',
];

export class FilterDropdownMenus {
    constructor(private getStack: () => PopoverStack) {}

    showSelectPopover(anchorEl: HTMLElement, items: SelectItem[], onSelect: (value: string) => void): void {
        openSelectPopover(this.getStack(), anchorEl, items, onSelect, {
            emptyLabel: t('filter.noOptions'),
        });
    }

    /** Turn the row to another property: a new row on it (`conditionOn`), keeping whose value it asks about. */
    showPropertyMenu(anchorEl: HTMLElement, edit: ConditionEditor<FilterCondition>): void {
        const condition = edit.current();
        const items: SelectItem[] = MENU_PROPERTIES.map(p => ({
            label: getPropertyLabel(p),
            value: p,
            checked: condition.property === p,
            icon: PROPERTY_ICONS[p],
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            const property = MENU_PROPERTIES.find(p => p === val);
            if (!property) return;
            edit.update(c => conditionOn(property, c.target), 'redraw');
        });
    }

    showOperatorMenu(anchorEl: HTMLElement, edit: ConditionEditor<FilterCondition>): void {
        const condition = edit.current();
        const operators = PROPERTY_OPERATORS[condition.property];
        const items: SelectItem[] = operators.map(op => ({
            label: getOperatorLabel(condition.property, op),
            value: op,
            checked: condition.operator === op,
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            const operator = operators.find(op => op === val);
            if (!operator) return;
            edit.update(c => withOperator(c, operator), 'redraw');
        });
    }

    showTargetMenu(anchorEl: HTMLElement, edit: ConditionEditor<FilterCondition>): void {
        const targets: { label: string; value: FilterTarget; icon: string }[] = [
            { label: t('filter.self'), value: 'self', icon: 'user' },
            { label: t('filter.parent'), value: 'parent', icon: 'arrow-up' },
        ];
        const current = edit.current().target ?? 'self';
        const items: SelectItem[] = targets.map(tgt => ({
            label: tgt.label,
            value: tgt.value,
            checked: current === tgt.value,
            icon: tgt.icon,
        }));

        this.showSelectPopover(anchorEl, items, (val) => {
            const target = targets.find(tgt => tgt.value === val)?.value;
            if (!target) return;
            edit.update(c => withTarget(c, target), 'redraw');
        });
    }
}
