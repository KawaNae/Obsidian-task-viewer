/**
 * Shared context interface for Timer modules.
 *
 * Implemented by TimerWidget. All timer sub-modules receive this
 * via constructor injection to access shared state and cross-cutting operations.
 */

import type { App } from 'obsidian';
import type TaskViewerPlugin from '../main';
import type { TimerInstance, TimerStartConfig } from './TimerInstance';
import type { TimerRecorder } from './TimerRecorder';

// ─── Constants ────────────────────────────────────────────────

export const IDLE_TIMER_ID = '__idle__';

// ─── Interface ────────────────────────────────────────────────

export interface TimerContext {
    readonly timers: Map<string, TimerInstance>;
    readonly intervalPrepareBaseElapsed: Map<string, number>;
    readonly recorder: TimerRecorder;
    readonly plugin: TaskViewerPlugin;
    readonly app: App;

    /** Unified timer start API (implemented by TimerWidget). */
    startTimer(config: TimerStartConfig): void;

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

    /**
     * Whether the pin badge has any meaning right now. False when only one
     * window exists (mobile, or desktop with no popouts) — badge would have
     * nowhere to migrate to, so hide it entirely.
     */
    shouldShowPinBadge(): boolean;
}
