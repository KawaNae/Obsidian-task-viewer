import { setIcon } from 'obsidian';

/**
 * フォーム行の scaffold: 左固定幅ラベル列 + コントロール領域（_form.css の
 * 行文法）。コントロール領域は呼び出し側が row へ追加する。
 *
 * 行の直下に、その行の欄の誤りと注意を出す枠（`says`、`tv-form__says`）を
 * 置く。中身は `IssueBoard` が描き、空のあいだは見えない。文の始まりは
 * コントロール領域の始まりに揃う。
 */
export function createFormRow(
    container: HTMLElement,
    labelText: string,
    opts: { alignStart?: boolean; dates?: boolean; icon?: string } = {},
): { row: HTMLElement; labelEl: HTMLElement; says: HTMLElement } {
    const row = container.createDiv({ cls: 'tv-form__row' });
    if (opts.alignStart) row.addClass('tv-form__row--start');
    if (opts.dates) row.addClass('tv-form__row--dates');
    const labelEl = row.createSpan({ cls: 'tv-form__label' });
    if (opts.icon) {
        labelEl.addClass('tv-form__label--with-icon');
        setIcon(labelEl.createSpan({ cls: 'tv-form__label-icon' }), opts.icon);
    }
    labelEl.appendText(labelText);
    const says = container.createDiv({ cls: 'tv-form__says tv-form__says--row' });
    return { row, labelEl, says };
}
