import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { ImplicitCalendarDateResolver } from '../../utils/ImplicitCalendarDateResolver';

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
 * 4. E, ED: implicit start derived from endDate (reverse of S/SD default duration)
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
        const implicitVisualStartDate = viewStartDate || DateUtils.getVisualDateOfNow(startHour);

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
            // Auto-derived: startDate undefined
            // E/ED types: derive from endDate via ImplicitCalendarDateResolver
            const implicit = ImplicitCalendarDateResolver.resolveImplicitStart(task, startHour);
            if (implicit) {
                return {
                    date: implicit.startDate,
                    time: implicit.startTime || startHourStr,
                    dateImplicit: true,
                    timeImplicit: !implicit.startTime,
                };
            }

            if (hasStartTime) {
                // Time-only notation: startTime is explicit but date is inherited/implicit
                return {
                    date: task.startDate || implicitVisualStartDate,
                    time: task.startTime,
                    dateImplicit: true,
                    timeImplicit: false
                };
            } else {
                // D types: implicit date and implicit time
                return {
                    date: implicitVisualStartDate,
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
        const hasEndTime = task.explicitEndTime ?? false;

        const endHourStr = this.calculateEndHourStr(startHour);
        const implicitVisualStartDate = viewStartDate || DateUtils.getVisualDateOfNow(startHour);
        const implicit = !task.startDate ? ImplicitCalendarDateResolver.resolveImplicitStart(task, startHour) : null;
        const effectiveVisualStartDate = task.startDate || implicit?.startDate || implicitVisualStartDate;

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
                date: effectiveVisualStartDate,
                time: task.endTime,
                dateImplicit: true,
                timeImplicit: false
            };
        }

        // Case 3-4: Derive implicit end via resolveImplicitEnd (S-Timed, S-All, SD, D types)
        const implicitEnd = ImplicitCalendarDateResolver.resolveImplicitEnd(
            { startDate: effectiveVisualStartDate, startTime: task.startTime, endDate: undefined, endTime: undefined },
            startHour
        );
        if (implicitEnd) {
            return {
                date: implicitEnd.endDate,
                time: implicitEnd.endTime || endHourStr,
                dateImplicit: true,
                timeImplicit: true
            };
        }

        // D type (no startDate): use effectiveVisualStartDate + 1day as fallback
        const nextDay = DateUtils.addDays(effectiveVisualStartDate, 1);
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
