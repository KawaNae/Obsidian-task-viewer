import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimelineView } from '../../../../src/views/timelineview/TimelineView';

/**
 * A change of the stylesheet (a font, its size, a theme) leaves the day
 * columns as wide, so no resize tells the lane of it: the view hears of it
 * from the workspace's `css-change` and has the lane measured again. The
 * view is opened on a stand-in of itself, its parts that the wiring does
 * not reach left out, and its workspace a stand-in that keeps the handlers
 * it is given, as Obsidian's does, until the view lets them go as it
 * closes.
 */

vi.mock('../../../../src/views/timelineview/TimelineToolbar', () => ({ TimelineToolbar: class { } }));
vi.mock('../../../../src/views/sharedUI/AllDaySectionRenderer', () => ({ AllDaySectionRenderer: class { } }));
vi.mock('../../../../src/views/sharedUI/DateHeaderRenderer', () => ({ DateHeaderRenderer: class { } }));
vi.mock('../../../../src/views/sharedUI/PeriodicHeaderRenderer', () => ({ PeriodicHeaderRenderer: class { } }));
vi.mock('../../../../src/views/timelineview/renderers/GridRenderer', () => ({ GridRenderer: class { } }));
vi.mock('../../../../src/views/sharedUI/MoonPhaseRenderer', () => ({ MoonPhaseRenderer: class { } }));
vi.mock('../../../../src/interaction/drag/DragHandler', () => ({ DragHandler: class { destroy(): void { } } }));
vi.mock('../../../../src/interaction/selection/SelectionController', () => ({
    SelectionController: class {
        attachBackgroundClick(): void { }
        attachDeleteListener(): () => void { return () => { }; }
    },
}));

class FakeResizeObserver {
    observe(): void { }
    unobserve(): void { }
    disconnect(): void { }
}

/** The workspace's events: the handlers given to `on`, until each is let go. */
function workspace() {
    const handlers = new Map<string, Set<() => void>>();
    return {
        on(name: string, handler: () => void) {
            if (!handlers.has(name)) handlers.set(name, new Set());
            handlers.get(name)!.add(handler);
            return { off: () => handlers.get(name)!.delete(handler) };
        },
        trigger(name: string): void {
            for (const handler of handlers.get(name) ?? []) handler();
        },
    };
}

/**
 * A Timeline view opened as Obsidian opens one, and closed: a close lets go
 * of what `registerEvent` was given, as a component unloading does.
 */
function openTimeline() {
    const ws = workspace();
    const registered: { off(): void }[] = [];
    const view = Object.assign(Object.create(TimelineView.prototype), {
        app: { workspace: ws },
        plugin: { settings: { startHour: 0 } },
        contentEl: { addClass(): void { } },
        hoverParent: { dispose(): void { } },
        frames: { dispose(): void { } },
        zoomSettle: null,
        toolbarContext: () => ({}),
        registerEvent: (ref: { off(): void }) => { registered.push(ref); },
        registerDomEvent: () => { },
    });
    (view as unknown as { openView(): void }).openView();
    const renderer = (view as unknown as { timelineRenderer: { measureLanesAgain(): void } }).timelineRenderer;
    const measured = vi.spyOn(renderer, 'measureLanesAgain');
    return {
        workspace: ws,
        measured,
        close(): void {
            (view as unknown as { closeView(): void }).closeView();
            registered.forEach(ref => ref.off());
        },
    };
}

describe('TimelineView measuring the lane again when the stylesheet changes', () => {
    beforeEach(() => vi.stubGlobal('ResizeObserver', FakeResizeObserver));
    afterEach(() => vi.unstubAllGlobals());

    it('measures the lane again at each change of the stylesheet', () => {
        const timeline = openTimeline();
        timeline.workspace.trigger('css-change');
        expect(timeline.measured).toHaveBeenCalledTimes(1);
        timeline.workspace.trigger('css-change');
        expect(timeline.measured).toHaveBeenCalledTimes(2);
    });

    it('measures it no more once the view is closed', () => {
        const timeline = openTimeline();
        timeline.close();
        timeline.workspace.trigger('css-change');
        expect(timeline.measured).not.toHaveBeenCalled();
    });
});
