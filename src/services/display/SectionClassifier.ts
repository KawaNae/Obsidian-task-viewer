import type { DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

export type SectionKind = 'allDay' | 'timed' | 'dueOnly' | null;

/** バケツを持つ 3 セクション（null を除いた SectionKind）。バケツキーと kind の一致を型で保証する。 */
export type Section = Exclude<SectionKind, null>;

/**
 * Single source of truth for "which section does this DisplayTask belong to?".
 *
 * GridRenderer が `bucketBySection` 経由でこの関数を使う（AllDaySectionRenderer は
 * GridRenderer が済ませた分類結果をそのまま受け取る）。TaskDateCategorizer は
 * DateUtils.isAllDayTask を直接使う独自実装で、この関数は経由していない。
 * 個別実装にすると 23.5h 境界などで判定がドリフトし、同じ task が複数セクションに
 * 描画されて DOM 上で同じ data-id が重複する原因となる。
 *
 * 戻り値:
 *   - 'allDay':  effectiveStartTime 不在 or duration ≥ 23.5h
 *   - 'timed':   startTime あり、duration < 23.5h
 *   - 'dueOnly': start/end 不在で due のみ
 *   - null:      どのセクションにも属さない
 */
export function classifyForSection(dt: DisplayTask, startHour: number): SectionKind {
    if (!dt.effectiveStartDate && !dt.startDate && !dt.endDate) {
        return dt.due ? 'dueOnly' : null;
    }
    if (!dt.effectiveStartDate) return null;

    if (DateUtils.isAllDayTask(
        dt.effectiveStartDate,
        dt.effectiveStartTime,
        dt.effectiveEndDate,
        dt.effectiveEndTime,
        startHour,
    )) {
        return 'allDay';
    }

    if (!dt.effectiveStartTime) return null;
    return 'timed';
}

/**
 * filteredTasks をセクション別に振り分ける。同一 task が 'allDay' と 'timed' の両方に
 * 入ることは起こり得ない（render burst 修正の主目的）。
 *
 * 注意: timeline view において dueOnly バケツは GridRenderer で timed と一緒に
 * timeline 側へ流すが、TimelineSectionRenderer が `effectiveStartTime` 不在を skip するため
 * **現状 timeline view では描画されない**（既知の既存挙動）。schedule view 側は別経路で描画。
 */
export function bucketBySection(
    tasks: DisplayTask[],
    startHour: number,
): Record<Section, DisplayTask[]> {
    const buckets: Record<Section, DisplayTask[]> = { allDay: [], timed: [], dueOnly: [] };
    for (const dt of tasks) {
        const kind = classifyForSection(dt, startHour);
        if (kind !== null) buckets[kind].push(dt);
    }
    return buckets;
}
