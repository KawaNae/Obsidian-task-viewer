import { DateUtils } from '../DateUtils';
import { dashed, typed } from './Normalize';
import { readFail, readOk, type Issue, type Read } from './Read';

/**
 * Dates and times typed by a person or a script.
 *
 * A date is `YYYY-MM-DD` naming a day that exists; whether it exists is
 * `DateUtils.readDate`, the predicate the rest of the plugin asks. A time
 * is `H:mm` or `HH:mm` within the day and is given back as `HH:mm`, the one
 * form the notation writes. The text is normalized first (`typed`, and
 * `dashed` for the date), so `２０２６ー１０ー０１` is a date.
 *
 * The note's own notation is not read here: it keeps its own rule for the
 * day of the month (stage 7, decision N).
 */

const DATE_TIME_RE = /^(\S+?)(?:T|\s+)(\S+)$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** A date given alone, or a date with a time, or (where allowed) a time alone. */
export interface DateTimeValue {
    readonly date?: string;
    readonly time?: string;
}

export const DateInput = {
    read(text: string): Read<string> {
        const t = dashed(typed(text));
        if (t === '') return readFail({ code: 'empty' });
        if (!DateUtils.isDateShape(t)) return readFail({ code: 'shape', kind: 'date' });
        if (DateUtils.readDate(t) === null) return readFail({ code: 'noSuchDay' });
        return readOk(t);
    },
};

export const TimeInput = {
    read(text: string): Read<string> {
        const t = typed(text);
        if (t === '') return readFail({ code: 'empty' });
        const m = t.match(TIME_RE);
        const time = m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
        if (!DateUtils.isValidTimeString(time)) return readFail({ code: 'shape', kind: 'time' });
        return readOk(time);
    },
};

export const DateTimeInput = {
    /**
     * `YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, `YYYY-MM-DDTHH:mm`, or `HH:mm`
     * alone. A time alone is `dateRequired` when `timeOnly` is `'refuse'`
     * (a due takes its time only after a date).
     */
    read(text: string, opts: { timeOnly: 'allow' | 'refuse' }): Read<DateTimeValue> {
        const t = dashed(typed(text));
        if (t === '') return readFail({ code: 'empty' });
        // The shape told is the one this reading takes: a time alone only where it is taken.
        const shape: Issue = { code: 'shape', kind: opts.timeOnly === 'allow' ? 'dateTimeOrTime' : 'dateTime' };

        const pair = t.match(DATE_TIME_RE);
        if (pair) {
            const date = DateInput.read(pair[1]);
            if (!date.ok) return readFail(date.issue.code === 'noSuchDay' ? date.issue : shape);
            const time = TimeInput.read(pair[2]);
            if (!time.ok) return readFail(shape);
            return readOk({ date: date.value, time: time.value });
        }

        const date = DateInput.read(t);
        if (date.ok) return readOk({ date: date.value });
        if (date.issue.code === 'noSuchDay') return readFail(date.issue);

        const time = TimeInput.read(t);
        if (time.ok) {
            return opts.timeOnly === 'allow' ? readOk({ time: time.value }) : readFail({ code: 'dateRequired' });
        }
        return readFail(shape);
    },
};
