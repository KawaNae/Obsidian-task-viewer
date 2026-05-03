import type { GhostPlan } from '../strategies/BaseDragStrategy';

/**
 * locatePointer が返す target 情報。Calendar は週単位の row、AllDay は単一の
 * `.allday-section` を `rowEl` に詰める。`weekStart` は Calendar 用 (週開始日)。
 */
export interface GridSurfaceTarget {
    rowEl: HTMLElement;
    /** rowEl 内の 1-based 列番号 (Calendar: 1-7、AllDay: 1..daysToShow) */
    col: number;
    /** col に対応する visual date */
    targetDate: string;
    /** 1 列の幅 (px)。fallback 計算は Surface が内部で済ませる */
    colWidth: number;
    /** Calendar の場合のみ。AllDay は undefined */
    weekStart?: string;
}

export interface LocatePointerOpts {
    /**
     * Resize 中の hysteresis 適用に使う。`null` または省略は move/click 等で
     * hysteresis 無効。
     */
    resizeDirection?: 'left' | 'right' | null;
    /**
     * `elementFromPoint` の前に一時的に `pointer-events: none` にする要素 (drag 中の
     * source card など)。複数 row に跨る Calendar で source card が pointer を
     * 遮るのを避けるため。
     */
    suppressEl?: HTMLElement | null;
}

export interface PlanSegmentsInput {
    /** inclusive visual start date */
    rangeStart: string;
    /** inclusive visual end date */
    rangeEnd: string;
    /** cascade row index (dragEl.dataset.trackIndex) */
    trackIndex: number;
}

/**
 * Calendar / AllDay に共通する grid 系 surface の interface。
 *
 * Surface が知るのは「自分の DOM 構造をどう読み解くか」だけ。Strategy は viewType に
 * 応じて Surface 実装を選び、locatePointer / planSegments / clampDayDelta /
 * getColWidth を呼び分ける。これにより `BaseDragStrategy` から calendar 専用
 * ヘルパー 10 個と allday の plan/clamp ロジックが消え、 Strategy の viewType-switch
 * を実装ではなく合成で表現できる足場ができる。
 */
export interface GridSurface {
    /**
     * pointer (clientX, clientY) からこの surface 上の target row/col/date を解決。
     * surface 範囲外なら null。
     */
    locatePointer(clientX: number, clientY: number, opts?: LocatePointerOpts): GridSurfaceTarget | null;

    /**
     * Stage-1: 指定された visual range を、この surface 上の rowEl 単位の
     * GhostPlan[] に切り出す。view 範囲外は除外、跨ぎは split-continues-* で
     * 表現する。
     */
    planSegments(input: PlanSegmentsInput): GhostPlan[];

    /**
     * AllDay は単一 view なので task が view と切り離れる drag を許すと
     * selection が消える。task が view と少なくとも 1 日重なるよう dayDelta を
     * clamp する。Calendar は week-rows が複数あるので no-op。
     */
    clampDayDelta(dayDelta: number, rangeStart: string, rangeEnd: string): number;

    /** 1 列の幅 (px)。move drag の x 軸スケーリングなどに使う代表値。 */
    getColWidth(): number;

    /**
     * Cross-view drop の検出 (optional)。Surface が「自分のサーフェスから別の
     * サーフェスへ抜けるドロップ」をサポートするときに実装する。AllDay は
     * Timeline へのドロップを許す (timed task 化) ため AllDayGridSurface のみ
     * 実装する。Calendar は内側で完結するので未実装。
     *
     * 戻り値: ドロップ先の DOM 要素 (例: .timeline-scroll-area__day-column)、
     *         サーフェス内ならば null。
     */
    canCrossToTimeline?(clientX: number, clientY: number, doc: Document): HTMLElement | null;
}
