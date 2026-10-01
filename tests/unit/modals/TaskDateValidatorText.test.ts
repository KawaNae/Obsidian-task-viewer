import { describe, it, expect, afterEach } from 'vitest';
import { setMockLocale } from 'obsidian';
import { initI18n } from '../../../src/i18n';
import { validateDateTimeFormats, type DateTimeFields } from '../../../src/modals/TaskDateValidator';

/**
 * The text a malformed date or time is told with. The kind of value is the
 * locale's word, not the English `date` or `time` put into every locale.
 */

const EMPTY: DateTimeFields = { startDate: '', startTime: '', endDate: '', endTime: '', dueDate: '', dueTime: '' };

function told(fields: Partial<DateTimeFields>): string | undefined {
    return validateDateTimeFormats({ ...EMPTY, ...fields })?.message;
}

afterEach(() => {
    setMockLocale('en');
    initI18n();
});

describe('the format error text', () => {
    it('is all Japanese in Japanese', () => {
        setMockLocale('ja');
        initI18n();
        expect(told({ startDate: '2026/10/01' })).toBe('開始: 日付の形式が不正です（YYYY-MM-DD）。');
        expect(told({ dueTime: '9時' })).toBe('期限: 時刻の形式が不正です（HH:mm）。');
    });

    it('reads as before in English', () => {
        setMockLocale('en');
        initI18n();
        expect(told({ startDate: '2026/10/01' })).toBe('Start: invalid date format (YYYY-MM-DD).');
        expect(told({ endTime: '25:00' })).toBe('End: invalid time format (HH:mm).');
    });
});
