/**
 * Long-press (touch) と contextmenu (mouse) を統一して扱うバインダ。
 *
 * Task に依存しないので、任意の HTMLElement に長押しで何かを発火する仕組みを付けられる。
 * 既存の TouchEventHandler (Task ハードコード) と TimelineSectionRenderer の自前実装を統合する。
 */
export interface LongPressOptions {
    /** 長押し閾値 (ms)。getter なので設定変更後も最新値を読める */
    getThreshold: () => number;

    /**
     * イベント発火対象を絞る述語。指定すると `e.target` がこの条件を満たすときだけ発火する。
     * 例: 親要素にバインドして直接の clicks のみ反応させたいときに `t => t === el` を渡す。
     */
    targetCheck?: (target: EventTarget | null) => boolean;

    /** 長押し成立時 (touchstart からの閾値経過後) に呼ばれる */
    onLongPress: (x: number, y: number) => void;

    /** マウス contextmenu 時に呼ばれる。preventDefault は binder 側で行う */
    onContextMenu?: (e: MouseEvent) => void;
}

export class TouchLongPressBinder {
    /**
     * 指定要素に touch 長押しと contextmenu のハンドラを付ける。
     */
    static bind(el: HTMLElement, opts: LongPressOptions): { dispose: () => void } {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const cancel = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        };

        const onTouchStart = (e: TouchEvent) => {
            cancel();
            if (opts.targetCheck && !opts.targetCheck(e.target)) return;
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            const x = touch.clientX;
            const y = touch.clientY;
            timer = setTimeout(() => {
                opts.onLongPress(x, y);
            }, opts.getThreshold());
        };

        const onTouchEnd = () => cancel();
        const onTouchMove = () => cancel();

        const onContextMenu = (e: MouseEvent) => {
            if (opts.targetCheck && !opts.targetCheck(e.target)) return;
            e.preventDefault();
            if (opts.onContextMenu) {
                opts.onContextMenu(e);
            } else {
                opts.onLongPress(e.clientX, e.clientY);
            }
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchend', onTouchEnd, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: true });
        el.addEventListener('contextmenu', onContextMenu);

        return {
            dispose: () => {
                cancel();
                el.removeEventListener('touchstart', onTouchStart);
                el.removeEventListener('touchend', onTouchEnd);
                el.removeEventListener('touchmove', onTouchMove);
                el.removeEventListener('contextmenu', onContextMenu);
            },
        };
    }
}
