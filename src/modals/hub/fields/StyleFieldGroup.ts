import { t } from '../../../i18n';
import { VALID_LINE_STYLES } from '../../../constants/style';
import { filterColors, renderColorSuggestion } from '../../../suggest/color/colorUtils';
import { filterLineStyles, renderLineStyleSuggestion } from '../../../suggest/line/lineStyleUtils';
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
import type { FieldGroupContext } from './FieldGroupContext';

type StyleField = 'color' | 'linestyle' | 'mask';

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
export class StyleFieldGroup {
    private colorField!: PickerTextField;
    private colorSwatch!: HTMLElement;
    private nativeColorInput!: HTMLInputElement;
    private readonly inputs = {} as Record<StyleField, HTMLInputElement>;
    private readonly bound = {} as Record<StyleField, BoundField<string | undefined>>;
    private readonly says = {} as Record<StyleField, HTMLElement>;
    private sourceEls: Partial<Record<StyleField, HTMLElement>> = {};

    constructor(container: HTMLElement, private ctx: FieldGroupContext) {
        this.renderRow(container, 'color', 'modal.hub.color');
        this.renderRow(container, 'linestyle', 'modal.hub.linestyle');
        this.renderRow(container, 'mask', 'modal.hub.mask');
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
        sourceEl.addEventListener('click', () => this.ctx.jumpToFile());
        this.sourceEls[field] = sourceEl;

        // The list's Enter is put on first: it puts the item in, and the
        // field's Enter (bindField) commits it (10f makes this one piece).
        if (field === 'color') {
            const nci = this.nativeColorInput;
            nci.value = this.resolveColorForPicker(input.value);
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
            this.ctx.attachSuggest(input, input, {
                getCandidates: (q) => (q.trim() === '' ? filterColors('', 20) : filterColors(q)),
                renderItem: (item, val) => renderColorSuggestion(val, item),
                onPick: (val) => { input.value = val; this.updateColorSwatch(); this.bound.color.commit(); },
            });
            input.addEventListener('input', () => this.updateColorSwatch());
        } else if (field === 'linestyle') {
            this.ctx.attachSuggest(input, input, {
                getCandidates: (q) => filterLineStyles(q),
                renderItem: (item, val) => renderLineStyleSuggestion(val, item),
                onPick: (val) => { input.value = val; this.bound.linestyle.commit(); },
            });
        }

        this.bound[field] = bindField(input, {
            codec: CODECS[field],
            current: () => this.ctx.getTask()[field],
            commit: (value) => this.commit(field, value),
            issues: (issue) => this.ctx.issues.set(field, readIssue(field, issue)),
            put,
        });

        this.updateDecoration(field);
    }

    private commit(field: StyleField, value: string | undefined): void {
        if (this.ctx.isShut()) return;
        this.ctx.queue(TaskUpdateBuilder.styleField(this.ctx.getTask(), field, value ?? ''));
    }

    /** cascade placeholder + 出所ラベル + swatch の同期 */
    private updateDecoration(field: StyleField): void {
        const input = this.inputs[field];
        const sourceEl = this.sourceEls[field];
        if (!input || !sourceEl) return;

        const task = this.ctx.getTask();
        const cascadeValue = task.cascadeContext?.[field];
        input.placeholder = (task[field] === undefined && cascadeValue) || '';

        const keys = this.ctx.plugin.settings.scopeKeys;
        const source = CascadeSource.forStyleField(this.ctx.app, task, keys, field);
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
        this.nativeColorInput.value = this.resolveColorForPicker(value);
    }

    private resolveColorForPicker(raw: string): string {
        const v = raw.trim();
        if (!v) return '#000000';
        if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`;
        if (/^[0-9a-fA-F]{3}$/.test(v)) {
            return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
        }
        // CSS 色名 → canvas で正規化（'red' → '#ff0000'）
        const ctx = document.createElement('canvas').getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#000000';
            ctx.fillStyle = v;
            return ctx.fillStyle;
        }
        return '#000000';
    }

    /** 外部変更（echo）の取り込み。打ちかけの欄は `BoundField.set` が守る。 */
    refresh(): void {
        const task = this.ctx.getTask();
        for (const field of ['color', 'linestyle', 'mask'] as const) {
            this.bound[field].set(task[field]);
            this.updateDecoration(field);
        }
    }

    setEnabled(enabled: boolean): void {
        this.colorField?.setEnabled(enabled);
        for (const input of [this.inputs.linestyle, this.inputs.mask]) {
            if (input) input.disabled = !enabled;
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
