import type { Setting } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import { bindField, type BoundField } from '../modals/form/bindField';
import { IssueBoard, readIssue } from '../modals/form/FormIssue';
import type { FieldCodec } from '../utils/values/Read';

/** A text field of the settings: what it reads, and where its value is. */
export interface TextSettingSpec<T> {
    /** How the text reads (the settings' table, `SETTINGS_SCHEMA`, holds most). */
    codec: FieldCodec<T>;
    /** The value the field stands for now. */
    get(): T;
    /** Put a value read in the settings; they are saved after. */
    put(value: T): void;
    placeholder?: string;
    /** The keyboard a phone shows: digits for a whole number, digits and a point for a decimal. */
    inputMode?: 'numeric' | 'decimal';
    /**
     * A list of candidates under the field (`FolderSuggest`, `NoteSuggest`),
     * made on its input: `picked` puts the text of the item picked in the
     * field and commits it.
     */
    list?(input: HTMLInputElement, picked: (text: string) => void): { readonly listShown: boolean };
    /** Called once the value is saved (the status's preview drawn again). */
    saved?(value: T): void;
}

/**
 * The text fields of the settings, bound to their values (`bindField`,
 * I#11): a field is read as it is typed and what does not read is said
 * under the setting's description, the field marked; nothing is saved
 * while typing. A blur or the form's Enter commits once: a value that
 * reads is shown as read and saved, one that does not stays as typed and
 * is not saved (入力の論点 E). The settings are read again (and the notes,
 * when a scope key changed) once for a commit, not for each key typed.
 *
 * One per drawing of the settings' tab: {@link commitAll} commits what is
 * typed in every field as the tab is hidden, which does not wait for a blur.
 */
export class SettingFields {
    private bound: { input: HTMLInputElement; field: BoundField<unknown> }[] = [];

    constructor(private readonly plugin: Pick<PluginContext, 'saveSettings'>) {}

    /** A text field on `setting`, its issues said under the setting's description. */
    text<T>(setting: Setting, spec: TextSettingSpec<T>): { input: HTMLInputElement; field: BoundField<T> } {
        let made: { input: HTMLInputElement; field: BoundField<T> } | undefined;
        setting.addText((text) => {
            const input = text.inputEl;
            let field: BoundField<T> | null = null;
            if (spec.placeholder !== undefined) text.setPlaceholder(spec.placeholder);
            if (spec.inputMode) input.inputMode = spec.inputMode;
            input.value = spec.codec.show(spec.get());

            const says = setting.descEl.createDiv({ cls: 'tv-form__says tv-settings__says' });
            const issues = new IssueBoard<'value'>({ field: () => ({ input, message: says }), form: says });
            const list = spec.list?.(input, (picked) => {
                input.value = picked;
                field?.commit();
            });
            field = bindField(input, {
                codec: spec.codec,
                current: () => spec.get(),
                commit: (value) => {
                    spec.put(value);
                    return this.plugin.saveSettings().then(() => {
                        spec.saved?.(value);
                        return true;
                    });
                },
                issues: (issue) => issues.set('read', readIssue('value', issue)),
                takesEnter: list ? () => list.listShown : undefined,
            });
            made = { input, field };
        });
        if (!made) throw new Error('SettingFields.text: the setting made no text field');
        this.bound.push(made as { input: HTMLInputElement; field: BoundField<unknown> });
        return made;
    }

    /**
     * Commit what is typed in every field still in the tab: as the tab is
     * hidden or drawn again. A field drawn over (a status's row after the
     * list was drawn anew) is let go, not committed.
     */
    commitAll(): void {
        this.bound = this.bound.filter(one => one.input.isConnected);
        for (const one of this.bound) one.field.commit();
    }
}
