import type { App } from 'obsidian';
import { t } from '../../i18n';
import { renderComplex } from '../../suggest/candidateView';
import { ShownSuggest } from '../../suggest/ShownSuggest';
import { createClearableInput, type ClearButton } from '../form/ClearButton';
import { onFormEnter } from '../form/formEnter';
import { TextPick } from '../form/TextPick';
import { createFormRow } from '../form/formRow';
import type { IssueSlot } from '../form/FormIssue';
import type { FieldFocus } from '../../utils/FieldFocus';
import { NAME_ON_FOCUS, NoteField } from '../noteops/NoteField';
import { offeredChoices, trailOf, type HeadingAsk, type SectionAsk, type SectionChoice, type SectionDialogField } from './SectionDialog';

/** What a {@link SectionField} opens with, and whom it tells. */
export interface SectionFieldOptions {
    initial: SectionAsk;
    /** The note field was typed in, or a note picked. */
    noteChanged: () => void;
    /** The heading field was typed in, or a heading picked. */
    headingChanged: () => void;
    /** Enter in a field, when it is not picking from a list. */
    onEnter: () => void;
}

/**
 * A section of a note: the note (`NoteField`, the vault's notes and their
 * aliases), and a heading of it, the note's headings offered under it with
 * the whole note first: two form rows, each with its icon, as the send
 * dialog's destination is. Left empty, the heading field stands for the
 * whole note, which it shows in its place. Each field's × empties it as
 * deleting its text does (`createClearableInput`).
 *
 * The heading field holds its text and the heading picked (`HeadingAsk`),
 * as the note field holds a note: the heading is picked while the field
 * holds the text the pick put in, typed back or not, and the text is read on
 * its own while it differs (`TextPick`). A heading picked is of the note it
 * was picked in, by its path, so a note named since does not take it. What the note is, and which headings it has, is the form's to
 * find out and to hand in ({@link offer}).
 */
export class SectionField {
    private readonly note: NoteField;
    private readonly headingInput: HTMLInputElement;
    private readonly headingSays: HTMLElement;
    private readonly suggest: SectionChoiceSuggest;
    private readonly headingClear: ClearButton;
    /** The heading picked: the note it was picked in, and its line there. */
    private readonly picked: TextPick<{ path: string; line: number }>;

    constructor(app: App, container: HTMLElement, opts: SectionFieldOptions) {
        this.note = new NoteField(app, container, {
            initial: opts.initial.note,
            // A frame shows a note there is.
            offersUnresolved: false,
            onChange: opts.noteChanged,
            onEnter: opts.onEnter,
        });

        const { row, says } = createFormRow(container, t('modal.heading'), { icon: 'heading' });
        this.headingSays = says;
        ({ input: this.headingInput, clear: this.headingClear } = createClearableInput(row, t('modal.section.wholeNote')));
        const { heading } = opts.initial;
        this.headingInput.value = heading.text;
        this.headingClear.sync();
        this.picked = new TextPick(heading.picked, heading.text);
        this.headingInput.addEventListener('input', () => opts.headingChanged());
        this.suggest = new SectionChoiceSuggest(app, this.headingInput, ({ choice, path }) => {
            if (choice.kind === 'note') {
                this.picked.pick(null, '');
                this.headingInput.value = '';
            } else {
                this.picked.pick({ path, line: choice.heading.line }, choice.heading.text);
                this.headingInput.value = choice.heading.text;
            }
            this.headingClear.sync();
            opts.headingChanged();
        });
        onFormEnter(this.headingInput, () => opts.onEnter(), { takesEnter: () => this.suggest.listShown });
    }

    /** What the fields hold now. */
    ask(): SectionAsk {
        return { note: this.note.ask(), heading: this.heading() };
    }

    /** What the heading field holds now. */
    heading(): HeadingAsk {
        const text = this.headingInput.value;
        return { text, picked: this.picked.of(text) };
    }

    /** What the heading field offers: the choices of the note at `path`, as the form found them; none while there is no note. */
    offer(path: string | null, choices: readonly SectionChoice[]): void {
        this.suggest.offered = { path, choices };
    }

    /** Where what is said of the note, or of the heading, goes: its input and the line under its row. */
    slot(at: SectionDialogField): IssueSlot {
        return at === 'note'
            ? { input: this.note.input, message: this.note.says }
            : { input: this.headingInput, message: this.headingSays };
    }

    /** The focus on the note field, or on the heading field, its text met as a name's is. */
    focus(at: SectionDialogField): FieldFocus {
        return at === 'note' ? this.note.focus() : { to: this.headingInput, selection: NAME_ON_FOCUS };
    }
}

/** A choice of the heading field, and the path of the note whose it is. */
interface OfferedChoice {
    choice: SectionChoice;
    path: string;
}

/**
 * The choices of the heading field, as Obsidian's `[[note#` draws a heading
 * (`renderComplex`: the text, its level beside it). With nothing typed,
 * every choice is listed, each heading indented as deep as the headings it
 * stands under; with a text typed, the headings that hold it are listed
 * without the headings above them, so each says those under its text. A
 * heading no link names is drawn faded, says so under its text, and picks
 * nothing: the list stays open.
 *
 * Each candidate carries the path of the note it is a heading of, as it was
 * offered when the list was drawn: a pick names that note's heading,
 * whatever the form has offered since.
 */
class SectionChoiceSuggest extends ShownSuggest<OfferedChoice> {
    offered: { path: string | null; choices: readonly SectionChoice[] } = { path: null, choices: [] };

    constructor(
        app: App,
        private readonly field: HTMLInputElement,
        private readonly picked: (offered: OfferedChoice) => void,
    ) {
        super(app, field);
    }

    protected getSuggestions(query: string): OfferedChoice[] {
        const { path } = this.offered;
        if (path === null) return [];
        return offeredChoices(this.offered.choices, query).map(choice => ({ choice, path }));
    }

    renderSuggestion({ choice }: OfferedChoice, el: HTMLElement): void {
        el.addClass('tv-section-choice');
        if (choice.kind === 'note') {
            renderComplex(el, { title: t('modal.section.wholeNote'), titleMatches: null, note: '', noteMatches: null, flair: null, downranked: false });
            return;
        }
        const filtered = this.field.value.trim() !== '';
        if (!filtered) el.style.setProperty('--tv-section-depth', String(choice.above.length));
        if (choice.subpath === null) el.addClass('tv-section-choice--shut');
        const notes = [
            ...(filtered && choice.above.length > 0 ? [trailOf(choice.above)] : []),
            ...(choice.subpath === null ? [t('modal.section.unlinkableShort')] : []),
        ];
        renderComplex(el, {
            title: choice.heading.text,
            titleMatches: null,
            note: notes.join(' · '),
            noteMatches: null,
            flair: { text: `H${choice.heading.level}` },
            downranked: false,
        });
    }

    protected pick(offered: OfferedChoice): void {
        if (offered.choice.kind === 'heading' && offered.choice.subpath === null) return;
        this.picked(offered);
        this.close();
    }
}
