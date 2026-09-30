export interface NativePickerOptions {
    type: 'date' | 'time' | 'color';
    /** Classes added to the input, for the caller's CSS to place it. */
    cls: string;
}

/**
 * The platform's own picker (`<input type="date|time|color">`), laid unseen
 * over the button that stands for it. The forms' date, time and color fields
 * (PickerTextField) use it.
 *
 * One layout serves every platform; only what takes the tap differs, and CSS
 * decides that (`input.tv-native-picker` in _controls.css):
 * - Desktop: the input lets the pointer through. The button takes the click
 *   and opens the picker with `showPicker()`.
 * - Mobile (`.is-mobile`): the input takes the tap itself. iOS and iPadOS
 *   refuse `showPicker()` (WebKit Bug #261703) and open the picker only for
 *   a tap on the input, so the tap has to land on it.
 *
 * So the picker opens only from the button, never from afar (a command, a
 * menu item, a double-click): on iOS, nothing but the tap reaches it.
 *
 * The parent must be the positioned box the input covers; the caller's CSS
 * gives the input its place in it. Returns the input, for the caller to read
 * and set its value.
 */
export function createNativePicker(
    parent: HTMLElement,
    button: HTMLButtonElement,
    opts: NativePickerOptions,
): HTMLInputElement {
    const input = parent.createEl('input', { cls: `tv-native-picker ${opts.cls}`, type: opts.type });
    // The keyboard reaches the picker through the button, so the input stays
    // out of the tab order and out of what a screen reader reads.
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');

    const open = () => {
        try {
            input.showPicker();
        } catch {
            // showPicker wants a user gesture and a recent engine; failing
            // that, the best left is to hand the input a click.
            input.focus();
            input.click();
        }
    };
    button.addEventListener('click', open);

    // A tap on the input (mobile). Android opens the picker with showPicker;
    // on iOS the tap has already opened it and showPicker throws.
    input.addEventListener('click', () => {
        try { input.showPicker(); } catch { /* iOS: the tap opened it */ }
    });

    return input;
}
