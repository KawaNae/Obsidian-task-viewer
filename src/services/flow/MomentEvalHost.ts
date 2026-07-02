import { EvalHost } from '../lang/functions';
import { Value, parseDateStr } from '../lang/Value';
import { withWeekStartDay } from '../../utils/momentWeekLocale';

/**
 * Production EvalHost backed by Obsidian's moment. Week-relevant tokens
 * (ww / gggg / ...) follow the weekStartDay setting via the tv-week-*
 * locales, which is the canonical path for any week-bearing format call.
 *
 * Kept out of services/lang so the language core stays Obsidian-free;
 * tests inject lightweight hosts instead.
 */
export function createMomentEvalHost(): EvalHost {
    return {
        formatDate(value: Value, momentTokens: string, weekStartDay: 0 | 1): string {
            const date = toDate(value);
            if (!date) return '';
            return withWeekStartDay(date, weekStartDay).format(momentTokens);
        },
    };
}

function toDate(value: Value): Date | null {
    if (value.type === 'date') return parseDateStr(value.value);
    if (value.type === 'datetime') {
        const d = parseDateStr(value.date);
        const [h, m] = value.time.split(':').map(n => parseInt(n, 10));
        d.setHours(h, m, 0, 0);
        return d;
    }
    return null;
}
