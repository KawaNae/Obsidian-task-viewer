import { describe, it, expect } from 'vitest';
import {
    appendEmptySpaceMenuItems,
    openDailyNoteTimer,
    type DailyNoteTimerType,
} from '../../../src/views/sharedLogic/DailyNoteTaskActions';
import type TaskViewerPlugin from '../../../src/main';
import type { Menu } from 'obsidian';

function makePlugin() {
    const started: Record<string, unknown>[] = [];
    const plugin = {
        getTimerWidget: () => ({
            startTimer: (opts: Record<string, unknown>) => { started.push(opts); },
        }),
    } as unknown as TaskViewerPlugin;
    return { plugin, started };
}

describe('openDailyNoteTimer', () => {
    it('targets the day itself with the synthetic daily id', () => {
        // `daily-<date>` is what routes the recorded segments into that day's
        // note instead of a task's own line.
        const { plugin, started } = makePlugin();
        openDailyNoteTimer(plugin, '2026-08-22', 'countup');
        expect(started).toEqual([{
            taskId: 'daily-2026-08-22',
            taskName: '2026-08-22',
            recordMode: 'child',
            timerType: 'countup',
            autoStart: false,
        }]);
    });

    it('passes the requested timer type through', () => {
        const { plugin, started } = makePlugin();
        openDailyNoteTimer(plugin, '2026-08-22', 'pomodoro');
        expect(started[0].timerType).toBe('pomodoro');
    });

    it('never starts the timer running', () => {
        // The menu opens the widget so the user can start it; starting on its
        // own would begin recording behind their back.
        const { plugin, started } = makePlugin();
        openDailyNoteTimer(plugin, '2026-08-22', 'countup');
        expect(started[0].autoStart).toBe(false);
    });
});

/** Records what was appended to a menu; the shared obsidian mock is a no-op. */
class RecordedMenu {
    items: { title: string; icon?: string; click?: () => void }[] = [];
    separatorAfter: number[] = [];

    addItem(cb: (item: RecordedItem) => void): this {
        const rec: { title: string; icon?: string; click?: () => void } = { title: '' };
        this.items.push(rec);
        cb({
            setTitle(t: string) { rec.title = t; return this; },
            setIcon(i: string) { rec.icon = i; return this; },
            onClick(fn: () => void) { rec.click = fn; return this; },
        });
        return this;
    }
    addSeparator(): this {
        this.separatorAfter.push(this.items.length);
        return this;
    }
    asMenu(): Menu { return this as unknown as Menu; }
}

interface RecordedItem {
    setTitle(t: string): RecordedItem;
    setIcon(i: string): RecordedItem;
    onClick(fn: () => void): RecordedItem;
}

describe('appendEmptySpaceMenuItems', () => {
    function build() {
        const menu = new RecordedMenu();
        const calls: string[] = [];
        appendEmptySpaceMenuItems(menu.asMenu(), {
            onCreate: () => calls.push('create'),
            onTimer: (t: DailyNoteTimerType) => calls.push('timer:' + t),
        });
        return { menu, calls };
    }

    it('offers create, then the two timers, in that order', () => {
        // Both lanes now show the same order; the all-day lane used to list
        // pomodoro before countup.
        const { menu } = build();
        expect(menu.items.map(i => i.icon)).toEqual(['plus', 'clock', 'timer']);
    });

    it('separates the create entry from the timer entries', () => {
        const { menu } = build();
        expect(menu.separatorAfter).toEqual([1]);
    });

    it('routes each entry to its handler', () => {
        const { menu, calls } = build();
        menu.items[0].click?.();
        menu.items[1].click?.();
        menu.items[2].click?.();
        expect(calls).toEqual(['create', 'timer:countup', 'timer:pomodoro']);
    });
});
