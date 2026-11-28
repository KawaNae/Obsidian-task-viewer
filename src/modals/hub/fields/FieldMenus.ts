import { t } from '../../../i18n';
import type { CascadeSourceKind } from '../CascadeSource';
import type { FieldMenuHead, FieldMenuItem } from '../../form/FieldMenuButton';
import type { DropName, FieldAction, FieldMenuHeadModel } from './FieldState';

/**
 * How a field's menu (`FieldStates.menu`) is drawn: the title and the icon
 * of each line. The names of taking the field's own line out are one entry
 * each, so that a name is changed here alone.
 */
export const FieldMenus = {
    /**
     * The greyed lines at the head of the menu (`FieldStates.menu`): where
     * the inherited value is written, the value (cut to one line), and,
     * where the field's own line overrides it, that it does. None where
     * nothing is inherited.
     */
    heads(head: FieldMenuHeadModel | null): FieldMenuHead[] {
        if (head === null) return [];
        const [title, icon] = SOURCE_LINES[head.source];
        const value = head.inherited.kind === 'value' ? cut(head.inherited.text) : t('modal.hub.noValue');
        const lines: FieldMenuHead[] = [
            { title: t(title), icon },
            { title: t('modal.hub.inheritedValue', { value }), icon: 'corner-down-right' },
        ];
        if (head.overridden) lines.push({ title: t('modal.hub.inheritedOverridden'), icon: 'pencil' });
        return lines;
    },

    /** An item, which runs `run`: greyed, taking no press, for a line the hub has none of to open. */
    item(action: FieldAction, run: () => void): FieldMenuItem {
        const [title, icon] = action.action === 'dropOwn' ? DROP_LINES[action.name] : ACTION_LINES[action.action];
        const disabled = action.action === 'openSource' && action.disabled;
        return { title: t(title), icon, run: disabled ? null : run, keepsTyped: action.action === 'openSource' };
    },
};

/** How many characters of an inherited value the menu's line shows: past it, the value is cut and ends in "…". */
export const HEAD_VALUE_LENGTH = 24;

function cut(text: string): string {
    const chars = [...text];
    return chars.length > HEAD_VALUE_LENGTH ? `${chars.slice(0, HEAD_VALUE_LENGTH).join('')}…` : text;
}

const SOURCE_LINES: Record<CascadeSourceKind, readonly [title: string, icon: string]> = {
    section: ['modal.hub.fromSection', 'heading'],
    file: ['modal.hub.fromFile', 'file-text'],
};

const ACTION_LINES: Record<Exclude<FieldAction['action'], 'dropOwn'>, readonly [title: string, icon: string]> = {
    openSource: ['modal.hub.openInheritedLine', 'external-link'],
    noValue: ['modal.hub.setNoValue', 'ban'],
    writeInherited: ['modal.hub.writeInherited', 'copy'],
};

const DROP_LINES: Record<DropName, readonly [title: string, icon: string]> = {
    clearValue: ['modal.hub.clearValue', 'eraser'],
    clearToInherited: ['modal.hub.clearToInherited', 'undo-2'],
    followInherited: ['modal.hub.followInherited', 'undo-2'],
    deleteKey: ['modal.hub.deleteKey', 'trash'],
};
