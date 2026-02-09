export const TIMER_TARGET_ID_PREFIX = 'tv-timer-target-';

export function isTimerTargetId(value: string | undefined | null): boolean {
    return !!value && value.startsWith(TIMER_TARGET_ID_PREFIX);
}
