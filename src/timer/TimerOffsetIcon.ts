/**
 * 経過時間の右肩の鉛筆を、輪の線の内側に収める。
 *
 * 鉛筆は数字の箱の右上の角の外に置く（`_timer-widget.css` の
 * `.timer-widget__offset-icon`）。輪は 140px で変わらず、数字の字も変えないので、
 * 長い表示（`16:40:00`、超過の `-999:59`）では右肩の鉛筆が輪の線にかかる。その
 * ときだけ、鉛筆を収まる所まで左へ寄せる。寄せた鉛筆は最後の桁の真上に来て、
 * 上げなければ鉛筆の先が桁の上の端に接するので、寄せるときは 5px 上げ、上げた
 * 高さで寄せる量を出す。5px 上げると、鉛筆の描線と字の間は秒の桁によらず
 * 5px ほど空く。収まる表示では右肩のままにする。
 *
 * 寄せる量は描いた鉛筆と輪を測って式で出す（{@link offsetIconShift}）。測るのは
 * 鉛筆を出したときと、数字の形が変わったとき（{@link timeShape}）だけで、tick は
 * layout を読まない。
 */

/** 鉛筆が輪の線の内側から離れる間（px）。 */
export const OFFSET_ICON_MARGIN_PX = 2;
/** 寄せるときに鉛筆を上げる高さ（px）。最後の桁の上の端と鉛筆の先を離す。 */
export const OFFSET_ICON_LIFT_PX = 5;

/** 輪の線の内側の円（中心と半径、px）。 */
export interface RingCircle {
    cx: number;
    cy: number;
    inner: number;
}

/** 鉛筆を右肩から動かす量（px）。`x` は左へ、`y` は上へ。 */
export interface OffsetIconShift {
    x: number;
    y: number;
}

const NO_SHIFT: OffsetIconShift = { x: 0, y: 0 };

/**
 * 右肩に置いた鉛筆の箱 `icon` を、輪の線の内側から `margin` 以上内に入れる動かし方。
 * 右肩で収まれば動かさない。収まらなければ `lift` だけ上げ、その高さで箱の
 * いちばん遠い角が収まる最小の量だけ左へ寄せる。鉛筆は輪の中心より右にある。
 */
export function offsetIconShift(
    ring: RingCircle,
    icon: Pick<DOMRect, 'top' | 'right' | 'bottom'>,
    margin = OFFSET_ICON_MARGIN_PX,
    lift = OFFSET_ICON_LIFT_PX,
): OffsetIconShift {
    const limit = ring.inner - margin;
    const farY = (top: number, bottom: number): number => Math.max(Math.abs(top - ring.cy), Math.abs(bottom - ring.cy));
    if (Math.hypot(icon.right - ring.cx, farY(icon.top, icon.bottom)) <= limit) return NO_SHIFT;
    const dy = farY(icon.top - lift, icon.bottom - lift);
    const reach = Math.sqrt(Math.max(0, limit * limit - dy * dy));
    return { x: Math.max(0, icon.right - (ring.cx + reach)), y: lift };
}

/**
 * 鉛筆の置き場所を決める数字の形: 数字はどれも同じ幅（`tabular-nums`）なので
 * 0 にそろえ、符号とコロンは残す。
 */
export function timeShape(text: string): string {
    return text.replace(/\d/g, '0');
}

/**
 * 表示 `display` の鉛筆を、輪 `ring`（view box の一辺が `size`、線の内側の半径が
 * view box で `inner`）の内側に置く。鉛筆を置いた数字の形を鉛筆に覚え、同じ形なら
 * 何も読まない。輪がまだ描かれていなければ（幅が 0）、次に呼ばれたときに置く。
 */
export function placeOffsetIcon(display: HTMLElement, ring: Element, size: number, inner: number): void {
    const icon = display.querySelector('.timer-widget__offset-icon') as HTMLElement | null;
    if (!icon) return;
    const shape = timeShape(display.textContent ?? '');
    if (icon.dataset.placedFor === shape) return;

    const ringRect = ring.getBoundingClientRect();
    if (ringRect.width === 0) return;
    icon.style.removeProperty('--tv-offset-icon-x');
    icon.style.removeProperty('--tv-offset-icon-y');
    const shift = offsetIconShift({
        cx: ringRect.left + ringRect.width / 2,
        cy: ringRect.top + ringRect.height / 2,
        inner: inner * ringRect.width / size,
    }, icon.getBoundingClientRect());
    if (shift.x > 0 || shift.y > 0) {
        icon.style.setProperty('--tv-offset-icon-x', `${shift.x}px`);
        icon.style.setProperty('--tv-offset-icon-y', `${shift.y}px`);
    }
    icon.dataset.placedFor = shape;
}
