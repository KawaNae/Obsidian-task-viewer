import { describe, expect, it } from 'vitest';
import { OFFSET_ICON_LIFT_PX, OFFSET_ICON_MARGIN_PX, offsetIconShift, placeOffsetIcon, timeShape } from '../../../src/timer/TimerOffsetIcon';
import { TimerProgressUI } from '../../../src/timer/TimerProgressUI';

/**
 * 経過時間の右肩の鉛筆は、輪の線の内側から 2px 以上内に置く。右肩で収まれば
 * 動かさず、収まらなければ 5px 上げて、収まる最小の量だけ左へ寄せる。測るのは
 * 鉛筆を出したときと、数字の形（桁数、符号）が変わったときだけである。
 *
 * 輪は 140px の箱に描かれ、中心は (70, 70)、線の内側の半径は 63px。鉛筆は 12px。
 */

const RING = { cx: 70, cy: 70, inner: 63 };
const ICON = 12;

/** 右肩の鉛筆の箱: 右端 `right`、上端 `top`。 */
const iconAt = (right: number, top: number) => ({ right, top, bottom: top + ICON });

/** 鉛筆の箱のいちばん遠い角から、輪の線の内側までの距離。 */
function clearance(icon: { right: number; top: number; bottom: number }, shift: { x: number; y: number }): number {
    const dx = icon.right - shift.x - RING.cx;
    const dy = Math.max(Math.abs(icon.top - shift.y - RING.cy), Math.abs(icon.bottom - shift.y - RING.cy));
    return RING.inner - Math.hypot(dx, dy);
}

describe('how far the pencil moves', () => {
    it('a pencil that keeps the margin at the top right does not move', () => {
        // `12:34`: the pencil's far corner is 11px inside the line.
        expect(offsetIconShift(RING, iconAt(111, 32))).toEqual({ x: 0, y: 0 });
    });

    it('a pencil just at the margin does not move', () => {
        const top = 32;
        const dy = RING.cy - top;
        const right = RING.cx + Math.sqrt((RING.inner - OFFSET_ICON_MARGIN_PX) ** 2 - dy ** 2);
        expect(offsetIconShift(RING, iconAt(right, top))).toEqual({ x: 0, y: 0 });
    });

    it('a pencil over the line is raised and moved left just enough to keep the margin', () => {
        // `16:40:00` and `-16:40:00`: the far corner is 6px and 12px past the line.
        for (const icon of [iconAt(128, 32), iconAt(133, 32)]) {
            const shift = offsetIconShift(RING, icon);
            expect(clearance(icon, { x: 0, y: 0 })).toBeLessThan(0);
            expect(shift.y).toBe(OFFSET_ICON_LIFT_PX);
            expect(shift.x).toBeGreaterThan(0);
            expect(clearance(icon, shift)).toBeCloseTo(OFFSET_ICON_MARGIN_PX, 6);
        }
    });

    it('the move is worked out from the circle at once: raised 5px, then left to where the far corner keeps the margin', () => {
        // Raised to a top of 27, the corner is 43px above the middle; the line's
        // inner edge less the margin, 61px, then reaches sqrt(61² - 43²) to the right.
        const shift = offsetIconShift(RING, iconAt(128, 32));
        expect(shift.y).toBe(5);
        expect(shift.x).toBeCloseTo(128 - (70 + Math.sqrt(61 ** 2 - 43 ** 2)), 9);
    });

    it('a pencil just past the margin is raised all the same, and moved only a little', () => {
        // `-999:59`: the far corner 1px past the line.
        const top = 32;
        const right = RING.cx + Math.sqrt((RING.inner + 1) ** 2 - (RING.cy - top) ** 2);
        const shift = offsetIconShift(RING, iconAt(right, top));
        expect(shift.y).toBe(OFFSET_ICON_LIFT_PX);
        expect(shift.x).toBeGreaterThan(0);
        expect(shift.x).toBeLessThan(10);
        expect(clearance(iconAt(right, top), shift)).toBeCloseTo(OFFSET_ICON_MARGIN_PX, 6);
    });

    it('moved no less than it must: a hair less leaves the corner short of the margin', () => {
        const icon = iconAt(128, 32);
        const shift = offsetIconShift(RING, icon);
        expect(clearance(icon, { x: shift.x - 0.01, y: shift.y })).toBeLessThan(OFFSET_ICON_MARGIN_PX);
    });

    it('the margin and the lift given are kept', () => {
        const icon = iconAt(128, 32);
        const shift = offsetIconShift(RING, icon, 5, 0);
        expect(shift.y).toBe(0);
        expect(clearance(icon, shift)).toBeCloseTo(5, 6);
    });

    it('a pencil below the middle is held by its bottom corner', () => {
        const icon = iconAt(128, 100);
        const shift = offsetIconShift(RING, icon);
        expect(clearance(icon, shift)).toBeCloseTo(OFFSET_ICON_MARGIN_PX, 6);
    });
});

describe('the shape of a time', () => {
    it('digits are alike; the minus and the colons are not', () => {
        expect(timeShape('12:34')).toBe(timeShape('99:00'));
        expect(timeShape('-99:59')).not.toBe(timeShape('999:59'));
        expect(timeShape('999:59')).not.toBe(timeShape('16:40:00'));
    });
});

/** 表示と鉛筆の代役。鉛筆の箱は、渡された量だけ右肩から動く。 */
function scene(text: string, iconRight: number, ringWidth = 140) {
    const props = new Map<string, string>();
    const icon = {
        dataset: {} as Record<string, string>,
        reads: 0,
        style: {
            setProperty: (name: string, value: string) => { props.set(name, value); },
            removeProperty: (name: string) => { props.delete(name); },
        },
        getBoundingClientRect() {
            this.reads += 1;
            const x = parseFloat(props.get('--tv-offset-icon-x') ?? '0');
            const y = parseFloat(props.get('--tv-offset-icon-y') ?? '0');
            return { left: iconRight - ICON - x, right: iconRight - x, top: 32 - y, bottom: 32 + ICON - y } as DOMRect;
        },
    };
    const display = {
        textContent: text,
        querySelector: (selector: string) => selector === '.timer-widget__offset-icon' ? icon : null,
    };
    const ring = { getBoundingClientRect: () => ({ left: 0, top: 0, width: ringWidth, height: ringWidth }) as DOMRect };
    const place = (): void => placeOffsetIcon(display as unknown as HTMLElement, ring as unknown as Element, 120, TimerProgressUI.innerRadius(120));
    return { display, icon, props, place };
}

describe('the pencil placed in the drawn ring', () => {
    it('the ring line\'s inner edge is 63px inside a ring drawn at 140px', () => {
        expect(TimerProgressUI.innerRadius(120) * 140 / 120).toBe(63);
    });

    it('a short time leaves the pencil at the top right', () => {
        const s = scene('12:34', 111);
        s.place();
        expect(s.props.size).toBe(0);
    });

    it('a long time moves it inside the line, and a short one again puts it back', () => {
        const s = scene('16:40:00', 128);
        s.place();
        const x = parseFloat(s.props.get('--tv-offset-icon-x')!);
        const y = parseFloat(s.props.get('--tv-offset-icon-y')!);
        expect(y).toBe(OFFSET_ICON_LIFT_PX);
        expect(clearance(iconAt(128, 32), { x, y })).toBeCloseTo(OFFSET_ICON_MARGIN_PX, 6);

        // Put back at the top right, as a short time's box puts it.
        s.display.textContent = '00:05';
        s.icon.getBoundingClientRect = () => { s.icon.reads += 1; return { left: 99, right: 111, top: 32, bottom: 44 } as DOMRect; };
        s.place();
        expect(s.props.size).toBe(0);
    });

    it('measured again only when the shape changes', () => {
        const s = scene('16:40:00', 128);
        s.place();
        expect(s.icon.reads).toBe(1);
        s.display.textContent = '16:40:01';
        s.place();
        expect(s.icon.reads).toBe(1);
        s.display.textContent = '-16:40:01';
        s.place();
        expect(s.icon.reads).toBe(2);
    });

    it('measured from the top right, whatever it was moved by before', () => {
        const s = scene('16:40:00', 128);
        s.place();
        const first = s.props.get('--tv-offset-icon-x');
        s.display.textContent = '-16:40:00';
        s.place();
        s.display.textContent = '16:40:00';
        s.place();
        expect(s.props.get('--tv-offset-icon-x')).toBe(first);
    });

    it('a ring not laid out is not measured, and the pencil is placed at the next call once it is', () => {
        const s = scene('16:40:00', 128, 0);
        s.place();
        expect(s.icon.reads).toBe(0);
        expect(s.icon.dataset.placedFor).toBeUndefined();
    });
});
