import type { App } from 'obsidian';
import type { DestinationAsk } from '../../services/data/NotePlaces';
import type { FieldFocus } from '../../utils/FieldFocus';
import { IssueBoard } from '../form/FormIssue';
import { DestinationField } from '../noteops/DestinationField';
import type { HubPane } from '../hub/TaskHubPanel';
import { PlaceFields, type PlaceField, type PlaceFieldsHost, type PlaceSurface, type PlaceViewState } from './PlaceFields';

/** What the place tab's pane opens with, and whom it tells. */
export interface PlacePaneOptions {
    /** The fields as they open: the note, and the heading (empty for the note's end). */
    initial: DestinationAsk;
    /** Whom the fields tell what they name (the hub's host), and who reads it. */
    host: PlaceFieldsHost;
}

/**
 * The place tab's pane of a hub on a task not written yet, as it looks: the
 * note and the heading (`DestinationField`, the send dialog's fields), and
 * what is wrong of each said under it (`IssueBoard`). It draws what the
 * fields' logic says (`PlaceViewState`) and does nothing of its own; the
 * logic is `PlaceFields`. It is built of the form's shared pieces
 * (`_form.css`), as the properties' pane is; the title and the buttons are
 * the hub's.
 *
 * Its first field is the note's, the caret after its text, a note's name
 * having no fixed shape and being mended as often as replaced. Its fields
 * are shut with the form's while a create is under way.
 */
export class PlacePane implements HubPane, PlaceSurface {
    private readonly field: DestinationField;
    private readonly issues: IssueBoard<PlaceField>;
    private readonly fields: PlaceFields;

    constructor(app: App, pane: HTMLElement, opts: PlacePaneOptions) {
        const form = pane.createDiv({ cls: 'task-hub__place tv-form' });
        const group = form.createDiv({ cls: 'tv-form__group' });
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

    focus(): FieldFocus {
        return this.field.focus('note');
    }

    setEnabled(enabled: boolean): void {
        this.field.setEnabled(enabled);
    }

    dispose(): void {
        this.fields.dispose();
    }

    render(state: PlaceViewState): void {
        this.field.offerHeadings(state.headings);
        this.issues.set('place', state.issues);
    }
}
