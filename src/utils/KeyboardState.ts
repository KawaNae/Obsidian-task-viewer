/**
 * window ごとの仮想キーボード状態の共有ストア。
 *
 * 検知源は二本立て（詳細は KeyboardAwareContainer のコメント参照）:
 * - visualViewport — Windows / Safari 系。オンデマンドで計算でき、常駐
 *   リスナー不要
 * - Capacitor Keyboard events — Obsidian mobile (Android/iOS)。イベントが
 *   来た瞬間の高さを保持する必要があるため、window ごとに常駐リスナーを
 *   trackKeyboard() で一度だけ張る
 *
 * KeyboardAwareContainer（タスクハブの入力退避）と PopoverShell（suggest の
 * 上下反転）が同じキーボード上端を見るための単一情報源。
 */

interface TrackedHandlers {
    show: (e: Event) => void;
    hide: () => void;
}

const nativeHeights = new WeakMap<Window, number>();
const tracked = new Map<Window, TrackedHandlers>();

/** Capacitor keyboard イベントの購読を開始（window ごとに一度だけ・常駐） */
export function trackKeyboard(win: Window): void {
    if (tracked.has(win)) return;
    const show = (e: Event) => {
        const h = (e as Event & { keyboardHeight?: number }).keyboardHeight;
        if (typeof h === 'number' && h > 0) nativeHeights.set(win, h);
    };
    const hide = () => {
        nativeHeights.set(win, 0);
    };
    win.addEventListener('keyboardWillShow', show);
    win.addEventListener('keyboardDidShow', show);
    win.addEventListener('keyboardWillHide', hide);
    win.addEventListener('keyboardDidHide', hide);
    tracked.set(win, { show, hide });
}

/** 全 window の常駐リスナーを外す（plugin unload 用） */
export function untrackAllKeyboards(): void {
    for (const [win, h] of tracked) {
        win.removeEventListener('keyboardWillShow', h.show);
        win.removeEventListener('keyboardDidShow', h.show);
        win.removeEventListener('keyboardWillHide', h.hide);
        win.removeEventListener('keyboardDidHide', h.hide);
    }
    tracked.clear();
}

/** Capacitor が報告した現在のキーボード高さ（px、閉時/非対応環境は 0） */
export function nativeKeyboardHeight(win: Window): number {
    return nativeHeights.get(win) ?? 0;
}

/**
 * キーボード上端の client Y 座標。両検知源のうち低い（=厳しい）方。
 * キーボードなしなら innerHeight。
 */
export function keyboardTop(win: Window): number {
    const vv = win.visualViewport;
    const vvTop = vv ? vv.offsetTop + vv.height : Infinity;
    const native = nativeHeights.get(win) ?? 0;
    const nativeTop = native > 0 ? win.innerHeight - native : Infinity;
    const top = Math.min(vvTop, nativeTop);
    return top === Infinity ? win.innerHeight : top;
}
