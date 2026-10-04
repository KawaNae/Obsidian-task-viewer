import type { DisplayTask } from '../../types';
import { spanDates } from '../../utils/TaskDates';

/** A span this long or longer is drawn as an all-day task. */
const ALL_DAY_MS = 23.5 * 60 * 60 * 1000;

/**
 * Whether a task with a span is drawn as an all-day task: its start is a
 * bare date (a start date with no start time, or with no start an end date
 * with no end time, a due standing in for the end as `spanDates` reads it),
 * or it lasts 23h30m or more. The bare date is asked first, so a bare date
 * on a day the clock changes (23 hours) is still all day.
 */
export function isAllDay(dt: Pick<DisplayTask, 'stated' | 'span'>): boolean {
    const { startDate, startTime, endTime } = spanDates(dt.stated);
    if (startDate ? !startTime : !endTime) return true;
    return !!dt.span && dt.span.endMs - dt.span.startMs >= ALL_DAY_MS;
}

export type SectionKind = 'allDay' | 'timed' | null;

/** バケツを持つ 2 セクション（null を除いた SectionKind）。バケツキーと kind の一致を型で保証する。 */
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
 *   - null:      期間が無い（日付も期限も無い）
 *
 * 期限だけのタスクは期限から補った期間（`spanDates`）を持つので、日付の
 * 期限は allDay、時刻つきの期限は timed になる。
 */
export function classifyForSection(dt: DisplayTask): SectionKind {
    if (!dt.span) return null;
    return isAllDay(dt) ? 'allDay' : 'timed';
}

/**
 * filteredTasks をセクション別に振り分ける。同一 task が 'allDay' と 'timed' の両方に
 * 入ることは起こり得ない（render burst 修正の主目的）。
 */
export function bucketBySection(tasks: DisplayTask[]): Record<Section, DisplayTask[]> {
    const buckets: Record<Section, DisplayTask[]> = { allDay: [], timed: [] };
    for (const dt of tasks) {
        const kind = classifyForSection(dt);
        if (kind !== null) buckets[kind].push(dt);
    }
    return buckets;
}
