import { DateUtils } from '../../../utils/DateUtils';
import type { GhostPlan } from '../ghost/GhostPlan';
import type { GridSurface, GridSurfaceTarget, LocatePointerOpts, PlanSegmentsInput } from './GridSurface';
import { HANDLE_HYSTERESIS_PX } from './GridSurface';

/**
 * Timeline view 内の `.allday-section` (1 section + N-col grid) 用の
 * {@link GridSurface} 実装。
 *
 * Calendar との違い:
 *   - row が 1 つしかない（week 切替なし）
 *   - view 範囲は context provider から取得（getViewStartDate / getViewEndDate）
 *   - clamp が必要（task が view と完全に切り離れると selection が消える）
 */
export class AllDayGridSurface implements GridSurface {
    constructor(
        private readonly container: HTMLElement,
        private readonly getViewStartDate: () => string,
        private readonly getViewEndDate: () => string,
    ) {}

    /**
     * AllDay の locatePointer。Calendar と違い row は単一なので、X 軸を colWidth で
     * 等分してダイレクトに col を計算する。
     *
     * `opts.resizeDirection` 指定時は handle CSS offset (`-12px`) と subpixel rounding
     * の合成で発生する境界 drift を `HANDLE_HYSTERESIS_PX` で吸収する。
     *   - dir='right': handle 中心が `card.right` (= 表示最終セルの右端 = 次セルの左端)
     *     に乗るため、naive `floor(x/W)` だと境界丁度で次セル idx を返してしまう。
     *     `floor((x - HYST)/W)` でセル右端から HYST 以内を前セル扱いにして吸収。
     *   - dir='left' : handle 中心が `card.left` (= 開始セルの左端 = 前セルの右端) に
     *     乗るが、uniform grid 上で naive floor は境界丁度で開始セル idx を返すため
     *     drift は subpixel `clientX = card.left - ε` の場合のみ発生し commit 経路の
     *     `boundedStart` clamp で 1 日分を吸収できる。AllDay では追加のヒステリシスを
     *     入れない（入れると shrink 方向で boundary 手前 HYST から早期にスナップして
     *     しまう）。calendar の findIndex 版は非 uniform DOMRect 用の補正で、
     *     uniform grid 上では同 strict が naive と差を生まないため対称性は維持される。
     */
    locatePointer(clientX: number, _clientY: number, opts: LocatePointerOpts = {}): GridSurfaceTarget | null {
        const section = this.getSection();
        if (!section) return null;
        const headerCell = this.getReferenceHeaderCell();
        const colWidth = headerCell?.getBoundingClientRect().width || 100;
        const baseLeft = headerCell?.getBoundingClientRect().left ?? section.getBoundingClientRect().left;
        const viewStart = this.getViewStartDate();
        if (!viewStart) return null;

        const xInArea = clientX - baseLeft;
        const dir = opts.resizeDirection ?? null;

        const idx = dir === 'right'
            ? Math.floor((xInArea - HANDLE_HYSTERESIS_PX) / colWidth)
            : Math.floor(xInArea / colWidth);

        const col = Math.max(1, idx + 1); // 1-based
        const targetDate = DateUtils.addDays(viewStart, col - 1);

        return {
            rowEl: section,
            col,
            colWidth,
            targetDate,
        };
    }

    planSegments(input: PlanSegmentsInput): GhostPlan[] {
        const section = this.getSection();
        if (!section) return [];

        const { rangeStart, rangeEnd, trackIndex } = input;
        const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
        const end = rangeStart <= rangeEnd ? rangeEnd : rangeStart;
        const viewStart = this.getViewStartDate();
        const viewEnd = this.getViewEndDate();
        if (!viewStart || !viewEnd) return [];
        if (end < viewStart || start > viewEnd) return [];

        const clippedStart = start < viewStart ? viewStart : start;
        const clippedEnd = end > viewEnd ? viewEnd : end;
        const colStartIdx = DateUtils.getDiffDays(viewStart, clippedStart);
        const span = DateUtils.getDiffDays(clippedStart, clippedEnd) + 1;
        if (span < 1) return [];

        const splitClasses: string[] = [];
        if (start < viewStart) splitClasses.push('task-card--split-continues-before');
        if (end > viewEnd) splitClasses.push('task-card--split-continues-after');

        return [{
            layout: 'grid',
            parent: section,
            // axis col(+1) + grid 1-based(+1) = +2
            gridColumn: `${colStartIdx + 2} / span ${span}`,
            // row 1 が padding なので +2
            gridRow: `${trackIndex + 2}`,
            splitClasses,
        }];
    }

    clampDayDelta(dayDelta: number, rangeStart: string, rangeEnd: string): number {
        const viewStart = this.getViewStartDate();
        const viewEnd = this.getViewEndDate();
        if (!viewStart || !viewEnd) return dayDelta;
        // movedEnd >= viewStart  → dayDelta >= viewStart - rangeEnd
        const minDelta = DateUtils.getDiffDays(rangeEnd, viewStart);
        // movedStart <= viewEnd  → dayDelta <= viewEnd - rangeStart
        const maxDelta = DateUtils.getDiffDays(rangeStart, viewEnd);
        return Math.max(minDelta, Math.min(maxDelta, dayDelta));
    }

    getColWidth(): number {
        const headerCell = this.getReferenceHeaderCell();
        return headerCell?.getBoundingClientRect().width || 100;
    }

    /**
     * AllDay → Timeline cross-view drop の検出。pointer 直下に
     * `.timeline-scroll-area__day-column` があれば、その day-column を返す。
     */
    canCrossToTimeline(clientX: number, clientY: number, doc: Document): HTMLElement | null {
        const el = doc.elementFromPoint(clientX, clientY);
        return (el?.closest('.timeline-scroll-area__day-column') as HTMLElement | null) ?? null;
    }

    private getSection(): HTMLElement | null {
        return this.container.querySelector('.allday-section') as HTMLElement | null;
    }

    /**
     * 参照基点として 2 番目の date-header__cell を使う (1 番目は axis col)。
     * timeline-grid が祖先に存在する前提で AllDaySectionRenderer と同じ index。
     */
    private getReferenceHeaderCell(): HTMLElement | null {
        const grid = this.container.querySelector('.timeline-grid');
        return (grid?.querySelector('.date-header__cell:nth-child(2)') as HTMLElement | null) ?? null;
    }
}
