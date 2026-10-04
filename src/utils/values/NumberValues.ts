import { typed } from './Normalize';
import { readFail, readOk, type FieldCodec, type Read } from './Read';

/**
 * Numbers typed as text, and numbers handed over by a script.
 *
 * Only what is visibly a decimal number is read. `Number()` would also take
 * `0x10`, `1e1` and `''`, and `parseInt` would take `3days` as 3; a value
 * that is not written as a number is refused rather than given a second
 * chance. Out of range is refused too, not moved to the range's end.
 */

export interface NumberRange {
    readonly min?: number;
    readonly max?: number;
}

const DECIMAL_INT = /^-?\d+$/;
const DECIMAL = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

function inRange(n: number, range: NumberRange): Read<number> {
    const { min, max } = range;
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
        return readFail({ code: 'range', ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
    }
    return readOk(n);
}

/** A whole number given as a JS value (an API parameter, a stored setting). */
export const IntValue = {
    check(n: unknown, range: NumberRange = {}): Read<number> {
        if (typeof n !== 'number' || !Number.isInteger(n)) return readFail({ code: 'shape', kind: 'int' });
        return inRange(n, range);
    },
};

/** A finite number given as a JS value. */
export const FloatValue = {
    check(n: unknown, range: NumberRange = {}): Read<number> {
        if (typeof n !== 'number' || !Number.isFinite(n)) return readFail({ code: 'shape', kind: 'number' });
        return inRange(n, range);
    },
};

/** A whole number typed as text: `-?\d+`. */
export const IntInput = {
    read(text: string, range: NumberRange = {}): Read<number> {
        const t = typed(text);
        if (t === '') return readFail({ code: 'empty' });
        if (!DECIMAL_INT.test(t)) return readFail({ code: 'shape', kind: 'int' });
        return IntValue.check(Number(t), range);
    },
    /** The reading of a field that takes a whole number in `range`, shown as its digits. */
    codec(range: NumberRange = {}): FieldCodec<number> {
        return { read: (text) => IntInput.read(text, range), show: (n) => String(n) };
    },
};

/** A decimal number typed as text: `1`, `1.5`, `.5`, `-2`. */
export const FloatInput = {
    read(text: string, range: NumberRange = {}): Read<number> {
        const t = typed(text);
        if (t === '') return readFail({ code: 'empty' });
        if (!DECIMAL.test(t)) return readFail({ code: 'shape', kind: 'number' });
        return FloatValue.check(Number(t), range);
    },
    /** The reading of a field that takes a decimal number in `range`, shown as JS writes it. */
    codec(range: NumberRange = {}): FieldCodec<number> {
        return { read: (text) => FloatInput.read(text, range), show: (n) => String(n) };
    },
};
