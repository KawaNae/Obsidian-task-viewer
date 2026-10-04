import { DateUtils } from '../../utils/DateUtils';
import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import { createNativePicker } from '../../views/sharedUI/NativePicker';

export type PickerType = 'date' | 'time' | 'color';

export interface PickerTextFieldOptions {
    type: PickerType;
    icon: string;
    /** The picker button's name, read out for it. */
    pickerLabel: string;
    placeholder?: string;
    initialValue: string;
    /** A button at the right end that empties the text, shown while it holds a value. */
    clearable: boolean;
    /** Classes added to the field's box. */
    cls?: string;
    /** The clear button emptied the text (the text is empty when it is called). */
    onClear?: () => void;
}

/**
 * ネイティブのピッカーを開くボタンと、テキストの入力を1つの枠に収めた欄。
 * 日付、時刻（{@link createPickerTextField}）と色（StyleFieldGroup）が使う。
 *
 * 構造:
 * - 左端: ピッカーのボタン。その上に透明なネイティブの input が重なり、
 *   モバイルではそれが直接タップを受ける（{@link createNativePicker}）
 * - 中央: テキストの入力（自由入力）
 * - 右端: × のボタン（clearable のとき。値があるときだけ出す）
 *
 * 値が入る道は3つで、どれもイベントを投げない。打った字は欄の `input`、
 * × は `onClear`、ピッカーの選択は持ち主（{@link createPickerTextField} の
 * `onPick`）が知らせる。外から値を入れるのは {@link setText} で、× の表示と
 * ピッカーの値をテキストに合わせる。
 *
 * 欄は有効か無効かを1つの状態として持つ（{@link setEnabled}）。無効の欄では、
 * テキストもボタンもネイティブの input も `disabled` になり、押しても、
 * タップしても、キーボードでも値を変えられない。
 */
export class PickerTextField {
    readonly el: HTMLElement;
    readonly input: HTMLInputElement;
    /** The native picker. Its value is kept in step with the text by whoever owns the field. */
    readonly picker: HTMLInputElement;
    private readonly pickerButton: HTMLButtonElement;
    private readonly clearButton: HTMLButtonElement | null;
    /** The picker's value from the text, as the owner reads it; set by {@link createPickerTextField}. */
    syncPicker: (() => void) | null = null;

    constructor(container: HTMLElement, opts: PickerTextFieldOptions) {
        this.el = container.createDiv({ cls: opts.cls ? `tv-form__input-with-picker ${opts.cls}` : 'tv-form__input-with-picker' });

        this.pickerButton = this.el.createEl('button', { cls: 'tv-form__picker-button', attr: { type: 'button' } });
        this.pickerButton.setAttribute('aria-label', opts.pickerLabel);
        // WebKit は inline-flex 要素直下の SVG を描画しないことがあるため
        // span ラッパー経由で挿す（プロジェクト共通ルール）
        setIcon(this.pickerButton.createSpan(), opts.icon);

        // 見えないネイティブの input をボタンに重ねる（NativePicker）
        this.picker = createNativePicker(this.el, this.pickerButton, {
            type: opts.type,
            cls: 'tv-form__native-picker-input',
        });
        if (opts.type === 'time') this.picker.step = '60';

        this.input = this.el.createEl('input', {
            type: 'text',
            cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow',
        });
        if (opts.placeholder !== undefined) this.input.placeholder = opts.placeholder;
        this.input.value = opts.initialValue;

        if (opts.clearable) {
            // × はタブの順に入れない（テキストは選んで消せる）。欄のタブの止まり
            // 位置は、ピッカーのボタンとテキストの2つのまま
            const clear = this.el.createEl('button', { cls: 'tv-form__clear-button', attr: { type: 'button' } });
            clear.tabIndex = -1;
            clear.setAttribute('aria-label', t('modal.clear'));
            setIcon(clear.createSpan(), 'x');
            clear.addEventListener('click', () => {
                this.setText('');
                opts.onClear?.();
            });
            this.clearButton = clear;
        } else {
            this.clearButton = null;
        }
        this.input.addEventListener('input', () => this.syncText());
        this.syncText();
    }

    /** Put `text` in the field, the clear button and the picker in step with it, firing no event. */
    setText(text: string): void {
        this.input.value = text;
        this.syncText();
    }

    /** What follows the text: the clear button shown while it holds a value. The owner keeps the picker (`syncPicker`). */
    private syncText(): void {
        if (this.clearButton) this.clearButton.style.display = this.input.value.trim() ? '' : 'none';
        this.syncPicker?.();
    }

    /** The text, the picker and its button, and the clear button, taking input or not together. */
    setEnabled(enabled: boolean): void {
        this.input.disabled = !enabled;
        this.picker.disabled = !enabled;
        this.pickerButton.disabled = !enabled;
        if (this.clearButton) this.clearButton.disabled = !enabled;
    }
}

/**
 * 日付、時刻の欄。テキストは YYYY-MM-DD、HH:mm の自由入力で、ピッカーで選んだ値は
 * テキストに入る。CreateTaskModal と TaskHubForm が DateFieldGroup を通して使う。
 */
export function createPickerTextField(
    container: HTMLElement,
    pickerType: 'date' | 'time',
    placeholder: string,
    initialValue: string,
    hooks: {
        /** A value was picked: the text holds it when this is called. */
        onPick?: (value: string) => void;
        /** The clear button emptied the text. */
        onClear?: () => void;
    } = {},
): PickerTextField {
    const field = new PickerTextField(container, {
        type: pickerType,
        icon: pickerType === 'date' ? 'calendar' : 'clock',
        pickerLabel: pickerType === 'date' ? t('modal.openDatePicker') : t('modal.openTimePicker'),
        placeholder,
        initialValue,
        clearable: true,
        onClear: hooks.onClear,
    });
    const { input, picker } = field;
    const matchesShape = pickerType === 'date' ? DateUtils.isDateShape : DateUtils.isTimeShape;

    // テキストの値をピッカーへ写す。ピッカーが開く前（focus）にも写す
    field.syncPicker = () => {
        const value = input.value.trim();
        picker.value = matchesShape(value) ? value : '';
    };
    field.syncPicker();
    picker.addEventListener('focus', field.syncPicker);

    // ピッカーで選んだ値をテキストへ入れ、選んだと知らせる
    picker.addEventListener('change', () => {
        if (!picker.value) return;
        field.setText(picker.value);
        hooks.onPick?.(picker.value);
    });

    return field;
}
