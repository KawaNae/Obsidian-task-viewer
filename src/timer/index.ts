/**
 * Timer module barrel — public API.
 */

export { TimerWidget } from './TimerWidget';
export { IntervalParser } from './IntervalParser';
export { TimerProgressUI } from './TimerProgressUI';
export type {
    TimerInstance,
    TimerStartConfig,
    CountupTimer,
    CountdownTimer,
    IntervalTimer,
    IdleTimer,
    IntervalGroup,
    IntervalSegment,
    TimerPhase,
} from './TimerInstance';
