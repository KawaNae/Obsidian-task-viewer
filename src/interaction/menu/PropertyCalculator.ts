import { DateUtils } from '../../utils/DateUtils';
import type { DisplayTask } from '../../types';
import { sideValues, type SideValue } from '../../utils/TaskDates';

export interface CalculatedProperty {
    date?: string;
    time?: string;
    dateImplicit: boolean;
    timeImplicit: boolean;
    isUnset?: boolean;
}

export interface PropertyCalculationContext {
    task: DisplayTask;
    startHour: number;
    viewStartDate: string | null;
}

/**
 * タスクの開始、終了、期限をメニューに出す値。行に書かれた値は普通の字で、
 * 書かれていない値（受け継いだ値、規則が作る値）は薄字で出す。値はハブの
 * 薄字と同じ `sideValues` が作り、書いた値と同じ精度で、書き写せば同じ意味に
 * なる（日付だけの値に時刻を付けない）。
 */
export class PropertyCalculator {
    /** Start プロパティの計算 */
    calculateStart(context: PropertyCalculationContext): CalculatedProperty {
        const sides = sideValues(context.task, context.startHour);
        return sides ? shown(sides.start) : UNSET;
    }

    /** End プロパティの計算 */
    calculateEnd(context: PropertyCalculationContext): CalculatedProperty {
        const sides = sideValues(context.task, context.startHour);
        return sides ? shown(sides.end) : UNSET;
    }

    /**
     * Due プロパティの計算。cascade 継承 due (raw due なし) は implicit 扱いで
     * 表示する。超過の判定と同じ due を見せることで食い違いを防ぐ。
     */
    calculateDue(task: DisplayTask): CalculatedProperty {
        const due = task.stated.due;
        if (!due) return UNSET;
        const inherited = !task.due;
        const { date, time } = DateUtils.splitDateTime(due);
        return time !== undefined
            ? { date, time, dateImplicit: inherited, timeImplicit: inherited }
            : { date: due, dateImplicit: inherited, timeImplicit: inherited };
    }
}

const UNSET: CalculatedProperty = { dateImplicit: false, timeImplicit: false, isUnset: true };

function shown(side: SideValue): CalculatedProperty {
    const value: CalculatedProperty = { dateImplicit: !side.dateWritten, timeImplicit: !side.timeWritten };
    if (side.date) value.date = side.date;
    if (side.time) value.time = side.time;
    return value;
}
