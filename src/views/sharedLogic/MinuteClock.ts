import type { Component } from 'obsidian';

export const MINUTE_MS = 60_000;

/** What the clock needs of its owner: to be stopped when the owner unloads. */
export type ClockOwner = Pick<Component, 'register' | 'registerInterval'>;

/**
 * The plugin's one clock of minutes.
 *
 * Its first tick lands on the next minute boundary and every tick after it
 * one minute later, so what belongs to a minute (a card turning overdue, the
 * now-line, a new visual day) shows within a second of it rather than up to a
 * minute late. Both timers are the owner's: unloading it stops the clock, and
 * no one clears them by hand.
 *
 * What a tick does is the caller's (`tick`); the plugin sweeps the overdue
 * judgement and tells the views (`ViewEvents.minutePassed`). Clocks of
 * seconds — a running timer — are not this clock's: they tick only while
 * something runs.
 */
export function startMinuteClock(
    owner: ClockOwner,
    tick: () => void,
    now: () => number = Date.now,
): void {
    const align = window.setTimeout(() => {
        tick();
        owner.registerInterval(window.setInterval(tick, MINUTE_MS));
    }, MINUTE_MS - (now() % MINUTE_MS));
    owner.register(() => window.clearTimeout(align));
}
