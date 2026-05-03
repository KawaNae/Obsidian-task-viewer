/**
 * Ghost Element Factory
 * ドラッグ操作時の「浮遊カード」（ゴースト要素）を生成・管理するユーティリティ
 */

export interface GhostOptions {
    /** true: opacity 0.9（即表示）, false: opacity 0（後で表示） */
    initiallyVisible?: boolean;
    /** true: cloneNode使用, false: createElement + innerHTML（デフォルト） */
    useCloneNode?: boolean;
}

/**
 * ゴースト要素を作成する
 * @param el 元となる要素
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
    const { initiallyVisible = false, useCloneNode = false } = options;

    // 要素の作成
    let ghost: HTMLElement;
    if (useCloneNode) {
        ghost = el.cloneNode(true) as HTMLElement;
        // Remove handles from cloned ghost (they shouldn't appear on ghost)
        ghost.querySelectorAll('.task-card__handle').forEach(h => h.remove());
    } else {
        ghost = doc.createElement('div');
        ghost.innerHTML = el.innerHTML;
    }

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

    // 視覚スタイル: task-card は `.task-card__shape` 子要素が bg / border-radius
    // / box-shadow / mask を持つため host 側に inline で重ねる必要はない。
    // 非 task-card な要素 (legacy / 他用途) には fallback を残す。
    const computedStyle = el.ownerDocument.defaultView?.getComputedStyle(el);
    const hasShape = !!ghost.querySelector('.task-card__shape');
    if (!hasShape) {
        const bg = computedStyle?.backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== '') {
            ghost.style.backgroundColor = bg;
            ghost.style.color = computedStyle?.color || '';
            ghost.style.border = computedStyle?.border || '';
            ghost.style.borderRadius = computedStyle?.borderRadius || '4px';
            ghost.style.padding = computedStyle?.padding || '4px';
            ghost.style.fontSize = computedStyle?.fontSize || '';
            ghost.style.fontFamily = computedStyle?.fontFamily || '';
        } else {
            // 透明な要素の場合はフォールバック色を適用
            ghost.style.backgroundColor = 'var(--background-secondary, #333)';
            ghost.style.border = '1px solid var(--interactive-accent, #7c3aed)';
            ghost.style.color = 'var(--text-normal, #eee)';
            ghost.style.padding = '8px';
        }
        // 影効果
        ghost.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.5)';
    } else {
        // task-card ghost: layout 用の padding/font だけ host から継承する
        // (新 div の場合 .task-card 自体の CSS 規則が適用されないため)
        ghost.style.padding = computedStyle?.padding || '';
        ghost.style.fontSize = computedStyle?.fontSize || '';
        ghost.style.fontFamily = computedStyle?.fontFamily || '';
        ghost.style.color = computedStyle?.color || '';
    }

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
