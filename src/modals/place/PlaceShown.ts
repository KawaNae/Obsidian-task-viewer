import { t } from '../../i18n';
import { createFormLabel } from '../form/formRow';
import type { HubPlace } from '../hub/HubHost';

/** Where a task whose place cannot be changed goes: the note's path, the heading it stands under (null above the note's first heading), and the parent task's text. */
export interface ShownPlace {
    note: string;
    heading: string | null;
    parent: string;
}

/**
 * Where the task of a hub whose place cannot be changed goes, as a group of
 * the form's basic tab (after the dates): the note, the heading and the
 * parent task, each a form row with no field, labelled as the place
 * fields' rows are (`DestinationField`), and why the place cannot be
 * changed under them, the group's last. It shows what `read` gives, as it is built
 * and each time it is refreshed, and knows nothing of which hub it is in
 * nor when the value changes. While `read` gives nothing (the place not read
 * yet, the parent gone, the read failed) the rows stay with no values, so
 * the group keeps its height. A value is shown whole, wrapped where it is
 * long: nothing else in the hub says the note's path.
 */
export class PlaceShown implements HubPlace {
    private readonly note: HTMLElement;
    private readonly heading: HTMLElement;
    private readonly parent: HTMLElement;

    /** Build the group at the end of `parent`, among the form's groups. */
    constructor(parent: HTMLElement, private readonly read: () => ShownPlace | null) {
        const group = parent.createDiv({ cls: 'tv-form__group task-hub__place task-hub__shown' });
        this.note = shownRow(group, t('modal.note'), 'file-text');
        this.heading = shownRow(group, t('modal.heading'), 'heading');
        this.parent = shownRow(group, t('modal.parentTask'), 'arrow-up');
        group.createDiv({ cls: 'tv-form__says' }).createDiv({ cls: 'tv-form__info', text: t('modal.newTask.childFixed') });
        this.refresh();
    }

    focus(): null {
        return null;
    }

    /** It has no field to shut. */
    setEnabled(_enabled: boolean): void { }

    refresh(): void {
        const place = this.read();
        this.note.setText(place?.note ?? '');
        this.heading.setText(place ? place.heading ?? t('modal.newTask.noHeading') : '');
        this.parent.setText(place?.parent ?? '');
    }

    dispose(): void { }
}

/** A form row of `label` with no field: where its value is shown. */
function shownRow(group: HTMLElement, label: string, icon: string): HTMLElement {
    const row = group.createDiv({ cls: 'tv-form__row' });
    createFormLabel(row, label, icon);
    return row.createSpan({ cls: 'task-hub__shown-value' });
}
