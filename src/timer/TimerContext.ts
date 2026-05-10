/**
 * Shared context interface for Timer modules.
 *
 * Implemented by TimerWidget. All timer sub-modules receive this
 * via constructor injection to access shared state and cross-cutting operations.
 */

import { App } from 'obsidian';
import TaskViewerPlugin from '../main';
import { TimerInstance } from './TimerInstance';
import { TimerRecorder } from './TimerRecorder';

// ─── Constants ────────────────────────────────────────────────

export const IDLE_TIMER_ID = '__idle__';
export const STORAGE_VERSION = 5;
export const STORAGE_KEY_PREFIX = 'task-viewer.active-timers';
export const DEVICE_ID_KEY = 'task-viewer.device-id.v1';

// ─── Interface ────────────────────────────────────────────────

export interface TimerContext {
    readonly timers: Map<string, TimerInstance>;
    readonly intervalPrepareBaseElapsed: Map<string, number>;
    readonly recorder: TimerRecorder;
    readonly plugin: TaskViewerPlugin;
    readonly app: App;

    /** Trigger a full UI re-render. */
    render(): void;

    /** Partial update for a single timer item (tick path). */
    renderTimerItem(taskId: string): void;

    /** Persist all timer state to localStorage. */
    persistTimersToStorage(): void;

    /** Called after a non-idle timer is closed (for target ID cleanup). */
    onTimerClosed(timer: TimerInstance): void;

    /** Acquire the floating overlay container (creates it on first call). */
    ensureContainer(): HTMLElement;

    /** Tear down the floating overlay container (called when timers reach 0). */
    destroyContainer(): void;

    /** Pin badge state for the floating overlay. */
    getPinState(): 'pinned' | 'pending';

    /** Toggle pinned/pending — invoked by the pin badge click handler. */
    togglePin(): void;
}
