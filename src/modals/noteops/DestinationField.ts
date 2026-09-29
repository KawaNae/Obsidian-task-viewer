import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { DestinationAsk } from '../../services/data/NoteOps';
import { ShownSuggest } from '../../suggest/ShownSuggest';
import { createFormRow } from '../form/formRow';
import { NoteFields } from './NoteFields';

/** What a {@link DestinationField} opens with, and whom it tells. */
export interface DestinationFieldOptions {
    /** The fields as they open: the note's name and folder, and the heading ('' for the default one). */
    initial: DestinationAsk;
    /** The heading the rows go under when the field is left empty, shown in its place. */
    defaultHeading: string;
    /** A field was typed in, or a note, a folder or a heading was picked. */
    onChange: () => void;
    /** Enter in a field, when it is not picking from a list. */
    onEnter: () => void;
}

/**
 * Where lines go: a note, by its name and folder (`NoteFields`), and a
 * heading in it, the note's headings suggested. Left empty, the heading
 * field stands for the default one, which it shows in its place.
 *
 * It holds what the user typed and nothing of the operation it is for:
 * what the note is, which headings it has and whether a field is wrong are
 * the form's to find out and to say ({@link offerHeadings},
 * {@link markInvalid}).
 */
export class DestinationField {
    private readonly note: NoteFields;
    readonly headingInput: HTMLInputElement;
    private readonly headingSuggest: HeadingSuggest;

    constructor(app: App, container: HTMLElement, opts: DestinationFieldOptions) {
        this.note = new NoteFields(app, container, {
            name: opts.initial.name,
            folder: opts.initial.folder,
            onChange: opts.onChange,
            onEnter: opts.onEnter,
        });

        const { row } = createFormRow(container, t('modal.send.heading'));
        this.headingInput = row.createEl('input', {
            type: 'text',
            cls: 'tv-ctrl__text-input tv-form__control',
            placeholder: opts.defaultHeading,
        });
        this.headingInput.value = opts.initial.heading;
        this.headingInput.addEventListener('input', () => opts.onChange());
        this.headingSuggest = new HeadingSuggest(app, this.headingInput);
        this.headingInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            if (this.headingSuggest.listShown) return;
            e.preventDefault();
            opts.onEnter();
        });
    }

    /** What the fields hold now. */
    ask(): DestinationAsk {
        return { folder: this.note.folder, name: this.note.name, heading: this.headingInput.value };
    }

    /** The headings the heading field suggests: the note's, as the form found them. */
    offerHeadings(headings: readonly string[]): void {
        this.headingSuggest.headings = headings;
    }

    /** Say which fields are wrong, as an invalid input reads (`tv-ctrl__text-input--invalid`). */
    markInvalid(invalid: { name: boolean; heading: boolean }): void {
        this.note.nameInput.toggleClass('tv-ctrl__text-input--invalid', invalid.name);
        this.headingInput.toggleClass('tv-ctrl__text-input--invalid', invalid.heading);
    }

    focus(): void {
        this.note.nameInput.focus();
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

    selectSuggestion(name: string): void {
        this.field.value = name;
        this.field.trigger('input');
        this.close();
    }
}
