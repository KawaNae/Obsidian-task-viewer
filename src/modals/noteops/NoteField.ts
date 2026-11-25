import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { NoteAsk } from '../../services/data/NoteName';
import type { FieldFocus, SelectionOnFocus } from '../../utils/FieldFocus';
import { NoteSuggest } from '../../suggest/NoteSuggest';
import { createClearableInput, type ClearButton } from '../form/ClearButton';
import { onFormEnter } from '../form/formEnter';
import { TextPick } from '../form/TextPick';
import { createFormRow } from '../form/formRow';

/**
 * How the text of a field that names a note or a heading is met as the
 * focus comes to it: the caret after it. Such a name has no fixed shape, and
 * is mended (a part of it changed, `Tasks` to `Tasks 2`) as often as
 * replaced; the field's × empties it in one press for a name typed anew.
 */
export const NAME_ON_FOCUS: SelectionOnFocus = 'end';

/** What a {@link NoteField} opens with, and whom it tells. */
export interface NoteFieldOptions {
    initial: NoteAsk;
    /** Whether the targets of unresolved links are offered: a name of a note the form may make. */
    offersUnresolved: boolean;
    /** The field was typed in, or a candidate picked. */
    onChange: () => void;
    /** Enter in the field, when it is not picking from its list. */
    onEnter: () => void;
}

/**
 * The field that names a note: a form row with its icon, as the hub's rows
 * are, searched by name or folder among the vault's notes and aliases, and
 * the unresolved links for a form that may make the note one names, as
 * Obsidian's `[[` lists them (`NoteSuggest`). The send dialog, the place
 * tab of the hub on a task to make and the sidebar's section dialog name a
 * note with it.
 *
 * It holds the text typed and the note picked (`NoteAsk`). A note picked,
 * or an alias of one, puts the note's name in the field and is held as
 * picked, so that a name other notes share still names that note; a note
 * the form opens the field on is held so too, and names its path even while
 * no note is there. The note is picked while the field holds the text the
 * pick put in, typed back or not, and the text is read on its own while it
 * differs (`TextPick`). An unresolved link picks none and puts its text in,
 * which names the note the form makes. Its ×
 * empties it as deleting the text does, the focus left in it
 * (`createClearableInput`). Which note that is, and what is said of it
 * under the row ({@link says}), is the form's to find out.
 */
export class NoteField {
    readonly input: HTMLInputElement;
    /** The line under the row, where what is said of the note goes. */
    readonly says: HTMLElement;
    private readonly suggest: NoteSuggest;
    private readonly clear: ClearButton;
    /** The path of the note picked. */
    private readonly picked: TextPick<string>;

    constructor(app: App, container: HTMLElement, opts: NoteFieldOptions) {
        const { row, says } = createFormRow(container, t('modal.note'), { icon: 'file-text' });
        this.says = says;
        ({ input: this.input, clear: this.clear } = createClearableInput(row, t('modal.notePlaceholder')));
        this.input.value = opts.initial.text;
        this.clear.sync();
        this.picked = new TextPick(opts.initial.picked, opts.initial.text);
        this.input.addEventListener('input', () => opts.onChange());
        this.suggest = new NoteSuggest(app, this.input, {
            kinds: { attachments: false, aliases: true, unresolved: opts.offersUnresolved },
            pick: (candidate) => {
                if (candidate.kind === 'unresolved') {
                    this.picked.pick(null, candidate.linkpath);
                    this.input.value = candidate.linkpath;
                } else {
                    this.picked.pick(candidate.file.path, candidate.file.basename);
                    this.input.value = candidate.file.basename;
                }
                this.clear.sync();
                opts.onChange();
            },
        });
        onFormEnter(this.input, () => opts.onEnter(), { takesEnter: () => this.suggest.listShown });
    }

    /** The focus on the field, its text met as a name's is ({@link NAME_ON_FOCUS}). */
    focus(): FieldFocus<HTMLElement> {
        return { to: this.input, selection: NAME_ON_FOCUS };
    }

    /** The field taking input or not, its × with it. */
    setEnabled(enabled: boolean): void {
        this.input.disabled = !enabled;
        this.clear.sync();
    }

    /** What the field holds now. */
    ask(): NoteAsk {
        const text = this.input.value;
        return { text, picked: this.picked.of(text) };
    }
}
