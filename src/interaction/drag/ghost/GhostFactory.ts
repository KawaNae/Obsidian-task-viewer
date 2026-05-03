/**
 * Ghost Element Factory
 * ドラッグ操作時の「浮遊カード」（ゴースト要素）を生成・管理するユーティリティ
 */

export interface GhostOptions {
    /** true: opacity 0.9（即表示）, false: opacity 0（後で表示） */
    initiallyVisible?: boolean;
}

/**
 * ゴースト要素を作成する
 * @param el 元となる要素 (.task-card 前提)
 * @param doc 対象のDocument
 * @param options オプション設定
 * @returns 作成されたゴースト要素
 */
export function createGhostElement(
    el: HTMLElement,
    doc: Document,
    options: GhostOptions = {},
    container?: HTMLElement
): HTMLElement {
    const { initiallyVisible = false } = options;

    const ghost = el.cloneNode(true) as HTMLElement;
    // Remove handles from cloned ghost (they shouldn't appear on ghost)
    ghost.querySelectorAll('.task-card__handle').forEach(h => h.remove());

    // Selection は ghost には不要 (selection 枠が ghost 上で描かれるのを防ぐ)
    ghost.classList.remove('is-selected', 'is-dragging');
    ghost.addClass('task-card--drag-ghost');

    // サイズ取得
    const rect = el.getBoundingClientRect();

    // 基本スタイル
    ghost.style.position = container ? 'absolute' : 'fixed';
    ghost.style.zIndex = 'var(--z-task-card-drag-ghost, 9999)';
    ghost.style.pointerEvents = 'none';
    if (!initiallyVisible) ghost.classList.add('is-drag-hidden');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.boxSizing = 'border-box';
    ghost.style.margin = '0';
    ghost.style.overflow = 'hidden';
    ghost.style.display = 'block';

    // task-card ghost: bg / border-radius / box-shadow / mask は子の
    // `.task-card__shape` が CSS 規則で持つ。host 側は layout 用の
    // padding/font だけ host から継承する。
    const computedStyle = el.ownerDocument.defaultView?.getComputedStyle(el);
    ghost.style.padding = computedStyle?.padding || '';
    ghost.style.fontSize = computedStyle?.fontSize || '';
    ghost.style.fontFamily = computedStyle?.fontFamily || '';
    ghost.style.color = computedStyle?.color || '';

    // 初期位置（画面外）
    ghost.style.left = '-9999px';
    ghost.style.top = '-9999px';

    // DOMに追加
    if (container) {
        container.appendChild(ghost);
    } else {
        doc.body.appendChild(ghost);
    }

    return ghost;
}

/**
 * ゴースト要素を削除する
 * @param ghost 削除するゴースト要素
 */
export function removeGhostElement(ghost: HTMLElement | null): void {
    if (ghost) {
        ghost.remove();
    }
}
