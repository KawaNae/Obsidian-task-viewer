import { setIcon } from 'obsidian';
import { t } from '../../i18n';

/**
 * Native picker + clear ボタン付きテキスト入力（date / time 用の共有 widget）。
 * CreateTaskModal と TaskHubForm が共用する。
 *
 * 構造:
 * - 左端: picker アイコン（透明オーバーレイの native input が直接タップを
 *   受ける — iPad WebKit Bug #261703 対応）
 * - 中央: テキスト入力（YYYY-MM-DD / HH:mm の自由入力）
 * - 右端: clear ボタン（値があるときのみ表示）
 */
export function createPickerTextField(
    container: HTMLElement,
    pickerType: 'date' | 'time',
    placeholder: string,
    initialValue: string
): HTMLInputElement {
    const wrapper = container.createDiv({ cls: 'tv-form__input-with-picker' });

    // Visual icon button (left side)
    const pickerButton = wrapper.createDiv({
        cls: 'tv-form__picker-button'
    });
    pickerButton.setAttribute('aria-label',
        pickerType === 'date' ? t('modal.openDatePicker') : t('modal.openTimePicker'));
    // WebKit は inline-flex 要素直下の SVG を描画しないことがあるため
    // span ラッパー経由で挿す（プロジェクト共通ルール）
    setIcon(pickerButton.createSpan(), pickerType === 'date' ? 'calendar' : 'clock');

    // Hidden native picker input — pointer-events: auto (CSS) so iPad users
    // can directly tap to open the native picker (WebKit Bug #261703).
    const nativePickerInput = wrapper.createEl('input', {
        cls: 'tv-form__native-picker-input'
    });
    nativePickerInput.type = pickerType;
    nativePickerInput.setAttribute('aria-hidden', 'true');
    if (pickerType === 'time') {
        nativePickerInput.step = '60';
    }

    // On click, try showPicker() for desktop browsers that need it.
    // On iPad, the direct tap on the native input already opens the picker.
    nativePickerInput.addEventListener('click', () => {
        try {
            nativePickerInput.showPicker();
        } catch {
            // iOS Safari: direct tap already opens native picker
        }
    });

    // Fallback: clicking the visual icon area behind the native input
    pickerButton.addEventListener('click', () => {
        try {
            nativePickerInput.showPicker();
        } catch {
            nativePickerInput.focus();
            nativePickerInput.click();
        }
    });

    const textInput = wrapper.createEl('input', {
        type: 'text',
        placeholder,
        cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--mono tv-ctrl__text-input--glow'
    });
    textInput.value = initialValue;

    // Clear button (right side, visible only when value exists)
    const clearButton = wrapper.createDiv({
        cls: 'tv-form__clear-button'
    });
    clearButton.setAttribute('aria-label', 'Clear');
    setIcon(clearButton.createSpan(), 'x');
    clearButton.style.display = initialValue ? '' : 'none';
    clearButton.addEventListener('click', () => {
        textInput.value = '';
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
        clearButton.style.display = 'none';
    });

    // Sync text input value → native input before picker opens
    const syncNativeValueFromText = () => {
        const value = textInput.value.trim();
        if (pickerType === 'date') {
            nativePickerInput.value = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
            return;
        }
        nativePickerInput.value = /^\d{2}:\d{2}$/.test(value) ? value : '';
    };

    // Keep native input in sync when text changes; toggle clear button visibility
    textInput.addEventListener('input', () => {
        syncNativeValueFromText();
        clearButton.style.display = textInput.value.trim() ? '' : 'none';
    });

    // Sync before the picker opens (focus = about to show picker on some platforms)
    nativePickerInput.addEventListener('focus', syncNativeValueFromText);

    // When the user picks a value from the native picker, update the text input
    nativePickerInput.addEventListener('change', () => {
        if (!nativePickerInput.value) {
            return;
        }
        textInput.value = nativePickerInput.value;
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    return textInput;
}
