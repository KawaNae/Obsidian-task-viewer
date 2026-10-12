import { setIcon } from 'obsidian';
import { t } from '../../../i18n';
import { VALID_LINE_STYLES } from '../../../constants/style';
import { COLOR_VALUES, LINE_STYLE_VALUES } from '../../../suggest/ScopeValues';
import { ChoiceInput } from '../../../utils/values/ChoiceValues';
import { ColorInput } from '../../../utils/values/ColorValues';
import { optional, type FieldCodec } from '../../../utils/values/Read';
import { TextInput } from '../../../utils/values/TextValues';
import { CascadeSource } from '../CascadeSource';
import { TaskUpdateBuilder } from '../../form/TaskUpdateBuilder';
import { createFormRow } from '../../form/formRow';
import { bindField, type BoundField } from '../../form/bindField';
import { readIssue, type IssueSlot } from '../../form/FormIssue';
import { PickerTextField } from '../../form/PickerTextField';
import { PROPERTY_ICONS } from '../../../constants/propertyIcons';
import { ValueSuggest } from '../../../suggest/ValueSuggest';
import { cssColorToHex } from '../../../utils/ColorUtils';
import type { ClosingPart, FieldGroupContext, UnsavedField } from './FieldGroupContext';

type StyleField = 'color' | 'linestyle' | 'mask';
const FIELDS: readonly StyleField[] = ['color', 'linestyle', 'mask'];
const LABEL_KEYS: Record<StyleField, string> = { color: 'modal.hub.color', linestyle: 'modal.hub.linestyle', mask: 'modal.hub.mask' };

/**
 * How each field reads: a color (a hex value or a CSS name), one of the line
 * styles in any case, a mask as typed. Empty, each takes the row's own value
 * away, and the inherited one shows through.
 */
const CODECS: Record<StyleField, FieldCodec<string | undefined>> = {
    color: optional(ColorInput),
    linestyle: optional(ChoiceInput.of([...VALID_LINE_STYLES], { caseless: true })),
    mask: optional(TextInput),
};

/**
 * color / linestyle / mask の 3 フィールド。color は native picker + swatch +
 * suggest が絡み合っているため 3 分割せず 1 グループにまとめている。
 *
 * 各欄は `bindField` で値に結ぶ。読めない値（`zigzag` の線種、色でない色）は
 * 欄の下に理由を出して保存しない。
 */
export class StyleFieldGroup implements ClosingPart {
    private colorField!: PickerTextField;
    private colorSwatch!: HTMLElement;
    private nativeColorInput!: HTMLInputElement;
    private readonly inputs = {} as Record<StyleField, HTMLInputElement>;
    private readonly bound = {} as Record<StyleField, BoundField<string | undefined>>;
    private readonly says = {} as Record<StyleField, HTMLElement>;
    private sourceEls: Partial<Record<StyleField, HTMLElement>> = {};
    private hideButtons: Partial<Record<StyleField, HTMLButtonElement>> = {};
    private unhideButtons: Partial<Record<StyleField, HTMLButtonElement>> = {};

    constructor(container: HTMLElement, private ctx: FieldGroupContext) {
        for (const field of FIELDS) this.renderRow(container, field, LABEL_KEYS[field]);
        this.showEnabled();
    }

    private renderRow(container: HTMLElement, field: StyleField, labelKey: string): void {
        const { row, says } = createFormRow(container, t(labelKey), { icon: PROPERTY_ICONS[field] });
        this.says[field] = says;

        let input: HTMLInputElement;
        let put: ((text: string) => void) | undefined;

        if (field === 'color') {
            // 日付/時刻の欄と同じ部品: 左端のピッカーのボタン + ネイティブの input + [色見本]テキスト
            this.colorField = new PickerTextField(row, {
                type: 'color',
                icon: 'palette',
                pickerLabel: t('modal.openColorPicker'),
                initialValue: '',
                clearable: false,
                cls: 'tv-form__input-with-picker--color tv-form__control',
            });
            this.nativeColorInput = this.colorField.picker;
            input = this.colorField.input;
            // 色見本はテキストの入力の中の左端に重ねる
            this.colorSwatch = this.colorField.el.createSpan({ cls: 'tv-ctrl__color-swatch task-hub__color-swatch' });
            this.colorField.el.insertBefore(this.colorSwatch, input);
            put = (text) => {
                this.colorField.setText(text);
                this.updateColorSwatch();
            };
        } else {
            input = row.createEl('input', { type: 'text', cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control' });
        }
        this.inputs[field] = input;
        input.value = this.ctx.getTask()[field] ?? '';

        const sourceEl = row.createSpan({ cls: 'task-hub__source' });
        sourceEl.addEventListener('click', () => this.ctx.openSource(row => CascadeSource.lineOfStyleField(row, field, this.ctx.plugin.settings.scopeKeys[field])));
        this.sourceEls[field] = sourceEl;

        // Hide the inherited value (`- tv-color::`), and the × that takes the row's own no value out again.
        const hide = row.createEl('button', { cls: 'task-hub__hide', text: t('modal.hub.hide'), attr: { type: 'button' } });
        hide.setAttribute('aria-label', t('modal.hub.hideInherited', { key: this.ctx.plugin.settings.scopeKeys[field] }));
        hide.addEventListener('click', () => this.hide(field));
        this.hideButtons[field] = hide;
        const unhide = row.createEl('button', { cls: 'tv-icon-btn tv-ctrl__pill-remove task-hub__prop-remove' });
        setIcon(unhide.createSpan(), 'x');
        unhide.setAttribute('aria-label', t('modal.hub.removeNoValue', { field: t(labelKey) }));
        unhide.addEventListener('click', () => { void this.commit(field, undefined); this.refresh(); });
        this.unhideButtons[field] = unhide;

        // An item picked from the list is put in and committed; the field's
        // own Enter (bindField) commits what is typed when no list is open.
        let suggest: ValueSuggest | null = null;
        if (field === 'color') {
            const nci = this.nativeColorInput;
            nci.value = cssColorToHex(input.value, nci.ownerDocument);
            // ドラッグ中は swatch とテキストだけ更新し、nci.value への
            // 書き戻し（updateColorSwatch 内）を避ける — 書き戻すと
            // ピッカーの内部状態が壊れるフィードバックループになる
            nci.addEventListener('input', () => {
                input.value = nci.value.replace(/^#/, '');
                if (this.colorSwatch) {
                    this.colorSwatch.style.backgroundColor = nci.value;
                }
            });
            nci.addEventListener('change', () => {
                this.updateColorSwatch();
                this.bound.color.commit();
            });
            suggest = new ValueSuggest(this.ctx.app, input, {
                candidates: COLOR_VALUES.candidates,
                render: COLOR_VALUES.render,
                pick: (val) => { this.colorField.setText(val); this.updateColorSwatch(); this.bound.color.commit(); },
            });
            input.addEventListener('input', () => this.updateColorSwatch());
        } else if (field === 'linestyle') {
            suggest = new ValueSuggest(this.ctx.app, input, {
                candidates: LINE_STYLE_VALUES.candidates,
                render: LINE_STYLE_VALUES.render,
                pick: (val) => { input.value = val; this.bound.linestyle.commit(); },
            });
        }

        this.bound[field] = bindField(input, {
            codec: CODECS[field],
            // A row's own no value (`- tv-color::`) shows as no value of its own.
            current: () => this.ctx.getTask()[field] ?? undefined,
            commit: (value) => this.commit(field, value),
            issues: (issue) => this.ctx.issues.set(field, readIssue(field, issue)),
            takesEnter: () => suggest?.listShown ?? false,
            put,
        });

        this.updateDecoration(field);
    }

    private commit(field: StyleField, value: string | undefined): Promise<boolean> | void {
        if (this.ctx.isShut() || this.ctx.locked(field)) return;
        return this.ctx.queue(TaskUpdateBuilder.styleField(this.ctx.getTask(), field, value ?? ''));
    }

    /** Write the row's own no value of `field`, which hides the value it inherits. */
    private hide(field: StyleField): void {
        if (this.ctx.isShut() || this.ctx.locked(field)) return;
        void this.ctx.queue(TaskUpdateBuilder.styleHidden(this.ctx.getTask(), field));
        this.refresh();
    }

    unsaved(): UnsavedField[] {
        return FIELDS.filter(field => this.bound[field].pending()?.ok === false)
            .map(field => ({ label: t(LABEL_KEYS[field]), input: this.inputs[field] }));
    }

    discardUnsaved(): void {
        for (const field of FIELDS) if (this.bound[field].pending()?.ok === false) this.bound[field].discard();
    }

    save(): void {
        for (const field of FIELDS) if (this.bound[field].pending()?.ok) this.bound[field].commit();
    }

    /** cascade placeholder + 出所ラベル + swatch の同期 */
    private updateDecoration(field: StyleField): void {
        const input = this.inputs[field];
        const sourceEl = this.sourceEls[field];
        if (!input || !sourceEl) return;

        const task = this.ctx.getTask();
        const cascadeValue = task.cascadeContext?.[field];
        // Inherited, a value or no value (a layer above hid it); null when the row says its own.
        const source = CascadeSource.forStyleField(task, field);
        // A no value shows as such, the row's own (with its ×) or an inherited one
        // (with its source); with none of its own, the value it inherits.
        const noValue = task[field] === null || (source !== null && cascadeValue === undefined);
        input.placeholder = noValue ? t('modal.hub.noValue') : (task[field] === undefined && cascadeValue) || '';
        const hidesNothing = task[field] !== undefined || cascadeValue === undefined;
        this.hideButtons[field]?.toggleClass('is-hidden', hidesNothing);
        this.unhideButtons[field]?.toggleClass('is-hidden', task[field] !== null);

        if (source) {
            sourceEl.setText(this.ctx.sourceLabel(source));
            sourceEl.style.display = '';
        } else {
            sourceEl.setText('');
            sourceEl.style.display = 'none';
        }

        if (field === 'color') this.updateColorSwatch();
    }

    private updateColorSwatch(): void {
        if (!this.colorSwatch) return;
        const value = this.inputs.color.value.trim() || this.ctx.getTask().cascadeContext?.color || '';
        this.colorSwatch.style.backgroundColor = value
            ? (/^[0-9a-fA-F]{3,6}$/.test(value) ? `#${value}` : value)
            : 'transparent';
        this.nativeColorInput.value = cssColorToHex(value, this.nativeColorInput.ownerDocument);
    }

    /** 外部変更（echo）の取り込み。打ちかけの欄は `BoundField.set` が守る。 */
    refresh(): void {
        const task = this.ctx.getTask();
        for (const field of FIELDS) {
            this.bound[field].set(task[field] ?? undefined);
            this.updateDecoration(field);
        }
        this.showEnabled();
    }

    setEnabled(_enabled: boolean): void {
        this.showEnabled();
    }

    /** Each field takes edits unless the form is shut or a finding locks it (`FieldGroupContext.locked`). */
    private showEnabled(): void {
        const shut = this.ctx.isShut();
        this.colorField?.setEnabled(!shut && !this.ctx.locked('color'));
        for (const field of ['linestyle', 'mask'] as const) {
            const input = this.inputs[field];
            if (input) input.disabled = shut || this.ctx.locked(field);
        }
        for (const field of FIELDS) {
            const off = shut || this.ctx.locked(field);
            for (const button of [this.hideButtons[field], this.unhideButtons[field]]) if (button) button.disabled = off;
        }
    }

    focus(field: StyleField): void {
        this.inputs[field]?.focus();
    }

    getInput(field: StyleField): HTMLInputElement {
        return this.inputs[field];
    }

    /** Where the field says its issues: its input and the line under its row. */
    slot(field: StyleField): IssueSlot {
        return { input: this.inputs[field], message: this.says[field] };
    }
}
