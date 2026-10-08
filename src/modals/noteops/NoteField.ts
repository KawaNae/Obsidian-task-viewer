import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { NoteAsk } from '../../services/data/NoteName';
import { NoteSuggest } from '../../suggest/NoteSuggest';
import { onFormEnter } from '../form/formEnter';
import { createFormRow } from '../form/formRow';

/** What a {@link NoteField} opens with, and whom it tells. */
export interface NoteFieldOptions {
    initial: NoteAsk;
    /** The field was typed in, or a candidate picked. */
    onChange: () => void;
    /** Enter in the field, when it is not picking from its list. */
    onEnter: () => void;
}

/**
 * The field that names a note: a form row with its icon, as the hub's rows
 * are, searched by name or folder among the vault's notes, aliases and
 * unresolved links, as Obsidian's `[[` lists them (`NoteSuggest`;
 * `note-suggest/send-field.md`).
 *
 * It holds the text typed and the note picked (`NoteAsk`). A note picked,
 * or an alias of one, puts the note's name in the field and is held as
 * picked, so that a name other notes share still names that note; once the
 * text is changed, what was picked is let go and the text is read on its
 * own. An unresolved link puts its text in, which names the note a send
 * makes. Which note that is, and what is said of it under the row
 * ({@link says}), is the form's to find out.
 */
export class NoteField {
    readonly input: HTMLInputElement;
    /** The line under the row, where what is said of the note goes. */
    readonly says: HTMLElement;
    private readonly suggest: NoteSuggest;
    /** The note picked, and the text the pick put in. */
    private picked: { path: string; text: string } | null;

    constructor(app: App, container: HTMLElement, opts: NoteFieldOptions) {
        const { row, says } = createFormRow(container, t('modal.send.note'), { icon: 'file-text' });
        this.says = says;
        this.input = row.createEl('input', {
            type: 'text',
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control',
            placeholder: t('modal.send.notePlaceholder'),
        });
        this.input.value = opts.initial.text;
        this.picked = opts.initial.picked === null ? null : { path: opts.initial.picked, text: opts.initial.text };
        this.input.addEventListener('input', () => {
            if (this.picked && this.input.value !== this.picked.text) this.picked = null;
            opts.onChange();
        });
        this.suggest = new NoteSuggest(app, this.input, {
            kinds: { attachments: false, aliases: true, unresolved: true },
            pick: (candidate) => {
                if (candidate.kind === 'unresolved') {
                    this.picked = null;
                    this.input.value = candidate.linkpath;
                } else {
                    this.picked = { path: candidate.file.path, text: candidate.file.basename };
                    this.input.value = candidate.file.basename;
                }
                opts.onChange();
            },
        });
        onFormEnter(this.input, () => opts.onEnter(), { takesEnter: () => this.suggest.listShown });
    }

    /** What the field holds now. */
    ask(): NoteAsk {
        return { text: this.input.value, picked: this.picked?.path ?? null };
    }
}
