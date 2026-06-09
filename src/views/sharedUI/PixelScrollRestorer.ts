/**
 * ピクセル値ベースのスクロール位置の保存・復元。
 *
 * Schedule / Calendar が同一の機構を別々に実装していたものを一本化する。
 * render 冒頭で {@link save}、render 完了後に {@link restore} を呼ぶ。restore は
 * 次フレームで適用し、その間は save を抑制する（自分が書き戻した scrollTop を
 * 保存し返さないため）。scrollToNow のような「保存位置の復元ではない」スクロールは
 * {@link runGuarded} で同じ抑制下に置ける。
 *
 * scroll 要素は selector がビューごとに異なり、再 render で DOM が差し替わるため、
 * 値を保持せず毎回 getScrollEl() で取り直す。
 *
 * 時間アンカーで保存する Timeline は座標系も rAF パス数も異なるため対象外（意図的）。
 */
export class PixelScrollRestorer {
    private saved: number | null = null;
    private pending = false;

    constructor(private readonly getScrollEl: () => HTMLElement | null) { }

    /** 現在のスクロール位置を保存する（復元適用中はスキップ）。 */
    save(): void {
        if (this.pending) return;
        const el = this.getScrollEl();
        if (el) this.saved = el.scrollTop;
    }

    /** 保存位置があれば次フレームで復元する。 */
    restore(): void {
        if (this.saved === null) return;
        const target = this.saved;
        this.pending = true;
        requestAnimationFrame(() => {
            this.pending = false;
            const el = this.getScrollEl();
            if (el) el.scrollTop = target;
        });
    }

    /**
     * 任意のスクロール操作を「保存抑制 + 次フレーム」で実行する。
     * scrollToNow など、保存位置の復元ではないスクロールに使う。
     */
    runGuarded(action: () => void): void {
        this.pending = true;
        requestAnimationFrame(() => {
            this.pending = false;
            action();
        });
    }
}
