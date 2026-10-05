import { describe, it, expect, vi } from 'vitest';
import type { View } from 'obsidian';
import { ViewEvents } from '../../../src/views/sharedLogic/ViewEvents';

/**
 * Saving settings redraws the views in place; only a changed visual day moves
 * them. Both used to go through one `refresh()`, and Timeline and Schedule
 * answered it by going back to today, so every settings save (including the
 * timer widget's pomodoro minutes) moved them off the day the user was on.
 */
function setup(today: string) {
    const view = { redraw: vi.fn(), onDayRolled: vi.fn(), onMinute: vi.fn() };
    const clock = { today };
    const events = new ViewEvents(() => [view as unknown as View], () => clock.today);
    return { view, clock, events };
}

describe('saving settings keeps the date a view shows', () => {
    it('redraws in place when the visual day is unchanged', () => {
        const h = setup('2026-09-30');
        h.events.watch();

        h.events.settingsChanged();

        expect(h.view.redraw).toHaveBeenCalledTimes(1);
        expect(h.view.onDayRolled).not.toHaveBeenCalled();
    });

    it('follows the day, once, when the save moved the visual day (a new start hour)', () => {
        const h = setup('2026-09-30');
        h.events.watch();
        h.clock.today = '2026-09-29';

        h.events.settingsChanged();
        h.events.rollIfChanged();

        expect(h.view.onDayRolled).toHaveBeenCalledTimes(1);
        expect(h.view.redraw).not.toHaveBeenCalled();
    });

    it('the day check tells the views only when the day changed', () => {
        const h = setup('2026-09-30');
        h.events.watch();

        expect(h.events.rollIfChanged()).toBe(false);
        h.clock.today = '2026-10-01';
        expect(h.events.rollIfChanged()).toBe(true);

        expect(h.view.onDayRolled).toHaveBeenCalledTimes(1);
        expect(h.view.redraw).not.toHaveBeenCalled();
    });

    it('before watching, a save only redraws', () => {
        const h = setup('2026-09-30');
        h.events.settingsChanged();
        expect(h.view.redraw).toHaveBeenCalledTimes(1);
        expect(h.view.onDayRolled).not.toHaveBeenCalled();
    });
});

describe('a minute passing', () => {
    it('tells the views the minute, and nothing else when the day is the same', () => {
        const h = setup('2026-09-30');
        h.events.watch();

        h.events.minutePassed();

        expect(h.view.onMinute).toHaveBeenCalledTimes(1);
        expect(h.view.onDayRolled).not.toHaveBeenCalled();
        expect(h.view.redraw).not.toHaveBeenCalled();
    });

    it('checks the day on the minute, so a view follows a new day within a minute', () => {
        const h = setup('2026-09-30');
        h.events.watch();
        h.clock.today = '2026-10-01';

        h.events.minutePassed();
        h.events.minutePassed();

        expect(h.view.onDayRolled).toHaveBeenCalledTimes(1);
        expect(h.view.onMinute).toHaveBeenCalledTimes(2);
    });

    it('is ignored by a view that draws no time of day', () => {
        const view = { redraw: vi.fn() };
        const events = new ViewEvents(() => [view as unknown as View], () => '2026-09-30');
        events.watch();

        expect(() => events.minutePassed()).not.toThrow();
        expect(view.redraw).not.toHaveBeenCalled();
    });
});
