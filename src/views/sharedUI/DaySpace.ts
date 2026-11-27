import type { Menu } from 'obsidian';
import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { TouchLongPressBinder } from '../../interaction/menu/TouchLongPressBinder';
import { appendCreateItems, appendDayTimerItems } from '../sharedLogic/EmptySpaceActions';

/**
 * The empty space of one day on a view: an element that covers the day's
 * column where neither a card nor the day's link is, and the menu a press
 * on it opens (`EmptySpaceActions`).
 */
export interface DaySpace {
    /** The day the element stands for. */
    date: string;
    /**
     * The time under a press `offsetY` pixels down the element's padding
     * box, in minutes after the day's midnight, where the element lays the
     * day out in time; absent, a press knows the day alone. `offsetY` is 0
     * or more: a press on the top border is at 0.
     */
    minutesAt?: (offsetY: number) => number;
    /** Whether the menu offers the timers on the day after the creates. */
    timers: boolean;
    /**
     * Elements drawn over the space that take a press for a hover of their
     * own (a tooltip) and are the day's empty space for a right click or a
     * long press all the same, anywhere in them.
     */
    covers?: HTMLElement[];
}

/**
 * Open the day's menu from a right click or a long press on `el` itself, or
 * in one of the space's covers; a press that lands on a card or a link
 * inside it is theirs. Both read the point the same way, from its viewport
 * coordinates, down `el`.
 */
export function bindDaySpace(el: HTMLElement, plugin: PluginContext & TimerHost, space: DaySpace): void {
    const open = (x: number, y: number) => {
        // A point on the top border is read as the padding box's top edge,
        // so that the time under it is the column's first minute.
        const minutes = space.minutesAt?.(Math.max(0, y - el.getBoundingClientRect().top - el.clientTop));
        plugin.menuPresenter.present((menu) => {
            appendDaySpaceMenuItems(menu, plugin, space, minutes);
        }, { kind: 'position', x, y });
    };
    const getThreshold = () => plugin.settings.longPressThreshold;
    TouchLongPressBinder.bind(el, { getThreshold, targetCheck: (t) => t === el, onLongPress: open });
    for (const cover of space.covers ?? []) {
        TouchLongPressBinder.bind(cover, {
            getThreshold,
            targetCheck: (t) => t instanceof Node && cover.contains(t),
            onLongPress: open,
        });
    }
}

/**
 * Fill in the menu of a press on `space`, at `minutes` after the day's
 * midnight where it knows a time: the two ways to create a task, then,
 * where the space offers them, the two timers on the day apart from them.
 */
export function appendDaySpaceMenuItems(
    menu: Menu,
    plugin: PluginContext & TimerHost,
    space: Pick<DaySpace, 'date' | 'timers'>,
    minutes?: number,
): void {
    appendCreateItems(menu, plugin, space.date, minutes);
    if (!space.timers) return;
    menu.addSeparator();
    appendDayTimerItems(menu, plugin, space.date);
}
