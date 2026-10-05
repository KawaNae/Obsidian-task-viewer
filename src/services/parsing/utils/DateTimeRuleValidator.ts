import { DateUtils } from '../../../utils/DateUtils';
import { t } from '../../../i18n';
import type { DateTimeRule } from '../../../types';

const CONTAINS_DATE_RE = new RegExp(DateUtils.DATE_PATTERN);

export interface DateTimeValidationInput {
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    due?: string;
    /** endDate が明示的に書かれていない場合 true（inline の `>hh:mm` 形式等） */
    endDateImplicit: boolean;
    /** 暗黙の startDate（daily note 継承等） */
    implicitStartDate?: string;
}

export interface DateTimeValidationResult {
    severity: 'error' | 'warning';
    /** ルール識別子（プログラム的処理用）。canonical な列挙は types の DateTimeRule */
    rule: DateTimeRule;
    /** ファクト: 何が問題か */
    message: string;
    /** 解決策: どうすれば直せるか（UI層が任意で表示） */
    hint: string;
}

/**
 * 日時フィールドのバリデーションルールを一元管理。
 * raw 値 + コンテキストフラグで検証する（effective 値ではなく）。
 * 全ルールを適用し、最初に見つかった警告を返す。
 */
/**
 * Rule 4's hint, with the line's own date and end time written the way the
 * notation allows: a start time on the start date, ending the same day, or
 * on the end date the line writes (the next day when it writes none). With
 * no date on the line, the bare request for a start time.
 */
function endTimeWithoutStartHint(date: string | undefined, endDate: string | undefined, endTime: string): string {
    if (!date || !DateUtils.isValidDateString(date) || !DateUtils.isValidTimeString(endTime)) {
        return t('validationHint.endTimeWithoutStart');
    }
    const end = DateUtils.timeToMinutes(endTime);
    // A start before the end on the same day: 09:00, or the hour before an early end.
    const sameDayStart = end > 9 * 60 ? '09:00' : DateUtils.minutesToTime(Math.max(0, end - 60));
    const otherDate = endDate && endDate !== date ? endDate : DateUtils.addDays(date, 1);
    return t('validationHint.endTimeWithoutStartExample', {
        time: endTime,
        endDate: otherDate,
        sameDay: `@${date}T${sameDayStart}>${endTime}`,
        otherDay: `@${date}T09:00>${otherDate}T${endTime}`,
    });
}

export function validateDateTimeRules(
    input: DateTimeValidationInput
): DateTimeValidationResult | undefined {
    const effectiveStartDate = input.startDate || input.implicitStartDate;

    // Rule 1: Cross-midnight ambiguity (endDate 暗黙 + endTime < startTime)
    if (effectiveStartDate && input.startTime && input.endTime
        && input.endDateImplicit && input.endTime < input.startTime) {
        return {
            severity: 'warning',
            rule: 'cross-midnight',
            message: t('validation.crossMidnight', {
                endTime: input.endTime, startTime: input.startTime,
            }),
            hint: t('validationHint.crossMidnight'),
        };
    }

    // Rule 2: Same-day time inversion (endDate 明示 & 同日)
    if (effectiveStartDate && input.startTime && input.endTime && input.endDate
        && effectiveStartDate === input.endDate && input.endTime < input.startTime) {
        return {
            severity: 'error',
            rule: 'same-day-inversion',
            message: t('validation.sameDayInversion', {
                endTime: input.endTime, startTime: input.startTime,
            }),
            hint: t('validationHint.sameDayInversion'),
        };
    }

    // Rule 3: End date before start date
    if (effectiveStartDate && input.endDate && input.endDate < effectiveStartDate) {
        return {
            severity: 'error',
            rule: 'end-before-start',
            message: t('validation.endBeforeStart', {
                endDate: input.endDate, startDate: effectiveStartDate,
            }),
            hint: t('validationHint.endBeforeStart'),
        };
    }

    // Rule 4: End time without start time
    if (input.endTime && !input.startTime) {
        return {
            severity: 'error',
            rule: 'end-time-without-start',
            message: t('validation.endTimeWithoutStart'),
            hint: endTimeWithoutStartHint(effectiveStartDate ?? input.endDate, input.endDate, input.endTime),
        };
    }

    // Rule 5: Due without date
    if (input.due && !CONTAINS_DATE_RE.test(input.due)) {
        return {
            severity: 'error',
            rule: 'due-without-date',
            message: t('validation.dueWithoutDate'),
            hint: t('validationHint.dueWithoutDate'),
        };
    }

    return undefined;
}
