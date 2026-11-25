import type { App } from 'obsidian';
import type { DestinationAsk } from '../../services/data/NotePlaces';
import type { FieldFocus } from '../../utils/FieldFocus';
import { IssueBoard } from '../form/FormIssue';
import { DestinationField } from '../noteops/DestinationField';
import type { HubPlace } from '../hub/HubHost';
import { PlaceFields, type PlaceField, type PlaceFieldsHost, type PlaceSurface, type PlaceViewState } from './PlaceFields';

/** The fields in the order they stand. */
const PLACE_FIELDS: readonly PlaceField[] = ['note', 'heading'];

/** What the place's fields open with, and whom they tell. */
export interface PlacePaneOptions {
    /** The fields as they open: the note, and the heading (empty for the note's end). */
    initial: DestinationAsk;
    /** Whom the fields tell what they name (the hub's host), and who reads it. */
    host: PlaceFieldsHost;
}

/**
 * The place's fields of a hub on a task not written yet, as they look: a
 * group of the form's basic tab (`tv-form__group`, after the dates) holding
 * the note and the heading (`DestinationField`, the send dialog's fields),
 * and what is wrong of each said under it (`IssueBoard`). It draws what the
 * fields' logic says (`PlaceViewState`) and does nothing of its own; the
 * logic is `PlaceFields`. It is built of the form's shared pieces
 * (`_form.css`), as the form's other groups are; the title and the buttons
 * are the hub's.
 *
 * Where its focus goes is the first field an error is said under, the
 * note's and then the heading's, else the note's: the field to mend first.
 * The caret goes after its text, a note's name and a heading having no
 * fixed shape and being mended as often as replaced. Its fields are shut
 * with the form's while a create is under way.
 */
export class PlacePane implements HubPlace, PlaceSurface {
    private readonly field: DestinationField;
    private readonly issues: IssueBoard<PlaceField>;
    private readonly fields: PlaceFields;

    /** Build the group at the end of `parent`, among the form's groups. */
    constructor(app: App, parent: HTMLElement, opts: PlacePaneOptions) {
        const group = parent.createDiv({ cls: 'tv-form__group task-hub__place' });
        this.field = new DestinationField(app, group, {
            initial: opts.initial,
            onChange: () => this.fields.fieldsChanged(this.field.ask()),
            onEnter: () => { /* what the fields name is told as it is typed */ },
        });
        // Every issue is of a field, said under its row; the group stands for any with no row.
        this.issues = new IssueBoard<PlaceField>({ field: (at) => this.field.slot(at), form: group });

        // What the fields show as they open, not the options they were built
        // from: the logic asks of what the user sees, by construction.
        this.fields = new PlaceFields(this.field.ask(), opts.host, this);
    }

    focus(): FieldFocus<HTMLElement> {
        const wrong = PLACE_FIELDS.find(at => this.issues.has('error', at));
        return this.field.focus(wrong ?? 'note');
    }

    setEnabled(enabled: boolean): void {
        this.field.setEnabled(enabled);
    }

    /** Nothing to draw again: its fields hold what the user typed, and the host follows them, not they the host. */
    refresh(): void { }

    dispose(): void {
        this.fields.dispose();
    }

    render(state: PlaceViewState): void {
        this.field.offerHeadings(state.headings);
        this.issues.set('place', state.issues);
    }
}
