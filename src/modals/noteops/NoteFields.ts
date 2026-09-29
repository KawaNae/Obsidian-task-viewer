import type { App, TFile } from 'obsidian';
import { t } from '../../i18n';
import { NoteName, type NameCheck, type NoteAt } from '../../services/data/NoteName';
import { FileSuggest } from '../../suggest/FileSuggest';
import { FolderSuggest } from '../../suggest/FolderSuggest';
import type { ShownSuggest } from '../../suggest/ShownSuggest';
import { createFormRow } from '../form/formRow';

/** What {@link NoteFields} are opened with, and whom they tell. */
export interface NoteFieldsOptions {
    name: string;
    folder: string;
    /** A field was typed in, or a note or a folder was picked. */
    onChange: () => void;
    /** Enter in a field, when it is not picking from a list. */
    onEnter: () => void;
}

/**
 * The fields that name a note and say where it goes: its name (with the
 * vault's notes suggested), and its folder (with the vault's folders
 * suggested). Picking a note puts its name and its folder in the two. They
 * answer the note the two point at (`NoteName.at`) — a new note or one of the
 * vault's, which the fields do not keep apart themselves — and whether the
 * name can be one; what the form does with that note is the form's to say.
 *
 * The name follows what the form suggests ({@link suggestName}) until the
 * user types in it or picks a note.
 */
export class NoteFields {
    readonly nameInput: HTMLInputElement;
    readonly folderInput: HTMLInputElement;
    private readonly fileSuggest: FileSuggest;
    private readonly folderSuggest: FolderSuggest;
    private typedName = false;

    constructor(private readonly app: App, container: HTMLElement, opts: NoteFieldsOptions) {
        const { row: nameRow } = createFormRow(container, t('modal.noteFields.name'));
        this.nameInput = nameRow.createEl('input', { type: 'text', cls: 'tv-ctrl__text-input tv-form__control' });
        this.nameInput.value = opts.name;
        this.nameInput.addEventListener('input', () => {
            this.typedName = true;
            opts.onChange();
        });
        this.fileSuggest = new FileSuggest(app, this.nameInput, (file) => {
            this.pick(file);
            opts.onChange();
        });

        const { row: folderRow } = createFormRow(container, t('modal.noteFields.folder'));
        this.folderInput = folderRow.createEl('input', {
            type: 'text',
            cls: 'tv-ctrl__text-input tv-form__control',
            placeholder: t('modal.noteFields.folderRoot'),
        });
        this.folderInput.value = opts.folder;
        this.folderSuggest = new FolderSuggest(app, this.folderInput);
        this.folderInput.addEventListener('input', () => opts.onChange());

        const lists: [HTMLInputElement, ShownSuggest<unknown>][] = [
            [this.nameInput, this.fileSuggest],
            [this.folderInput, this.folderSuggest],
        ];
        for (const [input, suggest] of lists) {
            input.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key !== 'Enter' || e.isComposing) return;
                if (suggest.listShown) return;
                e.preventDefault();
                opts.onEnter();
            });
        }
    }

    get name(): string {
        return this.nameInput.value;
    }

    get folder(): string {
        return this.folderInput.value.trim();
    }

    /** Put `name` in the name field, unless the user has typed a name of their own or picked a note. */
    suggestName(name: string): void {
        if (this.typedName) return;
        this.nameInput.value = name;
    }

    /** Whether the name can be a note's (`NoteName.check`). */
    check(): NameCheck {
        return NoteName.check(this.name);
    }

    /** The note the name and the folder point at (`NoteName.at`); asked only of a name that can be one. */
    at(): NoteAt {
        return NoteName.at(this.app.vault, this.folder, this.name);
    }

    /** Name `file` by the two fields: its name, and its folder ('' for the root). */
    private pick(file: TFile): void {
        this.typedName = true;
        this.nameInput.value = file.basename;
        const folder = file.parent?.path ?? '';
        this.folderInput.value = folder === '/' ? '' : folder;
    }
}
