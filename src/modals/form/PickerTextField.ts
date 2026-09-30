import { setIcon } from 'obsidian';
import { t } from '../../i18n';

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
}

/**
 * ネイティブのピッカーを開くボタンと、テキストの入力を1つの枠に収めた欄。
 * 日付、時刻（{@link createPickerTextField}）と色（StyleFieldGroup）が使う。
 *
 * 構造:
 * - 左端: ピッカーのボタン。その上に透明なネイティブの input が重なり、
 *   iPad ではそれが直接タップを受ける（WebKit Bug #261703）
 * - 中央: テキストの入力（自由入力）
 * - 右端: × のボタン（clearable のとき。値があるときだけ出す）
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

    constructor(container: HTMLElement, opts: PickerTextFieldOptions) {
        this.el = container.createDiv({ cls: opts.cls ? `tv-form__input-with-picker ${opts.cls}` : 'tv-form__input-with-picker' });

        this.pickerButton = this.el.createEl('button', { cls: 'tv-form__picker-button', attr: { type: 'button' } });
        this.pickerButton.setAttribute('aria-label', opts.pickerLabel);
        // WebKit は inline-flex 要素直下の SVG を描画しないことがあるため
        // span ラッパー経由で挿す（プロジェクト共通ルール）
        setIcon(this.pickerButton.createSpan(), opts.icon);

        // 見えないネイティブの input。キーボードではボタンが代わりに受けるので、
        // タブの順に入れない
        this.picker = this.el.createEl('input', { cls: 'tv-form__native-picker-input' });
        this.picker.type = opts.type;
        this.picker.tabIndex = -1;
        this.picker.setAttribute('aria-hidden', 'true');
        if (opts.type === 'time') this.picker.step = '60';

        // desktop では showPicker() で開く。iPad では直接のタップで既に開いている
        this.picker.addEventListener('click', () => {
            try { this.picker.showPicker(); } catch { /* iOS Safari: the tap opened it */ }
        });
        this.pickerButton.addEventListener('click', () => {
            try {
                this.picker.showPicker();
            } catch {
                this.picker.focus();
                this.picker.click();
            }
        });

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
                this.input.value = '';
                this.input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            this.clearButton = clear;
            const showClear = () => { clear.style.display = this.input.value.trim() ? '' : 'none'; };
            this.input.addEventListener('input', showClear);
            showClear();
        } else {
            this.clearButton = null;
        }
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
): PickerTextField {
    const field = new PickerTextField(container, {
        type: pickerType,
        icon: pickerType === 'date' ? 'calendar' : 'clock',
        pickerLabel: pickerType === 'date' ? t('modal.openDatePicker') : t('modal.openTimePicker'),
        placeholder,
        initialValue,
        clearable: true,
    });
    const { input, picker } = field;
    const format = pickerType === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{2}:\d{2}$/;

    // テキストの値をピッカーへ写す。ピッカーが開く前（focus）にも写す
    const syncPickerFromText = () => {
        const value = input.value.trim();
        picker.value = format.test(value) ? value : '';
    };
    input.addEventListener('input', syncPickerFromText);
    picker.addEventListener('focus', syncPickerFromText);

    // ピッカーで選んだ値をテキストへ入れる
    picker.addEventListener('change', () => {
        if (!picker.value) return;
        input.value = picker.value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    return field;
}
