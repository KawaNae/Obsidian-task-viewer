import { t } from '../../../i18n';
import { TaskNameSuggest } from '../../../suggest/TaskNameSuggest';
import { attachBracketPairing } from '../../form/bracketPairing';
import { bindField, type BoundField } from '../../form/bindField';
import { readIssue, type IssueSlot } from '../../form/FormIssue';
import { TaskUpdateBuilder } from '../../form/TaskUpdateBuilder';
import { TaskContentInput } from '../../../services/parsing/tv-inline/TaskContentInput';
import type { ClosingPart, FieldGroupContext, UnsavedField } from './FieldGroupContext';

/**
 * The row's name: a text field over its content, read by `TaskContentInput`
 * (a name that holds a date block or another row's syntax does not read, and
 * says why under it). It is committed on Enter and on leaving it
 * (`bindField`), not on an Enter an IME converts with or one its link list
 * takes. A link typed in it is offered from the row's note, and a bracket
 * typed is paired.
 */
export class NameField implements ClosingPart {
    private readonly input: HTMLInputElement;
    private readonly says: HTMLElement;
    private readonly bound: BoundField<string>;

    constructor(container: HTMLElement, private ctx: FieldGroupContext) {
        const section = container.createDiv({ cls: 'tv-form__name-section' });
        section.createEl('label', { text: t('modal.taskName') });
        this.input = section.createEl('input', {
            type: 'text',
            placeholder: t('modal.taskName'),
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow',
        });
        this.input.value = ctx.getTask().content ?? '';
        this.says = section.createDiv({ cls: 'tv-form__says' });
        // A link typed in the name is written in the row's note.
        const suggest = new TaskNameSuggest(ctx.app, this.input, () => this.ctx.getTask().file);
        attachBracketPairing(this.input, () => { /* the value is read as it is committed */ });
        this.bound = bindField(this.input, {
            codec: TaskContentInput,
            current: () => this.ctx.getTask().content ?? '',
            commit: (content) => this.commit(content),
            issues: (issue) => this.ctx.issues.set('name', readIssue('name', issue)),
            // An Enter that picks from the name's list is the list's.
            takesEnter: () => suggest.listShown,
        });
    }

    private commit(content: string): Promise<boolean> | void {
        if (this.ctx.isShut()) return;
        return this.ctx.queue(TaskUpdateBuilder.content(this.ctx.getTask(), content));
    }

    unsaved(): UnsavedField[] {
        return this.bound.pending()?.ok === false ? [{ label: t('modal.taskName'), input: this.input }] : [];
    }

    discardUnsaved(): void {
        if (this.bound.pending()?.ok === false) this.bound.discard();
    }

    save(): void {
        if (this.bound.pending()?.ok) this.bound.commit();
    }

    /** The row's name from outside, unless something is typed over it or an IME converts in it (`BoundField.set`). */
    refresh(): void {
        this.bound.set(this.ctx.getTask().content ?? '');
    }

    setEnabled(enabled: boolean): void {
        this.input.disabled = !enabled;
    }

    /** Where the name says its issues: its input and the line under it. */
    slot(): IssueSlot {
        return { input: this.input, message: this.says };
    }

    fieldElement(): HTMLInputElement {
        return this.input;
    }
}
