export const TIMER_TARGET_ID_PREFIX = 'tv-timer-target-';
export const FRONTMATTER_TIMER_TARGET_KEY = 'task-viewer-timer-target-id';

export function isTimerTargetId(value: string | undefined | null): boolean {
    return !!value && value.startsWith(TIMER_TARGET_ID_PREFIX);
}
