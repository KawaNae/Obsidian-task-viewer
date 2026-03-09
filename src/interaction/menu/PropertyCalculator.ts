import { DisplayTask } from '../../types';

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
 * 5. D: no start/end — marked as unset
 */
export class PropertyCalculator {
    /**
     * Start プロパティの計算
     */
    calculateStart(context: PropertyCalculationContext): CalculatedProperty {
        const { task } = context;

        // D type: effectiveStartDate is "" — no start, mark as unset
        if (!task.effectiveStartDate) {
            return { dateImplicit: false, timeImplicit: false, isUnset: true };
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
        const { task } = context;

        if (task.effectiveEndDate) {
            return {
                date: task.effectiveEndDate,
                time: task.effectiveEndTime,
                dateImplicit: task.endDateImplicit,
                timeImplicit: task.endTimeImplicit,
            };
        }
        // D type or no effective end: mark as unset
        return { dateImplicit: false, timeImplicit: false, isUnset: true };
    }

    /**
     * Due プロパティの計算
     */
    calculateDue(task: DisplayTask): CalculatedProperty {
        if (!task.due) {
            return { dateImplicit: false, timeImplicit: false, isUnset: true };
        }

        if (task.due.includes('T')) {
            const [date, time] = task.due.split('T');
            return {
                date,
                time,
                dateImplicit: false,
                timeImplicit: false
            };
        }

        return {
            date: task.due,
            dateImplicit: false,
            timeImplicit: false
        };
    }
}
