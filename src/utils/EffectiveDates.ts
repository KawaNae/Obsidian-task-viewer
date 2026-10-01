import type { EffectiveDates, Task } from '../types';
import { DateUtils } from './DateUtils';

/**
 * The dates a task covers once its implicit values are resolved: what the
 * line and its scope give it, and what the rules give what neither does (an
 * hour from a start time, the visual day from a bare date, and so on). The
 * one place implicit values are resolved; `toDisplayTask` puts the answer on
 * the display copy, and a write that needs the slot a task fills (a
 * duplicate moved on the clock) asks it here.
 */
export function resolveEffectiveDates(task: Task, startHour: number): EffectiveDates {
    let effectiveStartDate = task.startDate || task.cascadeContext?.startDate || '';
    let effectiveStartTime = DateUtils.timeOfDay(task.startTime || task.cascadeContext?.startTime);
    let effectiveEndDate = task.endDate || task.cascadeContext?.endDate;
    let effectiveEndTime = DateUtils.timeOfDay(task.endTime || task.cascadeContext?.endTime);
    const effectiveDue = task.due || task.cascadeContext?.due;

    // Which fields the 3 layers actually produced. Every implicit-resolution
    // branch below asks THESE, not the raw fields: a time inherited from the
    // section (`- tv-start:: 06:00`) is a time, and resolving the missing end
    // from the raw fields alone turned such a task into a 23h59m all-day
    // block — and dropped an inherited end time on the floor.
    const hasStartDate = !!effectiveStartDate;
    const hasEndDate = !!effectiveEndDate;
    const hasEndTime = !!effectiveEndTime;
    const hasStartTime = !!effectiveStartTime;

    // The `*Implicit` flags stay RAW-based: they mean "not written on this
    // task line", which is what the menu and the form's placeholders read
    // them for. An inherited value is written in the note but not here, so
    // it must keep showing as a placeholder — filling the field would
    // materialize the inherited value onto the line on save.
    let startDateImplicit = !task.startDate;
    let startTimeImplicit = !task.startTime;
    let endDateImplicit = !task.endDate;
    let endTimeImplicit = !task.endTime;

    // Whether the converter synthesized the value (no layer supplied one).
    // Only the same-day inversion fallback needs this distinction, and it
    // must not rewrite an inherited real value to 00:00 / 23:59.
    let startTimeDefaulted = false;
    let endTimeDefaulted = false;

    // Resolve implicit start for E/ED types (have endDate, no startDate at all)
    if (!hasStartDate && hasEndDate) {
        if (hasEndTime) {
            // E-Timed: 1 hour before endTime
            const endMinutes = DateUtils.timeToMinutes(effectiveEndTime!);
            const startMinutes = endMinutes - DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
            if (startMinutes >= 0) {
                effectiveStartDate = effectiveEndDate!;
                effectiveStartTime = DateUtils.minutesToTime(startMinutes);
            } else {
                effectiveStartDate = DateUtils.addDays(effectiveEndDate!, -1);
                effectiveStartTime = DateUtils.minutesToTime(startMinutes + 24 * 60);
            }
        } else {
            // E-AllDay: resolve endTime first, then find visual day start
            const endHour = startHour === 0 ? 23 : startHour - 1;
            const implicitEndTime = DateUtils.formatHHMM(endHour, 59);
            effectiveEndTime = implicitEndTime;
            endTimeDefaulted = true;
            effectiveStartDate = DateUtils.toVisualDate(effectiveEndDate!, implicitEndTime, startHour);
            effectiveStartTime = DateUtils.formatHHMM(startHour, 0);
        }
        startTimeDefaulted = true;
        // startDateImplicit / startTimeImplicit remain true
    }

    // Resolve implicit start time for all-day tasks (date only, no time)
    if (effectiveStartDate && !effectiveStartTime) {
        effectiveStartTime = DateUtils.formatHHMM(startHour, 0);
        startTimeDefaulted = true;
    }

    // Resolve implicit end for S/SD types (have startDate, no endDate)
    if (effectiveStartDate && !hasEndDate) {
        if (hasEndTime) {
            // endTime is known (raw or inherited), only endDate needs resolution
            // Cross-midnight fallback: if endTime < startTime, resolve to next calendar day
            if (effectiveStartTime && effectiveEndTime! < effectiveStartTime) {
                effectiveEndDate = DateUtils.addDays(effectiveStartDate, 1);
            } else {
                effectiveEndDate = effectiveStartDate;
            }
        } else if (hasStartTime) {
            // S-Timed: startTime + DEFAULT_TIMED_DURATION_MINUTES
            const startMinutes = DateUtils.timeToMinutes(effectiveStartTime!);
            const endMinutes = startMinutes + DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
            if (endMinutes < 24 * 60) {
                effectiveEndDate = effectiveStartDate;
                effectiveEndTime = DateUtils.minutesToTime(endMinutes);
            } else {
                effectiveEndDate = DateUtils.addDays(effectiveStartDate, 1);
                effectiveEndTime = DateUtils.minutesToTime(endMinutes - 24 * 60);
            }
            endTimeDefaulted = true;
        } else {
            // S-AllDay: startTime (resolved above) + 23h59m
            const startMinutes = DateUtils.timeToMinutes(effectiveStartTime!);
            const endMinutes = startMinutes + 23 * 60 + 59;
            effectiveEndDate = DateUtils.addDays(effectiveStartDate, Math.floor(endMinutes / (24 * 60)));
            effectiveEndTime = DateUtils.minutesToTime(endMinutes % (24 * 60));
            endTimeDefaulted = true;
        }
        // endDateImplicit remains true (endDate was not explicit)
    }

    // Resolve implicit end time for SE/SED types (have endDate, no endTime)
    if (effectiveEndDate && !effectiveEndTime) {
        const endHour = startHour === 0 ? 23 : startHour - 1;
        effectiveEndTime = DateUtils.formatHHMM(endHour, 59);
        endTimeDefaulted = true;
    }

    // Fallback: if same calendarDate and defaulted end < defaulted start, use 00:00/23:59
    if (effectiveStartDate && effectiveEndDate
        && effectiveStartDate === effectiveEndDate
        && effectiveStartTime && effectiveEndTime
        && startTimeDefaulted !== endTimeDefaulted
        && effectiveEndTime < effectiveStartTime) {
        if (startTimeDefaulted) {
            effectiveStartTime = '00:00';
        }
        if (endTimeDefaulted) {
            effectiveEndTime = '23:59';
        }
    }

    return {
        effectiveStartDate,
        effectiveStartTime,
        effectiveEndDate,
        effectiveEndTime,
        effectiveDue,
        startDateImplicit,
        startTimeImplicit,
        endDateImplicit,
        endTimeImplicit,
    };
}
