import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { DestinationAsk } from '../../services/data/NotePlaces';
import { ShownSuggest } from '../../suggest/ShownSuggest';
import { createClearableInput, type ClearButton } from '../form/ClearButton';
import { onFormEnter } from '../form/formEnter';
import { createFormRow } from '../form/formRow';
import type { IssueSlot } from '../form/FormIssue';
import type { FieldFocus } from '../../utils/FieldFocus';
import { NAME_ON_FOCUS, NoteField } from './NoteField';

/** What a {@link DestinationField} opens with, and whom it tells. */
export interface DestinationFieldOptions {
    /** The fields as they open: the note, and the heading. */
    initial: DestinationAsk;
    /** A field was typed in, or a note or a heading was picked. */
    onChange: () => void;
    /** Enter in a field, when it is not picking from a list. */
    onEnter: () => void;
}

/**
 * Where lines go: a note (`NoteField`), and a heading in it, the note's
 * headings suggested: two form rows, each with its icon, as the hub's rows
 * are. The send dialog and the place tab of the hub on a task to make hold it.
 * The heading field left empty stands for the note's end, under no
 * heading, for every form (`NotePlaces.readFields` reads it so); the field
 * says so in its place. Each field's × empties it as deleting its text does
 * (`createClearableInput`).
 *
 * It holds what the user typed and nothing of the operation it is for:
 * what the note is, which headings it has and whether a field is wrong are
 * the form's to find out ({@link offerHeadings}) and to say, under the
 * field's row ({@link slot}).
 */
export class DestinationField {
    private readonly note: NoteField;
    private readonly headingInput: HTMLInputElement;
    private readonly headingClear: ClearButton;
    private readonly headingSays: HTMLElement;
    private readonly headingSuggest: HeadingSuggest;

    constructor(app: App, container: HTMLElement, opts: DestinationFieldOptions) {
        this.note = new NoteField(app, container, {
            initial: opts.initial.note,
            // A send makes the note an unresolved link names.
            offersUnresolved: true,
            onChange: opts.onChange,
            onEnter: opts.onEnter,
        });

        const { row, says } = createFormRow(container, t('modal.heading'), { icon: 'heading' });
        this.headingSays = says;
        const heading = createClearableInput(row, t('modal.destination.headingEmpty'));
        this.headingInput = heading.input;
        this.headingClear = heading.clear;
        this.headingInput.value = opts.initial.heading;
        this.headingClear.sync();
        this.headingInput.addEventListener('input', () => opts.onChange());
        this.headingSuggest = new HeadingSuggest(app, this.headingInput);
        onFormEnter(this.headingInput, () => opts.onEnter(), { takesEnter: () => this.headingSuggest.listShown });
    }

    /** What the fields hold now. */
    ask(): DestinationAsk {
        return { note: this.note.ask(), heading: this.headingInput.value };
    }

    /** Both fields taking input or not, their × with them. */
    setEnabled(enabled: boolean): void {
        this.note.setEnabled(enabled);
        this.headingInput.disabled = !enabled;
        this.headingClear.sync();
    }

    /** The headings the heading field suggests: the note's, as the form found them. */
    offerHeadings(headings: readonly string[]): void {
        this.headingSuggest.headings = headings;
    }

    /** Where what is said of the note, or of the heading, goes: its input and the line under its row. */
    slot(at: 'note' | 'heading'): IssueSlot {
        return at === 'note'
            ? { input: this.note.input, message: this.note.says }
            : { input: this.headingInput, message: this.headingSays };
    }

    /** The focus on the note field, or on the heading, its text met as a name's is. */
    focus(at: 'note' | 'heading'): FieldFocus<HTMLElement> {
        return at === 'note' ? this.note.focus() : { to: this.headingInput, selection: NAME_ON_FOCUS };
    }
}

/** The headings of a note, those that hold what is typed, each once, in the order they stand. */
class HeadingSuggest extends ShownSuggest<string> {
    headings: readonly string[] = [];

    constructor(app: App, private readonly field: HTMLInputElement) {
        super(app, field);
    }

    protected getSuggestions(query: string): string[] {
        const lower = query.trim().toLowerCase();
        return [...new Set(this.headings)].filter(name => name.toLowerCase().includes(lower));
    }

    renderSuggestion(name: string, el: HTMLElement): void {
        el.setText(name);
    }

    protected pick(name: string): void {
        this.field.value = name;
        this.field.trigger('input');
        this.close();
    }
}
