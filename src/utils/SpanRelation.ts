import type { TaskSpan } from '../types';
import type { TimeWindow } from './DayWindow';

/**
 * How a span or a moment stands to a window (`DayWindow`). Spans and windows
 * are half open, `[start, end)`. A start belongs to the window it starts in;
 * an end and a due belong to the window they close, so one right at a day's
 * start is the day before's.
 */

/** Whether the span and the window share time. A point overlaps the window it is in. */
export function overlaps(span: TaskSpan, w: TimeWindow): boolean {
    if (span.endMs <= span.startMs) return startIn(span.startMs, w);
    return span.startMs < w.endMs && w.startMs < span.endMs;
}

/** Whether the whole span lies in the window. */
export function within(span: TaskSpan, w: TimeWindow): boolean {
    return w.startMs <= span.startMs && span.endMs <= w.endMs;
}

/** Whether a start falls in the window: `[w.start, w.end)`. */
export function startIn(ms: number, w: TimeWindow): boolean {
    return w.startMs <= ms && ms < w.endMs;
}

/** Whether an end or a due closes in the window: `(w.start, w.end]`. */
export function endIn(ms: number, w: TimeWindow): boolean {
    return w.startMs < ms && ms <= w.endMs;
}
