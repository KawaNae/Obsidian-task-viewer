/**
 * タイマーの操作ボタン 1 個。ウィジェットと独立ビューで同じ形を組む。
 *
 * アイコンは **span ラッパー経由**で入れる。WebKit は inline-flex ボタン直下の
 * SVG を描画しない（既知の iPad 制約）ので、これを崩すとアイコンが消える。
 * ラベルとの間隔は CSS の gap が持つ（文字列の先頭に空白を入れない）。
 */

import { setIcon } from 'obsidian';

export type ControlButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ControlButtonOptions {
    /** BEM のブロック名。`timer-widget` / `timer-view`。 */
    block: string;
    /**
     * 見た目の変種。独立ビューは開始、一時停止、リセットを色で分ける。
     * ウィジェットのボタンは1つの見た目なので渡さない（修飾のクラスが付かない）。
     */
    variant?: ControlButtonVariant;
    icon: string;
    label: string;
    onClick: () => void;
    /** 置き場所ごとの追加クラス（`timer-widget__next-start` など）。 */
    extraClass?: string;
}

export function createControlButton(
    container: HTMLElement,
    options: ControlButtonOptions,
): HTMLButtonElement {
    const { block, variant, icon, label, onClick, extraClass } = options;

    const btn = container.createEl('button', {
        cls: [`${block}__btn`, variant && `${block}__btn--${variant}`, extraClass].filter(Boolean).join(' '),
    });
    setIcon(btn.createSpan({ cls: `${block}__btn-icon` }), icon);
    btn.createSpan({ text: label });
    btn.onclick = onClick;
    return btn;
}
