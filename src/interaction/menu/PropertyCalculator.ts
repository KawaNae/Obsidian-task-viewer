import { Task, DisplayTask } from '../../types';
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
 * DisplayTask が渡された場合は effective フィールドと implicit フラグを直接使用。
 * raw Task の場合は従来通り ImplicitCalendarDateResolver で計算。
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
        const dt = task as Partial<DisplayTask>;

        const startHourStr = startHour.toString().padStart(2, '0') + ':00';
        const implicitVisualStartDate = viewStartDate || DateUtils.getVisualDateOfNow(startHour);

        // DisplayTask path: use effective fields + implicit flags
        if (dt.effectiveStartDate !== undefined) {
            // D type: effectiveStartDate is "" — use viewStartDate fallback
            if (!dt.effectiveStartDate) {
                return {
                    date: implicitVisualStartDate,
                    time: startHourStr,
                    dateImplicit: true,
                    timeImplicit: true
                };
            }
            return {
                date: dt.effectiveStartDate,
                time: dt.effectiveStartTime || startHourStr,
                dateImplicit: dt.startDateImplicit ?? false,
                timeImplicit: dt.startTimeImplicit ?? !dt.effectiveStartTime,
            };
        }

        // Fallback: raw Task path (legacy)
        const hasExplicitStart = !!task.startDate && !task.startDateInherited;
        const hasStartTime = !!task.startTime;

        if (hasExplicitStart) {
            if (hasStartTime) {
                return {
                    date: task.startDate,
                    time: task.startTime,
                    dateImplicit: false,
                    timeImplicit: false
                };
            } else {
                return {
                    date: task.startDate,
                    time: startHourStr,
                    dateImplicit: false,
                    timeImplicit: true
                };
            }
        } else {
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
                return {
                    date: task.startDate || implicitVisualStartDate,
                    time: task.startTime,
                    dateImplicit: true,
                    timeImplicit: false
                };
            } else {
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
        const dt = task as Partial<DisplayTask>;

        const endHourStr = this.calculateEndHourStr(startHour);
        const implicitVisualStartDate = viewStartDate || DateUtils.getVisualDateOfNow(startHour);

        // DisplayTask path: use effective fields + implicit flags
        if (dt.effectiveStartDate !== undefined) {
            if (dt.effectiveEndDate) {
                return {
                    date: dt.effectiveEndDate,
                    time: dt.effectiveEndTime || endHourStr,
                    dateImplicit: dt.endDateImplicit ?? false,
                    timeImplicit: dt.endTimeImplicit ?? !dt.effectiveEndTime,
                };
            }
            // D type or no effective end: use viewStartDate + 1day fallback
            const effectiveBase = dt.effectiveStartDate || implicitVisualStartDate;
            const nextDay = DateUtils.addDays(effectiveBase, 1);
            return {
                date: nextDay,
                time: endHourStr,
                dateImplicit: true,
                timeImplicit: true
            };
        }

        // Fallback: raw Task path (legacy)
        const hasExplicitEnd = !!task.endDate;
        const hasEndTime = !!task.endTime;

        const implicit = !task.startDate ? ImplicitCalendarDateResolver.resolveImplicitStart(task, startHour) : null;
        const effectiveVisualStartDate = task.startDate || implicit?.startDate || implicitVisualStartDate;

        if (hasExplicitEnd) {
            if (hasEndTime) {
                return {
                    date: task.endDate,
                    time: task.endTime,
                    dateImplicit: false,
                    timeImplicit: false
                };
            } else {
                return {
                    date: task.endDate,
                    time: endHourStr,
                    dateImplicit: false,
                    timeImplicit: true
                };
            }
        }

        if (hasEndTime) {
            return {
                date: effectiveVisualStartDate,
                time: task.endTime,
                dateImplicit: true,
                timeImplicit: false
            };
        }

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
