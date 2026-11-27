import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import { placeFocus } from '../../views/sharedUI/FocusPlacement';
import { ownControl, pressKey } from '../../views/sharedUI/PressCommit';

/** What a {@link ClearButton} does as it is pressed. */
export interface ClearButtonOptions {
    /** Empty the field: its text is '' once this returns. */
    clear: () => void;
    /**
     * Whether the field keeps the focus, or takes it, once it is emptied, so
     * that what is typed next goes in it: the press does not take the focus
     * from the field, and the field is focused after the clear. Without it
     * the field does not keep the focus (a date's or a time's ×, whose
     * picker beside it gives the value as often as typing does): a press on
     * a field in focus leaves it the focus until `clear` has committed the
     * field emptied, so that its blur does not first commit what was typed,
     * and then takes the focus out of it; a press on a field out of focus
     * is a button's as any other.
     */
    focusesField: boolean;
    /** What the button is called (`aria-label`): "Clear" when none is given. */
    label?: string;
    /** The button's key among the buttons of its surface (`pressKey`), where a commit can build it anew. */
    key?: string;
}

/**
 * The × at the end of a text field of a form, which empties it: shown while
 * the field holds a value, out of the Tab order (the text can be selected
 * and deleted by keys), and disabled while the field is. It stands in the
 * field's box (`tv-form__clearable`, `_form.css`), over the field's end,
 * which the field's text keeps clear of.
 *
 * It follows what is typed in the field; a value put in by script, with no
 * `input` event, is followed once the owner calls {@link sync}, as is the
 * field's being disabled.
 */
export class ClearButton {
    private readonly button: HTMLButtonElement;

    constructor(box: HTMLElement, private readonly input: HTMLInputElement, opts: ClearButtonOptions) {
        box.addClass('tv-form__clearable');
        this.button = box.createEl('button', { cls: 'tv-form__clear-button', attr: { type: 'button' } });
        this.button.tabIndex = -1;
        this.button.setAttribute('aria-label', opts.label ?? t('modal.clear'));
        if (opts.key !== undefined) pressKey(this.button, opts.key);
        // The field's own: a surface that commits a field before a press (`holdPresses`) leaves its × to this rule.
        ownControl(this.button, input);
        // WebKit は inline-flex 要素直下の SVG を描画しないことがあるため span 経由で挿す
        setIcon(this.button.createSpan(), 'x');
        // mousedown の既定の動きがフォーカスをボタンへ移す。止めると欄に残り、
        // 候補の一覧も、iPad のキーボードも欄のまま続く。欄にフォーカスがある
        // ときは、欄へ置かない × でも止める。移ると欄の blur が打った字を先に
        // 確定し、× の確定と合わせて 2 回書くためである
        this.button.addEventListener('mousedown', (e) => {
            if (opts.focusesField || input.ownerDocument.activeElement === input) e.preventDefault();
        });
        this.button.addEventListener('click', () => {
            opts.clear();
            this.sync();
            if (opts.focusesField) placeFocus({ to: input });
            // 空にして確定した後に、押した動きが移すはずだったフォーカスを欄から外す。キーボードを閉じる
            else if (input.ownerDocument.activeElement === input) input.blur();
        });
        input.addEventListener('input', () => this.sync());
        this.sync();
    }

    /** Shown while the field holds a value, and taking a press while the field takes input. */
    sync(): void {
        this.button.style.display = this.input.value.trim() ? '' : 'none';
        this.button.disabled = this.input.disabled;
    }
}

/**
 * A text field in a form row (`createFormRow`), in its box with a
 * {@link ClearButton} that empties it as deleting its text does: the value
 * '' and an `input` event, which whoever listens to the field (its owner,
 * its list of candidates) meets as it meets the user's typing. The focus
 * stays in the field, to type on. The note and the heading fields of the
 * send and the section dialogs, and of the hub on a task to make, are such
 * fields.
 */
export function createClearableInput(row: HTMLElement, placeholder: string): { input: HTMLInputElement; clear: ClearButton } {
    const box = row.createDiv({ cls: 'tv-form__control' });
    const input = box.createEl('input', {
        type: 'text',
        cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow',
        placeholder,
    });
    const clear = new ClearButton(box, input, {
        clear: () => {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        },
        focusesField: true,
    });
    return { input, clear };
}
