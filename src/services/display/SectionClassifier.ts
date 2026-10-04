import type { DisplayTask } from '../../types';

/** A span this long or longer is drawn as an all-day task. */
const ALL_DAY_MS = 23.5 * 60 * 60 * 1000;

/**
 * Whether a task with a span is drawn as an all-day task: its start is a
 * bare date (a start date with no start time, or with no start an end date
 * with no end time), or it lasts 23h30m or more. The bare date is asked
 * first, so a bare date on a day the clock changes (23 hours) is still all
 * day.
 */
export function isAllDay(dt: Pick<DisplayTask, 'stated' | 'span'>): boolean {
    const { startDate, startTime, endTime } = dt.stated;
    if (startDate ? !startTime : !endTime) return true;
    return !!dt.span && dt.span.endMs - dt.span.startMs >= ALL_DAY_MS;
}

export type SectionKind = 'allDay' | 'timed' | 'dueOnly' | null;

/** バケツを持つ 3 セクション（null を除いた SectionKind）。バケツキーと kind の一致を型で保証する。 */
export type Section = Exclude<SectionKind, null>;

/**
 * Single source of truth for "which section does this DisplayTask belong to?".
 *
 * kind（種別）の決定木はこの関数だけが持つ。消費者は 2 系統:
 * GridRenderer が `bucketBySection` 経由でセクション振り分けに使い
 * （AllDaySectionRenderer は分類済みの結果を受け取る）、
 * TaskDateCategorizer が `placeTask` 経由で kind + 日付所属の合成に使う。
 * 個別実装にすると 23.5h 境界などで判定がドリフトし、同じ task が複数セクションに
 * 描画される原因となる。
 * 日付所属（どの visual/calendar 日付に入るか）は TaskDateCategorizer、
 * バケツ内の描画順は TaskRenderOrder が所有する。
 *
 * 戻り値:
 *   - 'allDay':  {@link isAllDay}（開始が日付だけ、または長さ ≥ 23.5h）
 *   - 'timed':   開始時刻あり、長さ < 23.5h
 *   - 'dueOnly': 期間が無く、その行に due がある
 *   - null:      どのセクションにも属さない
 */
export function classifyForSection(dt: DisplayTask): SectionKind {
    if (!dt.span) return dt.due ? 'dueOnly' : null;
    return isAllDay(dt) ? 'allDay' : 'timed';
}

/**
 * filteredTasks をセクション別に振り分ける。同一 task が 'allDay' と 'timed' の両方に
 * 入ることは起こり得ない（render burst 修正の主目的）。
 *
 * どのセクションを描くかは消費者が決める。Timeline（GridRenderer）は allDay と
 * timed だけを描き、dueOnly は描かない。Schedule は TaskDateCategorizer 経由で
 * 3 つとも描く。
 */
export function bucketBySection(tasks: DisplayTask[]): Record<Section, DisplayTask[]> {
    const buckets: Record<Section, DisplayTask[]> = { allDay: [], timed: [], dueOnly: [] };
    for (const dt of tasks) {
        const kind = classifyForSection(dt);
        if (kind !== null) buckets[kind].push(dt);
    }
    return buckets;
}
