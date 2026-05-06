import type { Component } from 'obsidian';

/**
 * 「タップ意図」を click event 1 つに正規化する薄い helper。
 *
 * native の `dblclick` や pointerup ベースの自前 dbltap 検出は **使わない**:
 *   - Android Chromium が touch 後に発生させる synthesized click は
 *     pointerup の中で modal を開くと `.modal-bg` にリターゲットされる
 *     (= 開いた直後に閉じる元凶)。
 *   - click event 自体は touch sequence 終了後の境界なので、click handler
 *     内で modal を同期 open しても safe (CreateTaskModal が Menu の
 *     onClick callback で safe に open しているのと同じ条件)。
 *
 * `bindTapIntents` は click を 1 本だけ listen し、`threshold` 以内に同一
 * 要素上で 2 連 click が来たときだけ `onDoubleTap` を発火する。`targetFilter`
 * で除外したい子要素 (link / checkbox / handle 等) を一元管理する。
 *
 * Component を渡せば cleanup を card lifecycle に紐付ける。渡さない場合は
 * 戻り値の unbind を手動で呼ぶこと。
 */
export interface TapIntents {
    onDoubleTap: () => void;
}

export interface BindTapIntentsOptions {
    /** target filter that returns false to ignore the click (e.g. links, checkboxes, drag handles). */
    targetFilter?: (target: HTMLElement) => boolean;
    /** double-tap window in ms. default 400. */
    threshold?: number;
    /** if provided, register(unbind) so the listener is removed on component unload. */
    component?: Component;
}

const DEFAULT_THRESHOLD_MS = 400;

export function bindTapIntents(
    el: HTMLElement,
    intents: TapIntents,
    opts: BindTapIntentsOptions = {},
): () => void {
    const threshold = opts.threshold ?? DEFAULT_THRESHOLD_MS;
    const targetFilter = opts.targetFilter;
    // Sentinel that makes the first `now - lastClickAt < threshold` always
    // false. A literal `0` would mistakenly count as "just clicked at epoch"
    // when Date.now() is near 0 (vi.setSystemTime in tests).
    let lastClickAt = Number.NEGATIVE_INFINITY;

    const onClick = (e: MouseEvent) => {
        const t = e.target as HTMLElement | null;
        if (!t) return;
        if (targetFilter && !targetFilter(t)) return;
        const now = Date.now();
        if (now - lastClickAt < threshold) {
            lastClickAt = Number.NEGATIVE_INFINITY;
            // Suppress browser-level text selection that follows a 2nd click
            // (native dblclick would do this implicitly; we substitute).
            e.preventDefault();
            intents.onDoubleTap();
        } else {
            lastClickAt = now;
        }
    };

    el.addEventListener('click', onClick);
    const unbind = () => el.removeEventListener('click', onClick);
    opts.component?.register(unbind);
    return unbind;
}
