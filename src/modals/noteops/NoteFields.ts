import type { App, TFile } from 'obsidian';
import { t } from '../../i18n';
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
 * The fields that name a note and say where it goes, in the order of its
 * path: its folder (with the vault's folders suggested), and its name (with
 * the vault's notes suggested), each a form row with its icon, as the hub's
 * rows are. Picking a note puts its folder and its name in the two. What
 * the note is, and what the form does with it, is the form's to say.
 */
export class NoteFields {
    readonly nameInput: HTMLInputElement;
    readonly folderInput: HTMLInputElement;
    private readonly fileSuggest: FileSuggest;
    private readonly folderSuggest: FolderSuggest;

    constructor(app: App, container: HTMLElement, opts: NoteFieldsOptions) {
        const { row: folderRow } = createFormRow(container, t('modal.noteFields.folder'), { icon: 'folder' });
        this.folderInput = folderRow.createEl('input', {
            type: 'text',
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control',
            placeholder: t('modal.noteFields.folderRoot'),
        });
        this.folderInput.value = opts.folder;
        this.folderSuggest = new FolderSuggest(app, this.folderInput);
        this.folderInput.addEventListener('input', () => opts.onChange());

        const { row: nameRow } = createFormRow(container, t('modal.noteFields.name'), { icon: 'file-text' });
        this.nameInput = nameRow.createEl('input', { type: 'text', cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control' });
        this.nameInput.value = opts.name;
        this.nameInput.addEventListener('input', () => opts.onChange());
        this.fileSuggest = new FileSuggest(app, this.nameInput, (file) => {
            this.pick(file);
            opts.onChange();
        });

        const lists: [HTMLInputElement, ShownSuggest<unknown>][] = [
            [this.folderInput, this.folderSuggest],
            [this.nameInput, this.fileSuggest],
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

    /** Name `file` by the two fields: its name, and its folder ('' for the root). */
    private pick(file: TFile): void {
        this.nameInput.value = file.basename;
        const folder = file.parent?.path ?? '';
        this.folderInput.value = folder === '/' ? '' : folder;
    }
}
