import { describe, it, expect } from 'vitest';
import { IntInput, IntValue, FloatInput, FloatValue } from '../../../../src/utils/values/NumberValues';

/**
 * Numbers are read only when written as decimal numbers, and out of range
 * is refused, not moved to the end (input decisions E and F).
 */

describe('IntInput', () => {
    it.each([['3', 3], [' 3 ', 3], ['-2', -2], ['０', 0], ['１２', 12]])('reads %j as %d', (text, n) => {
        expect(IntInput.read(text)).toEqual({ ok: true, value: n });
    });

    it.each(['3days', '1.5', '0x10', '1e1', '+3', '- 3', 'abc'])('refuses %j by its shape', (text) => {
        expect(IntInput.read(text)).toEqual({ ok: false, issue: { code: 'shape', kind: 'int' } });
    });

    it('calls space alone empty', () => {
        expect(IntInput.read(' ')).toEqual({ ok: false, issue: { code: 'empty' } });
    });

    it('refuses out of range with the bounds it was given', () => {
        expect(IntInput.read('0', { min: 1 })).toEqual({ ok: false, issue: { code: 'range', min: 1 } });
        expect(IntInput.read('31', { min: 1, max: 30 })).toEqual({ ok: false, issue: { code: 'range', min: 1, max: 30 } });
        expect(IntInput.read('30', { min: 1, max: 30 })).toEqual({ ok: true, value: 30 });
    });
});

describe('IntValue', () => {
    it.each([NaN, Infinity, 1.5, '3', null, undefined])('refuses %j as not a whole number', (n) => {
        expect(IntValue.check(n)).toEqual({ ok: false, issue: { code: 'shape', kind: 'int' } });
    });

    it('checks the range', () => {
        expect(IntValue.check(-1, { min: 0 })).toEqual({ ok: false, issue: { code: 'range', min: 0 } });
        expect(IntValue.check(0, { min: 0 })).toEqual({ ok: true, value: 0 });
    });
});

describe('FloatInput', () => {
    it.each([['1.5', 1.5], ['.5', 0.5], ['2', 2], ['-0.25', -0.25], ['１．５', 1.5]])('reads %j as %d', (text, n) => {
        expect(FloatInput.read(text)).toEqual({ ok: true, value: n });
    });

    it.each(['1.5x', '1e1', '0x10', 'abc', '.', '1..2'])('refuses %j by its shape', (text) => {
        expect(FloatInput.read(text)).toEqual({ ok: false, issue: { code: 'shape', kind: 'number' } });
    });

    it('checks the range', () => {
        expect(FloatInput.read('0.1', { min: 0.25, max: 10 })).toEqual({ ok: false, issue: { code: 'range', min: 0.25, max: 10 } });
    });
});

describe('FloatValue', () => {
    it('refuses what is not a finite number', () => {
        expect(FloatValue.check(NaN).ok).toBe(false);
        expect(FloatValue.check(Infinity).ok).toBe(false);
        expect(FloatValue.check('1').ok).toBe(false);
        expect(FloatValue.check(1.5)).toEqual({ ok: true, value: 1.5 });
    });
});
