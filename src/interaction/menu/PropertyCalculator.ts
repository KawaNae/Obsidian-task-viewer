import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

export interface CalculatedProperty {
    date?: string;
    time?: string;
    dateImplicit: boolean;
    timeImplicit: boolean;
    isUnset?: boolean;
}

export interface PropertyCalculationContext {
    task: Task;
    startHour: number;
    viewStartDate: string | null;
}

/**
 * タスクプロパティの暗黙的値を計算
 * 
 * README Period Calculation Rulesに従う:
 * 1. SED, SE: actual time from start to end
 * 2. SD, S-All: start day's startHour to startHour+23:59
 * 3. S-Timed: start time to +1 hour
 * 4. E, ED: view's left edge date's startHour as start
 * 5. D: view's left edge date's startHour as start, start+23:59 as end
 */
export class PropertyCalculator {
    /**
     * Start プロパティの計算
     */
    calculateStart(context: PropertyCalculationContext): CalculatedProperty {
        const { task, startHour, viewStartDate } = context;
        const hasExplicitStart = task.explicitStartDate ?? false;
        const hasStartTime = task.explicitStartTime ?? false;

        const startHourStr = startHour.toString().padStart(2, '0') + ':00';
        const implicitStartDate = viewStartDate || DateUtils.getVisualDateOfNow(startHour);

        if (hasExplicitStart) {
            if (hasStartTime) {
                // SED-Timed, SE-Timed, S-Timed: explicit start date and time
                return {
                    date: task.startDate,
                    time: task.startTime,
                    dateImplicit: false,
                    timeImplicit: false
                };
            } else {
                // SD, S-All, SE, SED (Long-term): explicit date, implicit time = startHour
                return {
                    date: task.startDate,
                    time: startHourStr,
                    dateImplicit: false,
                    timeImplicit: true
                };
            }
        } else {
            // Auto-derived: startDate undefined → view's left edge (E, ED, D types)
            if (hasStartTime) {
                // Time-only notation: startTime is explicit but date is inherited/implicit
                return {
                    date: task.startDate || implicitStartDate,
                    time: task.startTime,
                    dateImplicit: true,
                    timeImplicit: false
                };
            } else {
                // E, ED, D types: implicit date and implicit time
                return {
                    date: implicitStartDate,
                    time: startHourStr,
                    dateImplicit: true,
                    timeImplicit: true
                };
            }
        }
    }

    /**
     * End プロパティの計算
     */
    calculateEnd(context: PropertyCalculationContext): CalculatedProperty {
        const { task, startHour, viewStartDate } = context;
        const hasExplicitStart = task.explicitStartDate ?? false;
        const hasExplicitEnd = task.explicitEndDate ?? false;
        const hasStartTime = task.explicitStartTime ?? false;
        const hasEndTime = task.explicitEndTime ?? false;

        const endHourStr = this.calculateEndHourStr(startHour);
        const implicitStartDate = viewStartDate || DateUtils.getVisualDateOfNow(startHour);
        const effectiveStartDate = task.startDate || implicitStartDate;

        // Case 1: Explicit end date + time
        if (hasExplicitEnd) {
            if (hasEndTime) {
                return {
                    date: task.endDate,
                    time: task.endTime,
                    dateImplicit: false,
                    timeImplicit: false
                };
            } else {
                // SE, SED (Long-term): explicit date, implicit time
                return {
                    date: task.endDate,
                    time: endHourStr,
                    dateImplicit: false,
                    timeImplicit: true
                };
            }
        }

        // Case 2: Has endTime but no endDate
        if (hasEndTime) {
            return {
                date: effectiveStartDate,
                time: task.endTime,
                dateImplicit: true,
                timeImplicit: false
            };
        }

        // Case 3: S-Timed - implicit end = start + 1 hour
        if (hasStartTime && !hasEndTime) {
            const [h, m] = task.startTime!.split(':').map(Number);
            let endH = h + 1;
            const endM = m;
            let endDateStr = effectiveStartDate;
            if (endH >= 24) {
                endH -= 24;
                endDateStr = DateUtils.addDays(effectiveStartDate, 1);
            }
            const implicitEndTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
            return {
                date: endDateStr,
                time: implicitEndTime,
                dateImplicit: true,
                timeImplicit: true
            };
        }

        // Case 4: No endDate and no endTime (SD, S-All, D types)
        const nextDay = DateUtils.addDays(effectiveStartDate, 1);
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
    calculateDeadline(task: Task): CalculatedProperty {
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
