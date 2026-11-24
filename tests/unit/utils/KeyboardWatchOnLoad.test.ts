import { describe, it, expect, vi, afterEach } from 'vitest';

// The plugin's module reads these from Obsidian as it is imported; the
// shared mock has no use for them elsewhere.
vi.mock('obsidian', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    PluginSettingTab: class {},
    MarkdownRenderer: class {},
    Platform: { isMobile: true },
    apiVersion: '0',
    getIconIds: () => [],
    setTooltip: () => {},
}));

import TaskViewerPlugin from '../../../src/main';
import { KeyboardRoom } from '../../../src/utils/KeyboardRoom';
import { KEYBOARD_OVERLAP_VAR } from '../../../src/utils/RoomLayout';
import { untrackAllKeyboards } from '../../../src/utils/KeyboardWatch';

class Target {
    private listeners = new Map<string, ((e: unknown) => void)[]>();
    addEventListener(type: string, fn: (e: unknown) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    removeEventListener(type: string, fn: (e: unknown) => void) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
    }
    fire(type: string, e: unknown = {}) {
        for (const fn of this.listeners.get(type) ?? []) fn(e);
    }
}

/** Obsidian mobile's window: no visualViewport that moves, the keyboard told by Capacitor only. */
class MobileWindow extends Target {
    innerHeight = 800;
    visualViewport = undefined;
}

/** An overlay's root, as far as the keyboard room reads and writes it. */
class Root extends Target {
    ownerDocument = new Target();
    vars = new Map<string, string>();
    style = {
        setProperty: (name: string, value: string) => { this.vars.set(name, value); },
        removeProperty: (name: string) => { this.vars.delete(name); },
    };
    contains() { return false; }
}

describe('the keyboard as the plugin loads', () => {
    const savedWindow = (globalThis as { window?: unknown }).window;
    afterEach(() => {
        untrackAllKeyboards();
        (globalThis as { window?: unknown }).window = savedWindow;
    });

    it('has an overlay first opened while the keyboard is up know how much of the window it covers, the show having come before any overlay', () => {
        const win = new MobileWindow();
        (globalThis as { window?: unknown }).window = win;

        // Only what onload does before its first wait is looked at here: the
        // rest asks for an app the mock does not give, and is let fail.
        const plugin = new (TaskViewerPlugin as unknown as new () => { onload(): Promise<void> })();
        plugin.onload().catch(() => {});

        win.fire('keyboardDidShow', { keyboardHeight: 336 }); // typing in a note

        const root = new Root();
        const body = Object.assign(new Target(), { scrollTop: 0, scrollTo() {} });
        const room = new KeyboardRoom(root as never, win as never, body as never);
        room.attach();

        expect(root.vars.get(KEYBOARD_OVERLAP_VAR)).toBe('336px');
        room.detach();
    });
});
