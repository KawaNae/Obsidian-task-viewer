import { t } from '../../../i18n';

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
    /** frontmatter タスクの場合 true（time-only 検出用） */
    isFrontmatter?: boolean;
}

export interface DateTimeValidationResult {
    severity: 'error' | 'warning';
    /** ルール識別子（プログラム的処理用） */
    rule: 'cross-midnight' | 'same-day-inversion' | 'end-before-start'
        | 'end-time-without-start' | 'due-without-date' | 'frontmatter-time-only';
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
            hint: t('validationHint.endTimeWithoutStart'),
        };
    }

    // Rule 5: Due without date
    if (input.due && !/\d{4}-\d{2}-\d{2}/.test(input.due)) {
        return {
            severity: 'error',
            rule: 'due-without-date',
            message: t('validation.dueWithoutDate'),
            hint: t('validationHint.dueWithoutDate'),
        };
    }

    // Rule 6: Frontmatter time-only (YAML sexagesimal problem)
    if (input.isFrontmatter) {
        const startTimeOnly = input.startTime && !input.startDate;
        const endTimeOnly = input.endTime && !input.endDate;
        if (startTimeOnly || endTimeOnly) {
            return {
                severity: 'warning',
                rule: 'frontmatter-time-only',
                message: t('validation.frontmatterTimeOnly'),
                hint: t('validationHint.frontmatterTimeOnly'),
            };
        }
    }

    return undefined;
}
