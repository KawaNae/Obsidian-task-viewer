import { describe, it, expect } from 'vitest';
import { TIMER_TARGET_ID_PREFIX, generateTimerTargetId } from '../../../src/utils/TimerTargetIdUtils';

/**
 * The timer's block ID sits in the note while a session runs, so its length is
 * a user-visible property. It is pinned here. Which ids a timer put on is
 * recorded by its writes, not read off this shape (TimerAnchorOwnership.test.ts).
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

