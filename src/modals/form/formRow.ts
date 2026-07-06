/**
 * フォーム行の scaffold: 左固定幅ラベル列 + コントロール領域（_form.css の
 * 行文法）。TaskHubForm と DateFieldGroup が共有する。コントロール領域は
 * 呼び出し側が row へ追加する。
 */
export function createFormRow(
    container: HTMLElement,
    labelText: string,
    opts: { alignStart?: boolean; dates?: boolean } = {},
): { row: HTMLElement; labelEl: HTMLElement } {
    const row = container.createDiv({ cls: 'tv-form__row' });
    if (opts.alignStart) row.addClass('tv-form__row--start');
    if (opts.dates) row.addClass('tv-form__row--dates');
    const labelEl = row.createSpan({ text: labelText, cls: 'tv-form__label' });
    return { row, labelEl };
}
