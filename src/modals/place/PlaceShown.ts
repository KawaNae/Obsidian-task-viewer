import { t } from '../../i18n';
import { createFormLabel } from '../form/formRow';
import type { HubPlace } from '../hub/HubHost';

/**
 * Where a task stands, or goes, as a place shown with no field says it: the
 * note's path, the heading it stands under (null above the note's first
 * heading, absent while not read), and the parent task's text (null for a
 * task with no parent).
 */
export interface ShownPlace {
    note: string;
    heading?: string | null;
    parent: string | null;
}

/** What a place shown with no field says besides the place: why it cannot be changed, under the rows; none, nothing. */
export interface PlaceShownOptions {
    why?: string;
}

/**
 * Where a task stands, or goes, as a group of the form's basic tab (after
 * the dates): the note, the heading and the parent task, each a form row
 * with no field, labelled as the place fields' rows are
 * (`DestinationField`), and, where the hub says it (`PlaceShownOptions.why`),
 * why the place cannot be changed under them, the group's last. It shows
 * what `read` gives, as it is built and each time it is refreshed, and knows
 * nothing of which hub it is in nor when the value changes.
 *
 * The parent's row is there while the value names a parent, and not for a
 * task with none. While `read` gives nothing (the place not read yet, the
 * row or the parent gone, the read failed) the rows stay as they were with
 * no values, so the group keeps its height; a heading not read yet is shown
 * so too. A value is shown whole, wrapped where it is long: nothing else in
 * the hub says the note's path.
 */
export class PlaceShown implements HubPlace {
    private readonly note: HTMLElement;
    private readonly heading: HTMLElement;
    private readonly parent: ShownRow;

    /** Build the group at the end of `parent`, among the form's groups. */
    constructor(parent: HTMLElement, private readonly read: () => ShownPlace | null, options: PlaceShownOptions = {}) {
        const group = parent.createDiv({ cls: 'tv-form__group task-hub__place task-hub__shown' });
        this.note = shownRow(group, t('modal.note'), 'file-text').value;
        this.heading = shownRow(group, t('modal.heading'), 'heading').value;
        this.parent = shownRow(group, t('modal.parentTask'), 'arrow-up');
        if (options.why !== undefined) group.createDiv({ cls: 'tv-form__says' }).createDiv({ cls: 'tv-form__info', text: options.why });
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
        this.heading.setText(place?.heading === undefined ? '' : place.heading ?? t('modal.newTask.noHeading'));
        this.parent.value.setText(place?.parent ?? '');
        if (place) this.parent.row.toggle(place.parent !== null);
    }

    dispose(): void { }
}

/** A form row with no field, and where its value is shown. */
interface ShownRow {
    row: HTMLElement;
    value: HTMLElement;
}

/** A form row of `label` with no field. */
function shownRow(group: HTMLElement, label: string, icon: string): ShownRow {
    const row = group.createDiv({ cls: 'tv-form__row' });
    createFormLabel(row, label, icon);
    return { row, value: row.createSpan({ cls: 'task-hub__shown-value' }) };
}
