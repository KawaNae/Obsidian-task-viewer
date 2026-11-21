import { describe, expect, it, vi } from 'vitest';
import { TimerBoard, type IdleBoard } from '../../../src/timer/TimerBoard';
import type { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerRenderer } from '../../../src/timer/TimerRenderer';
import { TimerProgressUI } from '../../../src/timer/TimerProgressUI';
import { addPomodoroItems, addStartOffsetItems, buildTimerMenu, type TimerMenuDeps } from '../../../src/timer/TimerWidgetMenu';
import { freeze, restart } from '../../../src/timer/TimerClock';
import { pomodoroGroups, START_CURSOR } from '../../../src/timer/IntervalMath';
import { newTimerId, type Session, type TimerState } from '../../../src/timer/TimerState';
import type { Measure } from '../../../src/timer/TimerProgress';
import type { MenuAnchor } from '../../../src/interaction/menu/MenuPresenter';
import { t } from '../../../src/i18n';
import { FakeEl } from '../helpers/fakeEl';

/**
 * A started timer's header ends in a gear, whose menu is the shift section
 * (while the start can be shifted), the Pomodoro section (for a Pomodoro), a
 * separator, and the close item, whose words and warning follow the session.
 * The elapsed time opens the same shift section. The idle item keeps its ✕ and
 * has no gear.
 */

vi.mock('obsidian', async (importOriginal) => ({
    ...await importOriginal<typeof import('obsidian')>(),
    setIcon: () => { },
}));

interface FakeItem {
    title: string;
    disabled: boolean;
    icon: string | null;
    warning: boolean;
    click: (() => void) | null;
}

const SEPARATOR = '---';

/** A menu that keeps its items in order, a separator as `---`. */
class FakeMenu {
    entries: (FakeItem | typeof SEPARATOR)[] = [];

    addItem(cb: (item: unknown) => void): this {
        const item: FakeItem = { title: '', disabled: false, icon: null, warning: false, click: null };
        const handle = {
            setTitle(title: string) { item.title = title; return handle; },
            setDisabled(on: boolean) { item.disabled = on; return handle; },
            setIcon(icon: string) { item.icon = icon; return handle; },
            setWarning(on: boolean) { item.warning = on; return handle; },
            setChecked() { return handle; },
            onClick(f: () => void) { item.click = f; return handle; },
        };
        cb(handle);
        this.entries.push(item);
        return this;
    }

    addSeparator(): this {
        this.entries.push(SEPARATOR);
        return this;
    }

    titles(): string[] {
        return this.entries.map(e => e === SEPARATOR ? SEPARATOR : e.title);
    }

    item(title: string): FakeItem {
        const found = this.entries.find((e): e is FakeItem => e !== SEPARATOR && e.title === title);
        if (!found) throw new Error(`no item ${title} in ${JSON.stringify(this.titles())}`);
        return found;
    }

    last(): FakeItem {
        const last = this.entries[this.entries.length - 1];
        if (last === SEPARATOR || last === undefined) throw new Error('the menu does not end in an item');
        return last;
    }
}

const COUNTUP: Measure = { type: 'countup' };
const COUNTDOWN: Measure = { type: 'countdown', totalSeconds: 1500 };
const POMODORO: Measure = { type: 'interval', source: 'pomodoro', groups: pomodoroGroups(25, 5), at: START_CURSOR };
const RUNNING: Session = { kind: 'running', from: 0 };
const PENDING: Session = { kind: 'pending', record: { endMs: 0, seconds: 0, then: 'suspend' } };
const SUSPENDED: Session = { kind: 'suspended' };

function build() {
    const board = new TimerBoard({ persist: () => { }, render: () => { } });
    const close = vi.fn(async (_timer: TimerState) => { });
    const offsetStart = vi.fn(async (_timer: TimerState, _startMs: number) => ({ written: true }));
    const lifecycle = { close, offsetStart } as unknown as TimerLifecycle;
    const plugin = {
        settings: { startHour: 0, pomodoroWorkMinutes: 25, pomodoroBreakMinutes: 5 },
        saveSettings: async () => { },
    };
    const deps: TimerMenuDeps = { app: {} as never, plugin: plugin as never, board, lifecycle };

    const presented: { menu: FakeMenu; anchor: MenuAnchor }[] = [];
    const renderer = new TimerRenderer({
        app: {} as never,
        plugin: {
            ...plugin,
            menuPresenter: {
                present: (fill: (menu: FakeMenu) => void, anchor: MenuAnchor) => {
                    const menu = new FakeMenu();
                    fill(menu);
                    presented.push({ menu, anchor });
                    return null;
                },
            },
        } as never,
        board, lifecycle,
        tailRow: () => undefined, container: {} as never,
        startTimer: () => { },
    });
    const internals = renderer as unknown as {
        renderTimerItem(container: FakeEl, timer: TimerState, now: number): void;
        fillIdleItem(itemEl: FakeEl, idle: IdleBoard, now: number): void;
        showStartOffsetMenu(timer: TimerState, anchor: MenuAnchor): void;
        suggester: { getSuggestion(): null };
    };
    internals.suggester = { getSuggestion: () => null };

    const timerIn = (session: Session, measure: Measure = COUNTUP, expanded = true): TimerState => {
        const now = Date.now();
        const clock = restart(now - 600_000);
        const timer: TimerState = {
            id: newTimerId(),
            subject: { kind: 'task', anchor: 'box' },
            file: 'notes/a.md', name: 'A', color: '', mode: 'child',
            measure,
            clock: session.kind === 'running' ? clock : freeze(clock, now),
            session,
            tail: 'tv-tail', owned: [], opening: null,
            recorded: { seconds: 0, count: 0 }, priorStartMs: null, expanded,
        };
        board.add(timer);
        return timer;
    };

    const gearMenu = (timer: TimerState): FakeMenu => {
        const menu = new FakeMenu();
        buildTimerMenu(menu as never, timer, deps);
        return menu;
    };
    const section = (add: (menu: never, timer: TimerState, deps: TimerMenuDeps) => void, timer: TimerState): string[] => {
        const menu = new FakeMenu();
        add(menu as never, timer, deps);
        return menu.titles();
    };

    /** The header of a folded timer, drawn as the widget draws it. */
    const header = (timer: TimerState): FakeEl => {
        (timer as { expanded: boolean }).expanded = false;
        const container = new FakeEl();
        internals.renderTimerItem(container, timer, Date.now());
        return container.querySelector('.timer-widget__header')!;
    };

    return { board, close, offsetStart, presented, internals, timerIn, gearMenu, section, header };
}

const OFFSET_SECTION = [
    t('timer.offsetStart'),
    ...[5, 10, 15, 30].map(minutes => `  ${t('timer.offsetMinutesAgo', { minutes })}`),
    `  ${t('timer.offsetCustom')}`,
];

describe('the gear menu follows the measure and the session', () => {
    it('a running countup or countdown: the shift section, a separator, then close without recording', () => {
        const h = build();
        for (const measure of [COUNTUP, COUNTDOWN]) {
            expect(h.gearMenu(h.timerIn(RUNNING, measure)).titles()).toEqual([...OFFSET_SECTION, SEPARATOR, t('timer.discard')]);
        }
    });

    it('a countup or countdown waiting to record: close without recording alone', () => {
        const h = build();
        for (const measure of [COUNTUP, COUNTDOWN]) {
            expect(h.gearMenu(h.timerIn(PENDING, measure)).titles()).toEqual([t('timer.discard')]);
        }
    });

    it('a suspended countup or countdown: the recorded close alone, with no shift section', () => {
        const h = build();
        for (const measure of [COUNTUP, COUNTDOWN]) {
            expect(h.gearMenu(h.timerIn(SUSPENDED, measure)).titles()).toEqual([t('timer.close')]);
        }
    });

    it('a Pomodoro, in every session: the Pomodoro section, a separator, then the close item of its session', () => {
        const h = build();
        const pomodoro = h.section(addPomodoroItems, h.timerIn(RUNNING, POMODORO));
        expect(pomodoro[0]).toBe(t('timer.workDuration'));
        expect(pomodoro).toContain(t('timer.breakDuration'));
        expect(pomodoro[pomodoro.length - 1]).toMatch(new RegExp(`^${t('timer.autoRepeat')}`));
        expect(pomodoro).not.toContain(t('timer.offsetStart'));

        expect(h.gearMenu(h.timerIn(RUNNING, POMODORO)).titles()).toEqual([...pomodoro, SEPARATOR, t('timer.discard')]);
        expect(h.gearMenu(h.timerIn(PENDING, POMODORO)).titles()).toEqual([...pomodoro, SEPARATOR, t('timer.discard')]);
        expect(h.gearMenu(h.timerIn(SUSPENDED, POMODORO)).titles()).toEqual([...pomodoro, SEPARATOR, t('timer.close')]);
    });

    it('a folded running countup still offers the shift section', () => {
        const h = build();
        expect(h.gearMenu(h.timerIn(RUNNING, COUNTUP, false)).titles()).toEqual([...OFFSET_SECTION, SEPARATOR, t('timer.discard')]);
    });

    it('the shift section\'s heading is disabled, its choices are not', () => {
        const h = build();
        const menu = h.gearMenu(h.timerIn(RUNNING));
        expect(menu.item(t('timer.offsetStart')).disabled).toBe(true);
        expect(menu.item(OFFSET_SECTION[1]).disabled).toBe(false);
    });
});

describe('the close item', () => {
    it('while the timer holds a running line, it closes without recording and is marked as a warning', () => {
        const h = build();
        for (const timer of [h.timerIn(RUNNING), h.timerIn(PENDING), h.timerIn(RUNNING, POMODORO)]) {
            const item = h.gearMenu(timer).last();
            expect(item.title).toBe(t('timer.discard'));
            expect(item.icon).toBe('x');
            expect(item.warning).toBe(true);
        }
    });

    it('while suspended, it closes what is recorded and is no warning', () => {
        const h = build();
        for (const timer of [h.timerIn(SUSPENDED), h.timerIn(SUSPENDED, POMODORO)]) {
            const item = h.gearMenu(timer).last();
            expect(item.title).toBe(t('timer.close'));
            expect(item.icon).toBe('x');
            expect(item.warning).toBe(false);
        }
    });

    it('chosen, it asks the lifecycle to close that timer', () => {
        const h = build();
        const timer = h.timerIn(RUNNING);
        h.gearMenu(timer).last().click!();
        expect(h.close).toHaveBeenCalledWith(timer);
    });
});

describe('the elapsed time and the gear open the same shift section', () => {
    it('the elapsed time\'s menu is the shift section, heading and all, as in the gear\'s', () => {
        const h = build();
        const timer = h.timerIn(RUNNING);
        // A start the self timer overwrote, remembered as a choice of its own.
        (timer as { priorStartMs: number | null }).priorStartMs = Date.now() - 1000;

        h.internals.showStartOffsetMenu(timer, { kind: 'position', x: 0, y: 0 });

        const fromTime = h.presented[0].menu.titles();
        expect(fromTime).toEqual(h.section(addStartOffsetItems, timer));
        expect(fromTime).toHaveLength(OFFSET_SECTION.length + 1);
        expect(fromTime[0]).toBe(t('timer.offsetStart'));
        expect(h.gearMenu(timer).titles().slice(0, fromTime.length)).toEqual(fromTime);
    });

    it('a choice shifts the start from when it is chosen', () => {
        const h = build();
        const timer = h.timerIn(RUNNING);
        const before = Date.now();
        h.gearMenu(timer).item(OFFSET_SECTION[1]).click!();
        const [shifted, startMs] = h.offsetStart.mock.calls[0];
        expect(shifted).toBe(timer);
        expect(startMs).toBeGreaterThanOrEqual(before - 5 * 60_000);
        expect(startMs).toBeLessThanOrEqual(Date.now() - 5 * 60_000);
    });
});

describe('the header of a started timer ends in the gear, and has no ✕', () => {
    const buttons = (header: FakeEl): FakeEl[] => header.children.filter(c => c.tag === 'button');

    it('fold, then the gear, named, for every measure and session', () => {
        const h = build();
        for (const measure of [COUNTUP, COUNTDOWN, POMODORO]) {
            for (const session of [RUNNING, PENDING, SUSPENDED]) {
                const header = h.header(h.timerIn(session, measure));
                const [fold, gear, ...rest] = buttons(header);
                expect(fold.classes.has('timer-widget__toggle-btn')).toBe(true);
                expect(gear.classes.has('timer-widget__settings-btn')).toBe(true);
                expect(gear.getAttribute('aria-label')).toBe(t('timer.menu'));
                expect(rest).toEqual([]);
                expect(header.querySelector('.timer-widget__close-btn')).toBeNull();
            }
        }
    });

    it('the gear opens its menu at the pointer for a press, and below itself for a key', () => {
        const h = build();
        const timer = h.timerIn(RUNNING);
        const gear = h.header(timer).querySelector('.timer-widget__settings-btn')!;
        const press = (detail: number) => (gear as unknown as { onclick(e: unknown): void })
            .onclick({ detail, stopPropagation: () => { } });

        press(1);
        press(0);

        expect(h.presented.map(p => p.anchor.kind)).toEqual(['mouseEvent', 'belowRect']);
        expect(h.presented[1].anchor).toEqual({ kind: 'belowRect', rect: gear.getBoundingClientRect() });
        expect(h.presented[0].menu.last().title).toBe(t('timer.discard'));
    });

    it('the gear of a timer no longer on the board opens nothing', () => {
        const h = build();
        const timer = h.timerIn(SUSPENDED);
        const gear = h.header(timer).querySelector('.timer-widget__settings-btn')!;
        h.board.remove(timer);
        (gear as unknown as { onclick(e: unknown): void }).onclick({ detail: 1, stopPropagation: () => { } });
        expect(h.presented).toEqual([]);
    });
});

describe('the idle item keeps its ✕ and has no gear', () => {
    it('its header is the name and ✕', () => {
        const h = build();
        const render = vi.spyOn(TimerProgressUI, 'render').mockImplementation(() => { });
        const item = new FakeEl('timer-widget__item');

        h.internals.fillIdleItem(item, { sinceMs: Date.now() }, Date.now());

        const header = item.querySelector('.timer-widget__header')!;
        expect(header.querySelector('.timer-widget__close-btn')).not.toBeNull();
        expect(header.querySelector('.timer-widget__settings-btn')).toBeNull();
        render.mockRestore();
    });
});
