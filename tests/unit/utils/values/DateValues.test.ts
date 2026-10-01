import { describe, it, expect } from 'vitest';
import { DateInput, TimeInput, DateTimeInput } from '../../../../src/utils/values/DateValues';

/**
 * Dates and times typed by a person or a script (stage 7, input decisions
 * B, C and D): a date names a day that exists, a time may have one digit
 * of hour and is given back with two, and full-width text and hyphen-like
 * characters read as ASCII.
 */

describe('DateInput', () => {
    it.each([
        ['2026-10-01', '2026-10-01'],
        [' 2026-10-01 ', '2026-10-01'],
        ['２０２６－１０－０１', '2026-10-01'],
        ['２０２６ー１０ー０１', '2026-10-01'],
        ['2026‐10−01', '2026-10-01'],
        ['2024-02-29', '2024-02-29'],
    ])('reads %j as %j', (text, value) => {
        expect(DateInput.read(text)).toEqual({ ok: true, value });
    });

    it.each(['2026-02-30', '2026-13-01', '2026-04-31', '2025-02-29', '2026-00-10'])('refuses %j as no such day', (text) => {
        expect(DateInput.read(text)).toEqual({ ok: false, issue: { code: 'noSuchDay' } });
    });

    it.each(['2026/10/01', '2026-1-1', '10-01', 'today', '2026-10-01T09:00'])('refuses %j by its shape', (text) => {
        expect(DateInput.read(text)).toEqual({ ok: false, issue: { code: 'shape', kind: 'date' } });
    });

    it('calls space alone empty', () => {
        expect(DateInput.read('  ')).toEqual({ ok: false, issue: { code: 'empty' } });
    });
});

describe('TimeInput', () => {
    it.each([
        ['09:40', '09:40'],
        ['9:40', '09:40'],
        ['０９：４０', '09:40'],
        ['９：４０', '09:40'],
        ['0:00', '00:00'],
        ['23:59', '23:59'],
    ])('reads %j as %j', (text, value) => {
        expect(TimeInput.read(text)).toEqual({ ok: true, value });
    });

    it.each(['24:00', '99:99', '09:60', '9:4', '0940', '123:00', '09:40:00'])('refuses %j', (text) => {
        expect(TimeInput.read(text)).toEqual({ ok: false, issue: { code: 'shape', kind: 'time' } });
    });
});

describe('DateTimeInput', () => {
    const allow = { timeOnly: 'allow' } as const;
    const refuse = { timeOnly: 'refuse' } as const;

    it.each([
        ['2026-10-01', { date: '2026-10-01' }],
        ['2026-10-01 09:40', { date: '2026-10-01', time: '09:40' }],
        ['2026-10-01T09:40', { date: '2026-10-01', time: '09:40' }],
        ['2026-10-01  9:40', { date: '2026-10-01', time: '09:40' }],
        ['２０２６ー１０ー０１　９：４０', { date: '2026-10-01', time: '09:40' }],
        ['9:40', { time: '09:40' }],
    ])('reads %j as %j', (text, value) => {
        expect(DateTimeInput.read(text, allow)).toEqual({ ok: true, value });
    });

    it('refuses a time alone where a date is required', () => {
        expect(DateTimeInput.read('17:00', refuse)).toEqual({ ok: false, issue: { code: 'dateRequired' } });
        expect(DateTimeInput.read('2026-10-01 17:00', refuse)).toEqual({ ok: true, value: { date: '2026-10-01', time: '17:00' } });
    });

    it('tells a day that does not exist, with a time or without', () => {
        expect(DateTimeInput.read('2026-02-30', allow)).toEqual({ ok: false, issue: { code: 'noSuchDay' } });
        expect(DateTimeInput.read('2026-02-30 10:00', allow)).toEqual({ ok: false, issue: { code: 'noSuchDay' } });
    });

    it.each(['2026-13-45x', '2026-10-01T99:99', '2026-10-01 10', 'tomorrow', '2026-10-01 10:00 x'])('refuses %j by its shape', (text) => {
        expect(DateTimeInput.read(text, allow)).toEqual({ ok: false, issue: { code: 'shape', kind: 'dateTime' } });
    });

    it('calls space alone empty', () => {
        expect(DateTimeInput.read(' ', allow)).toEqual({ ok: false, issue: { code: 'empty' } });
    });
});
