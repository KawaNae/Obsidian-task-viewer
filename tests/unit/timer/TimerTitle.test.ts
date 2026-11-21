import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimerTitle } from '../../../src/timer/TimerTitle';
import { TimerBoard } from '../../../src/timer/TimerBoard';
import { TimerRenderer } from '../../../src/timer/TimerRenderer';
import { TimerRuntime } from '../../../src/timer/TimerRuntime';
import type { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { restart } from '../../../src/timer/TimerClock';
import { newTimerId, type TimerState } from '../../../src/timer/TimerState';
import { renderCardMarkdown } from '../../../src/views/taskcard/CardMarkdown';
import type { TaskHubPanelOptions } from '../../../src/modals/hub/TaskHubPanel';
import type { Task } from '../../../src/types';
import { t } from '../../../src/i18n';
import { FakeEl } from '../helpers/fakeEl';

/**
 * The name in a timer's header is its tail row's name, and a button only while
 * the index has that row: a press, Enter or Space opens the row's hub with the
 * name field focused. Without the row it is plain, faint text, the timer's copy
 * of its subject's name. A link in the name is not followed; the press is the
 * name's. A name drawn from the same source is not drawn again.
 */

vi.mock('../../../src/views/taskcard/CardMarkdown', async () => {
    const { drawMarkdown } = await import('../helpers/fakeEl');
    return { renderCardMarkdown: vi.fn(drawMarkdown) };
});
vi.mock('obsidian', async (importOriginal) => ({
    ...await importOriginal<typeof import('obsidian')>(),
    setIcon: () => { },
}));

const NAME = '.timer-widget__title-name--row';

function rowOf(id: string, content: string): Task {
    return { id, content } as Task;
}

function timerNamed(name: string): TimerState {
    return {
        id: newTimerId(),
        subject: { kind: 'task', anchor: 'box' },
        file: 'notes/a.md', name, color: '', mode: 'child',
        measure: { type: 'countup' },
        clock: restart(Date.now()),
        session: { kind: 'running', from: 0 },
        tail: 'tv-tail', owned: [], opening: null,
        recorded: { seconds: 0, count: 0 }, priorStartMs: null, expanded: true,
    };
}

function build() {
    let row: Task | undefined;
    const opened: { taskId: string; options?: TaskHubPanelOptions }[] = [];
    const title = new TimerTitle({
        app: {} as never,
        tailRow: () => row,
        openTaskHub: (taskId, options) => { opened.push({ taskId, options }); },
    });
    const setRow = (next: Task | undefined): void => { row = next; };
    const mount = (timer: TimerState): { titleEl: FakeEl; name: FakeEl } => {
        const titleEl = new FakeEl('timer-widget__title');
        title.mount(titleEl as unknown as HTMLElement, timer);
        return { titleEl, name: titleEl.querySelector(NAME)! };
    };
    const sync = (titleEl: FakeEl, timer: TimerState): void => title.sync(titleEl as unknown as HTMLElement, timer);
    return { title, opened, setRow, mount, sync };
}

function expectButton(name: FakeEl): void {
    expect(name.getAttribute('role')).toBe('button');
    expect(name.getAttribute('tabindex')).toBe('0');
    expect(name.getAttribute('aria-label')).toBe(t('timer.openTask'));
    expect(name.classes.has('timer-widget__title-name--openable')).toBe(true);
}

function expectPlain(name: FakeEl): void {
    expect(name.getAttribute('role')).toBeNull();
    expect(name.getAttribute('tabindex')).toBeNull();
    expect(name.getAttribute('aria-label')).toBeNull();
    expect(name.classes.has('timer-widget__title-name--openable')).toBe(false);
}

const faint = (name: FakeEl): boolean => name.classes.has('timer-widget__title-name--placeholder');

const pressAll = (name: FakeEl): void => {
    name.dispatch('click');
    name.dispatch('keydown', { key: 'Enter' });
    name.dispatch('keydown', { key: ' ' });
};

beforeEach(() => { vi.mocked(renderCardMarkdown).mockClear(); });

describe('while the index has the tail row, the name is a button to its hub', () => {
    it('draws the row\'s name, without its timer icon and embeds, as a button', () => {
        const h = build();
        h.setRow(rowOf('r1', '⏱️ 資料集め ![[figure.png]]'));
        const { name } = h.mount(timerNamed('対象'));

        expectButton(name);
        expect(faint(name)).toBe(false);
        expect(name.textContent.trim()).toBe('資料集め');
        expect(vi.mocked(renderCardMarkdown).mock.calls[0][3]).toBe('notes/a.md');
    });

    it('a press, Enter and Space each open the row\'s hub once, on the name field, and are not left to the page', () => {
        const h = build();
        h.setRow(rowOf('r1', '資料集め'));
        const { name } = h.mount(timerNamed('対象'));

        const click = name.dispatch('click');
        const enter = name.dispatch('keydown', { key: 'Enter' });
        const space = name.dispatch('keydown', { key: ' ' });

        expect(h.opened).toEqual([
            { taskId: 'r1', options: { focusField: 'name' } },
            { taskId: 'r1', options: { focusField: 'name' } },
            { taskId: 'r1', options: { focusField: 'name' } },
        ]);
        expect([click, enter, space].map(e => e.defaultPrevented)).toEqual([true, true, true]);
    });

    it('another key opens nothing and is left to the page', () => {
        const h = build();
        h.setRow(rowOf('r1', '資料集め'));
        const { name } = h.mount(timerNamed('対象'));

        const tab = name.dispatch('keydown', { key: 'Tab' });

        expect(h.opened).toEqual([]);
        expect(tab.defaultPrevented).toBe(false);
    });

    it('a press opens the row the index has at the press', () => {
        const h = build();
        h.setRow(rowOf('r1', '資料集め'));
        const { name } = h.mount(timerNamed('対象'));

        h.setRow(rowOf('r2', '資料集め'));
        name.dispatch('click');

        expect(h.opened).toEqual([{ taskId: 'r2', options: { focusField: 'name' } }]);
    });

    it('a row with no name shows the subject\'s name, faint, and is still a button', () => {
        const h = build();
        h.setRow(rowOf('r1', ''));
        const { name } = h.mount(timerNamed('2026-09-21'));

        expectButton(name);
        expect(faint(name)).toBe(true);
        expect(name.textContent).toBe('2026-09-21');
        name.dispatch('click');
        expect(h.opened).toEqual([{ taskId: 'r1', options: { focusField: 'name' } }]);
    });

    it('with no subject\'s name either, a dash', () => {
        const h = build();
        h.setRow(rowOf('r1', '⏱️'));
        const { name } = h.mount(timerNamed(''));

        expectButton(name);
        expect(name.textContent).toBe('—');
    });
});

describe('a link in the name is not followed', () => {
    it('the link is drawn, Tab does not stop at it, and a press on it opens the hub and not the link', () => {
        const h = build();
        h.setRow(rowOf('r1', '[[ノート]] を読む'));
        const { name } = h.mount(timerNamed('対象'));
        const link = name.querySelector('a')!;

        expect(link.textContent).toBe('ノート');
        expect(link.getAttribute('tabindex')).toBe('-1');
        const click = link.dispatch('click');
        const middle = link.dispatch('auxclick', { button: 1 });

        expect(click.defaultPrevented).toBe(true);
        expect(middle.defaultPrevented).toBe(true);
        expect(h.opened).toEqual([{ taskId: 'r1', options: { focusField: 'name' } }]);
    });

    it('a press after the row went and before the next change of the index opens nothing, and its link is still not followed', () => {
        const h = build();
        h.setRow(rowOf('r1', '[[ノート]] を読む'));
        const timer = timerNamed('対象');
        const { titleEl, name } = h.mount(timer);
        const link = name.querySelector('a')!;
        h.setRow(undefined);

        expect(link.dispatch('click').defaultPrevented).toBe(true);
        expect(h.opened).toEqual([]);
        h.sync(titleEl, timer);
        expectPlain(name);
    });
});

describe('while the index does not have the tail row, the name is plain text', () => {
    it('shows the subject\'s name, faint, and a press, Enter or Space opens nothing', () => {
        const h = build();
        const { name } = h.mount(timerNamed('対象'));

        expectPlain(name);
        expect(faint(name)).toBe(true);
        expect(name.textContent).toBe('対象');
        expect(renderCardMarkdown).not.toHaveBeenCalled();
        pressAll(name);
        expect(h.opened).toEqual([]);
    });

    it('becomes a button when the row comes, and plain again when it goes', () => {
        const h = build();
        const timer = timerNamed('対象');
        const { titleEl, name } = h.mount(timer);
        expectPlain(name);

        h.setRow(rowOf('r1', '資料集め'));
        h.sync(titleEl, timer);
        expectButton(name);
        expect(name.textContent.trim()).toBe('資料集め');

        h.setRow(undefined);
        h.sync(titleEl, timer);
        expectPlain(name);
        expect(faint(name)).toBe(true);
        expect(name.textContent).toBe('対象');
    });
});

describe('a change of the index draws the name again only when what it is drawn from changed', () => {
    it('the same row, name and note are not drawn again; a new name, or a note renamed, is', () => {
        const h = build();
        h.setRow(rowOf('r1', '資料集め'));
        const timer = timerNamed('対象');
        const { titleEl, name } = h.mount(timer);
        expect(renderCardMarkdown).toHaveBeenCalledTimes(1);

        h.sync(titleEl, timer);
        h.sync(titleEl, timer);
        expect(renderCardMarkdown).toHaveBeenCalledTimes(1);

        h.setRow(rowOf('r1', '資料まとめ'));
        h.sync(titleEl, timer);
        expect(renderCardMarkdown).toHaveBeenCalledTimes(2);
        expect(name.textContent.trim()).toBe('資料まとめ');
        expect(name.querySelectorAll('p')).toHaveLength(1);

        (timer as { file: string }).file = 'notes/b.md';
        h.sync(titleEl, timer);
        expect(renderCardMarkdown).toHaveBeenCalledTimes(3);
        expect(vi.mocked(renderCardMarkdown).mock.calls[2][3]).toBe('notes/b.md');
    });

    it('the faint name follows the subject\'s name', () => {
        const h = build();
        const timer = timerNamed('対象');
        const { titleEl, name } = h.mount(timer);

        (timer as { name: string }).name = '対象（改名）';
        h.sync(titleEl, timer);

        expect(name.textContent).toBe('対象（改名）');
    });
});

describe('a folded widget keeps the name button in its header', () => {
    it('the header of a folded timer has the name, a button that opens the row\'s hub', () => {
        const opened: string[] = [];
        const row = rowOf('r1', '資料集め');
        const board = new TimerBoard({ persist: () => { }, render: () => { } });
        const renderer = new TimerRenderer({
            app: {} as never,
            plugin: { openTaskHub: (taskId: string) => { opened.push(taskId); } } as never,
            board, runtime: new TimerRuntime(), lifecycle: {} as TimerLifecycle,
            tailRow: () => row, container: {} as never,
            startTimer: () => { },
        });
        const timer = { ...timerNamed('対象'), expanded: false };
        board.add(timer);
        const container = new FakeEl();

        (renderer as unknown as { renderTimerItem(c: FakeEl, t: TimerState, now: number): void })
            .renderTimerItem(container, timer, Date.now());

        const name = container.querySelector('.timer-widget__header')!.querySelector(NAME)!;
        expect(container.querySelector('.timer-widget__content')).toBeNull();
        expectButton(name);
        name.dispatch('click');
        expect(opened).toEqual(['r1']);
    });
});
