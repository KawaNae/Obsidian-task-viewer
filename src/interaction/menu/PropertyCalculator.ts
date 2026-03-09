import { DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

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
 * タスクプロパティの暗黙的値を計算
 *
 * DisplayTask の effective フィールドと implicit フラグを直接使用。
 * 呼び出し元（MenuHandler.showContextMenu）が toDisplayTask() で変換済み。
 *
 * README Period Calculation Rulesに従う:
 * 1. SED, SE: actual time from start to end
 * 2. SD, S-All: start day's startHour to startHour+23:59
 * 3. S-Timed: start time to +1 hour
 * 4. E, ED: implicit start derived from endDate (reverse of S/SD default duration)
 * 5. D: view's left edge date's startHour as start, start+23:59 as end
 */
export class PropertyCalculator {
    /**
     * Start プロパティの計算
     */
    calculateStart(context: PropertyCalculationContext): CalculatedProperty {
        const { task, startHour, viewStartDate } = context;

        const startHourStr = startHour.toString().padStart(2, '0') + ':00';
        const implicitVisualStartDate = viewStartDate || DateUtils.getVisualDateOfNow(startHour);

        // D type: effectiveStartDate is "" — use viewStartDate fallback
        if (!task.effectiveStartDate) {
            return {
                date: implicitVisualStartDate,
                time: startHourStr,
                dateImplicit: true,
                timeImplicit: true
            };
        }
        return {
            date: task.effectiveStartDate,
            time: task.effectiveStartTime,
            dateImplicit: task.startDateImplicit,
            timeImplicit: task.startTimeImplicit,
        };
    }

    /**
     * End プロパティの計算
     */
    calculateEnd(context: PropertyCalculationContext): CalculatedProperty {
        const { task, startHour, viewStartDate } = context;

        const endHourStr = this.calculateEndHourStr(startHour);
        const implicitVisualStartDate = viewStartDate || DateUtils.getVisualDateOfNow(startHour);

        if (task.effectiveEndDate) {
            return {
                date: task.effectiveEndDate,
                time: task.effectiveEndTime,
                dateImplicit: task.endDateImplicit,
                timeImplicit: task.endTimeImplicit,
            };
        }
        // D type or no effective end: use viewStartDate + 1day fallback
        const effectiveBase = task.effectiveStartDate || implicitVisualStartDate;
        const nextDay = DateUtils.addDays(effectiveBase, 1);
        return {
            date: nextDay,
            time: endHourStr,
            dateImplicit: true,
            timeImplicit: true
        };
    }

    /**
     * Deadline プロパティの計算
     */
    calculateDeadline(task: DisplayTask): CalculatedProperty {
        if (!task.deadline) {
            return { dateImplicit: false, timeImplicit: false, isUnset: true };
        }

        if (task.deadline.includes('T')) {
            const [date, time] = task.deadline.split('T');
            return {
                date,
                time,
                dateImplicit: false,
                timeImplicit: false
            };
        }

        return {
            date: task.deadline,
            dateImplicit: false,
            timeImplicit: false
        };
    }

    /**
     * エンド時刻を計算 (startHour + 23:59)
     */
    private calculateEndHourStr(startHour: number): string {
        let endHour = startHour - 1;
        if (endHour < 0) endHour = 23;
        return endHour.toString().padStart(2, '0') + ':59';
    }
}
