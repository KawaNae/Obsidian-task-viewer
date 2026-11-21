import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimerBoard } from '../../../src/timer/TimerBoard';
import type { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerRenderer, timerRing } from '../../../src/timer/TimerRenderer';
import { TimerProgressUI } from '../../../src/timer/TimerProgressUI';
import { freeze, restart } from '../../../src/timer/TimerClock';
import { pomodoroGroups, START_CURSOR } from '../../../src/timer/IntervalMath';
import { newTimerId, type Session, type TimerState } from '../../../src/timer/TimerState';
import type { Measure } from '../../../src/timer/TimerProgress';
import type { MenuAnchor } from '../../../src/interaction/menu/MenuPresenter';
import { t } from '../../../src/i18n';

/**
 * widget の経過時間の表示は、開始をずらせる間（走っている countup と countdown）だけ
 * ボタンになる: 役割と Tab の順と名前を持ち、押すか Enter か Space で
 * 開始をずらすメニューを開く。キーで開いたメニューは表示の下に出る。押せない間
 * （中断中、記録待ち、ポモドーロ）はただの数字で、押しても何も開かない。状態が
 * 組み直しなしに変わっても、tick が見た目を合わせる。
 *
 * DOM は持たないので、描画と束縛が触る口だけを持つ代役の要素で見る。
 */

type Listener = (e: unknown) => void;

class FakeEl {
    children: FakeEl[] = [];
    attrs = new Map<string, string>();
    classes = new Set<string>();
    text = '';
    dataset: Record<string, string> = {};
    parent: FakeEl | null = null;
    listeners = new Map<string, Listener[]>();

    constructor(cls = '') {
        for (const c of cls.split(/\s+/).filter(Boolean)) this.classes.add(c);
    }

    setAttribute(name: string, value: string): void {
        this.attrs.set(name, value);
        if (name === 'class') this.classes = new Set(value.split(/\s+/).filter(Boolean));
    }
    getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
    removeAttribute(name: string): void { this.attrs.delete(name); }

    appendChild(child: FakeEl): void {
        child.parent = this;
        this.children.push(child);
    }

    createDiv(cls = ''): FakeEl {
        const child = new FakeEl(cls);
        this.appendChild(child);
        return child;
    }

    createSpan(options: { cls?: string; text?: string; attr?: Record<string, string> } = {}): FakeEl {
        const child = this.createDiv(options.cls);
        if (options.text !== undefined) child.text = options.text;
        for (const [name, value] of Object.entries(options.attr ?? {})) child.setAttribute(name, value);
        return child;
    }

    /** 子を消して文字だけにする（Obsidian の `setText` と同じ）。 */
    setText(text: string): void {
        for (const child of this.children) child.parent = null;
        this.children = [];
        this.text = text;
    }
    addClass(cls: string): void { this.classes.add(cls); }
    toggleClass(cls: string, on: boolean): void {
        if (on) this.classes.add(cls);
        else this.classes.delete(cls);
    }

    remove(): void {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter(c => c !== this);
        this.parent = null;
    }

    addEventListener(type: string, listener: Listener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    dispatch(type: string, e: Record<string, unknown> = {}): { defaultPrevented: boolean } {
        const event = {
            defaultPrevented: false,
            preventDefault() { event.defaultPrevented = true; },
            stopPropagation() { },
            ...e,
        };
        for (const listener of this.listeners.get(type) ?? []) listener(event);
        return event;
    }

    get textContent(): string { return this.text + this.children.map(c => c.textContent).join(''); }

    getBoundingClientRect(): DOMRect {
        return { left: 40, top: 50, right: 120, bottom: 80, width: 80, height: 30, x: 40, y: 50 } as DOMRect;
    }

    /** `.a` だけを読む（属性のセレクタは何も見つけない）。 */
    querySelector(selector: string): FakeEl | null {
        if (!selector.startsWith('.')) return null;
        for (const child of this.children) {
            if (child.classes.has(selector.slice(1))) return child;
            const found = child.querySelector(selector);
            if (found) return found;
        }
        return null;
    }
}


const POMODORO: Measure = { type: 'interval', source: 'pomodoro', groups: pomodoroGroups(25, 5), at: START_CURSOR };
const COUNTUP: Measure = { type: 'countup' };
const COUNTDOWN: Measure = { type: 'countdown', totalSeconds: 1500 };
const RUNNING: Session = { kind: 'running', from: 0 };
const PENDING: Session = { kind: 'pending', record: { endMs: 0, seconds: 0, then: 'suspend' } };
const SUSPENDED: Session = { kind: 'suspended' };

function build() {
    const board = new TimerBoard({ persist: () => { }, render: () => { } });
    const presented: MenuAnchor[] = [];
    const renderer = new TimerRenderer({
        app: {} as never,
        plugin: {
            settings: { startHour: 0 },
            menuPresenter: { present: (_build: unknown, anchor: MenuAnchor) => { presented.push(anchor); return null; } },
        } as never,
        board, lifecycle: {} as TimerLifecycle,
        tailRow: () => undefined, container: {} as never,
        startTimer: () => { },
    });
    const internals = renderer as unknown as {
        bindStartOffset(container: FakeEl, timer: TimerState): void;
        updateTimes(itemEl: FakeEl, timer: TimerState, now: number): void;
        ringOptions(): Parameters<typeof TimerProgressUI.render>[2];
    };

    /** 開いた widget の輪の部分を描き、経過時間の表示を束縛する（`renderTimerItem` と同じ順）。 */
    const draw = (timer: TimerState): { item: FakeEl; display: FakeEl } => {
        const item = new FakeEl('timer-widget__item');
        const progress = item.createDiv('timer-widget__progress-container');
        TimerProgressUI.render(progress as unknown as HTMLElement, timerRing(timer, Date.now()), internals.ringOptions());
        internals.bindStartOffset(progress, timer);
        return { item, display: item.querySelector('.timer-widget__time-display')! };
    };
    const tick = (item: FakeEl, timer: TimerState): void => internals.updateTimes(item, timer, Date.now());

    const timerIn = (session: Session, measure: Measure = COUNTUP): TimerState => {
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
            recorded: { seconds: 0, count: 0 }, priorStartMs: null, expanded: true,
        };
        board.add(timer);
        return timer;
    };
    return { board, presented, draw, tick, timerIn };
}

/** ボタンとして読める形: 役割、Tab で止まること、名前。 */
function expectButton(display: FakeEl): void {
    expect(display.getAttribute('role')).toBe('button');
    expect(display.getAttribute('tabindex')).toBe('0');
    expect(display.getAttribute('aria-label')).toBe(t('timer.offsetStart'));
    expect(display.classes.has('timer-widget__time-display--offsettable')).toBe(true);
}

/** ただの数字: 役割も Tab の順も名前も無い。 */
function expectPlain(display: FakeEl): void {
    expect(display.getAttribute('role')).toBeNull();
    expect(display.getAttribute('tabindex')).toBeNull();
    expect(display.getAttribute('aria-label')).toBeNull();
    expect(display.classes.has('timer-widget__time-display--offsettable')).toBe(false);
}

const pressAll = (display: FakeEl): void => {
    display.dispatch('click');
    display.dispatch('keydown', { key: 'Enter' });
    display.dispatch('keydown', { key: ' ' });
};

beforeEach(() => {
    (globalThis as unknown as { document: unknown }).document = { createElementNS: () => new FakeEl() };
});
afterEach(() => {
    delete (globalThis as unknown as { document?: unknown }).document;
});

describe('the elapsed time of a running countup or countdown is a button that opens the shift menu', () => {
    it('it has a role, a place in the Tab order and a name, for both measures', () => {
        const h = build();
        for (const measure of [COUNTUP, COUNTDOWN]) {
            expectButton(h.draw(h.timerIn(RUNNING, measure)).display);
        }
    });

    it('a press opens the menu at the pointer; Enter and Space open it below the time, and are not left to the page', () => {
        const h = build();
        const { display } = h.draw(h.timerIn(RUNNING));
        const click = { clientX: 3, clientY: 4 };

        display.dispatch('click', click);
        const enter = display.dispatch('keydown', { key: 'Enter' });
        const space = display.dispatch('keydown', { key: ' ' });

        expect(h.presented).toHaveLength(3);
        expect(h.presented[0]).toMatchObject({ kind: 'mouseEvent', event: click });
        expect(h.presented[1]).toEqual({ kind: 'belowRect', rect: display.getBoundingClientRect() });
        expect(h.presented[2]).toEqual({ kind: 'belowRect', rect: display.getBoundingClientRect() });
        expect(enter.defaultPrevented).toBe(true);
        expect(space.defaultPrevented).toBe(true);
    });

    it('another key opens nothing and is left to the page', () => {
        const h = build();
        const { display } = h.draw(h.timerIn(RUNNING));

        const tab = display.dispatch('keydown', { key: 'Tab' });

        expect(h.presented).toEqual([]);
        expect(tab.defaultPrevented).toBe(false);
    });

    it('a tick moves the time and keeps the button, which holds the time alone', () => {
        const h = build();
        const timer = h.timerIn(RUNNING);
        const { item, display } = h.draw(timer);

        h.tick(item, timer);
        h.tick(item, timer);

        expectButton(display);
        expect(display.children.map(c => [...c.classes])).toEqual([['timer-widget__time-text']]);
        expect(display.querySelector('.timer-widget__time-text')?.text).toBe('10:00');
    });
});

describe('where the start cannot be shifted, the elapsed time is only a number', () => {
    it('suspended, waiting to record, and a Pomodoro: no role, no focus, and a press opens nothing', () => {
        const h = build();
        for (const timer of [h.timerIn(SUSPENDED), h.timerIn(PENDING), h.timerIn(SUSPENDED, COUNTDOWN), h.timerIn(RUNNING, POMODORO)]) {
            const { item, display } = h.draw(timer);
            expectPlain(display);
            pressAll(display);
            h.tick(item, timer);
            expectPlain(display);
        }
        expect(h.presented).toEqual([]);
    });

    it('a running timer suspended without a new render: the tick takes the button away, and a press opens nothing', () => {
        const h = build();
        const timer = h.timerIn(RUNNING);
        const { item, display } = h.draw(timer);
        expectButton(display);

        h.board.dispatch(timer, { type: 'stopped', then: 'suspend' });
        h.tick(item, timer);
        expectPlain(display);

        h.board.dispatch(timer, { type: 'recorded' });
        h.tick(item, timer);
        expectPlain(display);
        pressAll(display);
        expect(h.presented).toEqual([]);
    });

    it('resumed without a new render: the tick gives the button back', () => {
        const h = build();
        const timer = h.timerIn(SUSPENDED);
        const { item, display } = h.draw(timer);
        expectPlain(display);

        h.board.dispatch(timer, { type: 'resumed', pressedAt: Date.now() });
        h.tick(item, timer);

        expectButton(display);
        display.dispatch('keydown', { key: 'Enter' });
        expect(h.presented).toHaveLength(1);
    });
});
