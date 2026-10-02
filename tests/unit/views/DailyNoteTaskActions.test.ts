import { describe, it, expect } from 'vitest';
import {
    appendEmptySpaceMenuItems,
    startDailyNoteTimer,
    type DailyNoteTimerType,
} from '../../../src/views/sharedLogic/DailyNoteTaskActions';
import { t } from '../../../src/i18n';
import type TaskViewerPlugin from '../../../src/main';
import type { Menu } from 'obsidian';

function makePlugin() {
    const started: unknown[][] = [];
    const plugin = {
        getTimerWidget: () => ({
            startTimer: (...args: unknown[]) => { started.push(args); },
        }),
    } as unknown as TaskViewerPlugin;
    return { plugin, started };
}

describe('startDailyNoteTimer', () => {
    it('starts a timer on the day itself, recorded as children under that day\'s heading', () => {
        // The subject is the day, not a task: its records go under the heading
        // of that day's daily note. The start command runs it from the press.
        const { plugin, started } = makePlugin();
        startDailyNoteTimer(plugin, '2026-08-22', 'countup');
        expect(started).toEqual([[{ daily: '2026-08-22' }, 'child', { kind: 'countup' }]]);
    });

    it('passes the requested kind through', () => {
        const { plugin, started } = makePlugin();
        startDailyNoteTimer(plugin, '2026-08-22', 'pomodoro');
        expect(started[0][2]).toEqual({ kind: 'pomodoro' });
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

    it('says the timers start, not open', () => {
        const { menu } = build();
        expect(menu.items.map(i => i.title)).toEqual([
            t('menu.createTaskForDailyNote'),
            t('menu.startCountupForDailyNote'),
            t('menu.startPomodoroForDailyNote'),
        ]);
    });

    it('routes each entry to its handler', () => {
        const { menu, calls } = build();
        menu.items[0].click?.();
        menu.items[1].click?.();
        menu.items[2].click?.();
        expect(calls).toEqual(['create', 'timer:countup', 'timer:pomodoro']);
    });
});
