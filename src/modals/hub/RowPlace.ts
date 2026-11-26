import { setIcon, type App } from 'obsidian';
import { t } from '../../i18n';
import type { FieldFocus } from '../../utils/FieldFocus';
import { placeFocus } from '../../views/sharedUI/FocusPlacement';
import { IssueBoard } from '../form/FormIssue';
import { SendFields } from '../noteops/SendFields';
import type { SendSurface, SendViewState } from '../noteops/SendDialog';
import { PlaceShown, type ShownPlace } from '../place/PlaceShown';
import type { HubPlace } from './HubHost';
import type { MoveStart, RowMove } from './RowMove';

/** What the place asks of a move the hub is in: what its fields open with, and what they tell it. */
export type PlaceMove = Pick<RowMove, 'initial' | 'fieldsChanged' | 'check' | 'submit' | 'show'>;

/** What the place of a row reads, and what it asks, of the hub's host (`RowHost`). */
export interface RowPlaceHost {
    /** Where the row stands, as a place shown with no field. */
    shown(): ShownPlace | null;
    /** The move the hub is in now; null while it writes each change as it comes. */
    moving(): PlaceMove | null;
    /** Begin a move of the row, its fields opened on where it stands now. */
    beginMove(start: MoveStart): Promise<void>;
}

/**
 * Where a row stands, as a group of the hub's basic tab, and where it goes
 * while the hub moves it. Out of a move it is the place shown with no field
 * (`PlaceShown`), with a button at the end of the note's row that begins a
 * move, named as the card menu's item that moves the row; a hub on a row
 * read only has no button. In a move its group is the destination's fields
 * and the values offered (`SendFields`), drawn as the move's send says
 * (`SendSurface`), what is said of the note and the heading under them; the
 * parent's row is not there, since a move takes the row from under its
 * parent. What the send says of the move as a whole is the host's to say,
 * above the write.
 *
 * Which of the two it is, it reads from the host each time it is refreshed.
 * Coming out of a move, the focus goes to the button. Going into one, the
 * focus is not put here: the form's row of buttons and what is said above
 * [Move] are drawn after the place, and shrink the body, so the host puts
 * it once all of it is drawn (`HubForm.focusPlace`), on the field
 * {@link focus} answers.
 */
export class RowPlace implements HubPlace, SendSurface {
    private readonly shown: PlaceShown;
    /** The button that begins a move; null on a row read only. */
    private readonly moveButton: HTMLButtonElement | null;
    /** The move's fields, while the hub is in one. */
    private editing: { move: PlaceMove; fields: SendFields; issues: IssueBoard<'note' | 'heading'> } | null = null;
    /** The field the first error is said under, as last drawn. */
    private errorAt: 'note' | 'heading' | null = null;
    private enabled = true;

    /** Build the group at the end of `parent`, the form's basic tab; with a button to move the row when it is `movable`. */
    constructor(private readonly app: App, parent: HTMLElement, private readonly host: RowPlaceHost, movable: boolean) {
        this.shown = new PlaceShown(parent, () => host.shown());
        this.moveButton = movable ? this.buildMoveButton() : null;
    }

    private buildMoveButton(): HTMLButtonElement {
        const button = this.shown.noteRow.createEl('button', {
            cls: 'tv-icon-btn task-hub__move',
            attr: { type: 'button', 'aria-label': t('menu.sendToNote') },
        });
        setIcon(button, 'pencil');
        button.addEventListener('click', () => { void this.host.beginMove('here'); });
        return button;
    }

    /** In a move, the field the first error is said under, else the note; none out of one. */
    focus(): FieldFocus<HTMLElement> | null {
        return this.editing?.fields.focus(this.errorAt ?? 'note') ?? null;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (this.moveButton) this.moveButton.disabled = !enabled;
        this.editing?.fields.setEnabled(enabled);
    }

    refresh(): void {
        const move = this.host.moving();
        if (move !== (this.editing?.move ?? null)) {
            if (this.editing) this.leave();
            if (move) this.enter(move);
        }
        if (!this.editing) this.shown.refresh();
    }

    /** The move's send as it is now: the note's headings and the values offered, and what is said of the note and the heading. */
    render(state: SendViewState): void {
        const editing = this.editing;
        if (!editing) return;
        editing.fields.render(state);
        const ofFields = state.issues.filter(issue => issue.at === 'note' || issue.at === 'heading')
            .map(issue => ({ ...issue, at: issue.at as 'note' | 'heading' }));
        editing.issues.set('send', ofFields);
        this.errorAt = ofFields.find(issue => issue.tone === 'error')?.at ?? null;
    }

    /** The shown place gives way to the move's fields. */
    private enter(move: PlaceMove): void {
        const fields = new SendFields(this.app, this.shown.el.parentElement!, {
            initial: move.initial,
            groupClass: 'task-hub__place',
            onChange: (ask) => move.fieldsChanged(ask),
            onEnter: () => move.submit(),
            onCheck: (key, checked) => move.check(key, checked),
        });
        this.shown.el.replaceWith(fields.group);
        // Only what is of the note and of the heading is said here, each under
        // its field; what is of the move as a whole the host says above the write.
        const issues = new IssueBoard<'note' | 'heading'>({
            field: (at) => fields.slot(at),
            form: fields.group,
        });
        this.editing = { move, fields, issues };
        this.errorAt = null;
        fields.setEnabled(this.enabled);
        move.show(this);
    }

    /** The move's fields give way to the shown place again, the focus on the button. */
    private leave(): void {
        const editing = this.editing!;
        this.editing = null;
        this.errorAt = null;
        editing.move.show(null);
        editing.fields.group.replaceWith(this.shown.el);
        editing.fields.remove();
        if (this.moveButton) placeFocus({ to: this.moveButton });
    }

    dispose(): void {
        this.editing?.move.show(null);
    }
}
