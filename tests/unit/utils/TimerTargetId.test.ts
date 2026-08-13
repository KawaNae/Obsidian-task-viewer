import { describe, it, expect } from 'vitest';
import {
    TIMER_TARGET_ID_PREFIX,
    LEGACY_TIMER_TARGET_ID_PREFIX,
    generateTimerTargetId,
    isTimerTargetId,
} from '../../../src/utils/TimerTargetIdUtils';

/**
 * The timer's block ID sits in the note while a session runs, so its length is
 * a user-visible property, and its recognition is what lets a running timer
 * find its own line again. Both are pinned here.
 */

describe('generateTimerTargetId', () => {
    it('produces the short form', () => {
        expect(generateTimerTargetId()).toMatch(/^tv-t-[a-z0-9]{7}$/);
    });

    it('stays inside the block-ID character set Obsidian accepts', () => {
        for (let i = 0; i < 200; i++) {
            expect(generateTimerTargetId()).toMatch(/^[A-Za-z0-9-]+$/);
        }
    });

    it('is far shorter than the UUID form it replaced', () => {
        // 'tv-timer-target-' + 36 = 52. The noise in the middle of a task line
        // is the whole reason for the change.
        expect(generateTimerTargetId().length).toBe(12);
    });

    it('does not repeat itself', () => {
        const ids = new Set(Array.from({ length: 500 }, () => generateTimerTargetId()));
        expect(ids.size).toBe(500);
    });

    it('uses the whole alphabet (no character is unreachable)', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 2000; i++) {
            for (const ch of generateTimerTargetId().slice(TIMER_TARGET_ID_PREFIX.length)) {
                seen.add(ch);
            }
        }
        expect(seen.size).toBe(36);
    });
});

describe('isTimerTargetId', () => {
    it('recognises what it generates', () => {
        for (let i = 0; i < 50; i++) {
            expect(isTimerTargetId(generateTimerTargetId())).toBe(true);
        }
    });

    // Notes written before the shortening still carry these. A false here means
    // a running timer loses the line it was recording into.
    it('still recognises the pre-v2 UUID form', () => {
        expect(isTimerTargetId(`${LEGACY_TIMER_TARGET_ID_PREFIX}0f9c1e2a-4b7d-4c31-9a55-8d2e6f1b3c04`))
            .toBe(true);
        expect(isTimerTargetId('tv-timer-target-abc123')).toBe(true);
    });

    it('rejects block IDs the timer does not manage', () => {
        for (const id of ['my-note', 'tv-task-1', 'timer-target-x', 'tv', 'tv-timer', '']) {
            expect(isTimerTargetId(id)).toBe(false);
        }
        expect(isTimerTargetId(undefined)).toBe(false);
        expect(isTimerTargetId(null)).toBe(false);
    });

    it('does not confuse the two prefixes with each other', () => {
        expect(LEGACY_TIMER_TARGET_ID_PREFIX.startsWith(TIMER_TARGET_ID_PREFIX)).toBe(false);
        expect(TIMER_TARGET_ID_PREFIX.startsWith(LEGACY_TIMER_TARGET_ID_PREFIX)).toBe(false);
    });
});
