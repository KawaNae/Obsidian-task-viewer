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
    options: GhostOptions = {}
): HTMLElement {
    const { initiallyVisible = false, useCloneNode = false } = options;

    // 要素の作成
    let ghost: HTMLElement;
    if (useCloneNode) {
        ghost = el.cloneNode(true) as HTMLElement;
    } else {
        ghost = doc.createElement('div');
        ghost.innerHTML = el.innerHTML;
    }

    ghost.addClass('drag-ghost');

    // サイズ取得
    const rect = el.getBoundingClientRect();

    // 基本スタイル
    ghost.style.position = 'fixed';
    ghost.style.zIndex = '2147483647';
    ghost.style.pointerEvents = 'none';
    ghost.style.opacity = initiallyVisible ? '0.9' : '0';
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.boxSizing = 'border-box';
    ghost.style.margin = '0';
    ghost.style.overflow = 'hidden';
    ghost.style.display = 'block';

    // 視覚スタイル（元要素からコピー or フォールバック）
    const computedStyle = el.ownerDocument.defaultView?.getComputedStyle(el);
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

    // 初期位置（画面外）
    ghost.style.left = '-9999px';
    ghost.style.top = '-9999px';

    // DOMに追加
    doc.body.appendChild(ghost);

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
