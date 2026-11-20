import { t } from '../../../i18n';
import { addStatusItems, getStatusLabel } from '../../../constants/statusOptions';
import { PROPERTY_ICONS } from '../../../constants/propertyIcons';
import { createFormRow } from '../../form/formRow';
import { onFormEnter } from '../../form/formEnter';
import { TaskUpdateBuilder } from '../../form/TaskUpdateBuilder';
import type { FieldGroupContext } from './FieldGroupContext';

/**
 * The row's status: a button showing it as a checkbox preview and its label.
 * A click, Space, the form's Enter or the down arrow opens the card menu's
 * statuses (Obsidian's Menu) under it, the row's checked; the menu takes the
 * keys while it is open. The one picked is written, and shown at once.
 * Nothing it holds is left to save on a close.
 */
export class StatusField {
    private readonly pill: HTMLButtonElement;

    constructor(container: HTMLElement, private ctx: FieldGroupContext) {
        const { row } = createFormRow(container, t('modal.hub.status'), { icon: PROPERTY_ICONS.status });
        this.pill = row.createEl('button', {
            cls: 'tv-ctrl__pill task-hub__status-pill',
            attr: { type: 'button' },
        });
        this.render();

        this.pill.addEventListener('click', () => this.openMenu());
        this.pill.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key !== 'ArrowDown') return;
            e.preventDefault();
            this.openMenu();
        });
        onFormEnter(this.pill, () => this.openMenu());
    }

    private openMenu(): void {
        if (this.ctx.isShut()) return;
        this.ctx.plugin.menuPresenter.present(
            (menu) => addStatusItems(menu, this.ctx.plugin.settings.statusDefinitions, this.ctx.getTask().statusChar, (char) => this.commit(char)),
            { kind: 'belowRect', rect: this.pill.getBoundingClientRect() },
        );
    }

    private commit(char: string): void {
        if (this.ctx.isShut()) return;
        void this.ctx.queue(TaskUpdateBuilder.status(this.ctx.getTask(), char));
        // The model holds the status picked once queued: the button shows it with no echo waited for.
        this.render();
    }

    /** The checkbox preview of the status (as the filter popover's pill) and its label. */
    private render(): void {
        const char = this.ctx.getTask().statusChar;
        this.pill.empty();
        const checkbox = this.pill.createEl('input', { cls: 'task-list-item-checkbox tv-ctrl__status-checkbox' });
        checkbox.type = 'checkbox';
        checkbox.checked = char !== ' ';
        checkbox.readOnly = true;
        checkbox.tabIndex = -1;
        if (char !== ' ') checkbox.dataset.task = char;
        this.pill.createSpan().setText(getStatusLabel(char, this.ctx.plugin.settings.statusDefinitions));
    }

    /** The row's status from outside. */
    refresh(): void {
        this.render();
    }

    setEnabled(enabled: boolean): void {
        this.pill.disabled = !enabled;
        this.pill.toggleClass('is-disabled', !enabled);
    }

    fieldElement(): HTMLButtonElement {
        return this.pill;
    }
}
