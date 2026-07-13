/**
 * Timer DOM rendering: pin badge, item headers, controls, progress ring.
 *
 * The actual container element + drag handling + viewport clamp + window
 * migration live in FloatingOverlayHost / TimerWidgetWindowObserver, which
 * the renderer reaches through TimerContext.ensureContainer/destroyContainer.
 * This separation lets the same item DOM be rebuilt in any window without
 * the renderer caring which document it lives in.
 */

import { setIcon } from 'obsidian';
import type { DisplayTask } from '../types';
import {
    CountdownTimer,
    CountupTimer,
    IdleTimer,
    IntervalTimer,
    TimerInstance,
} from './TimerInstance';
import { TimerContext } from './TimerContext';
import { TimerCreator } from './TimerCreator';
import { TimerLifecycle } from './TimerLifecycle';
import { TimerRecorder } from './TimerRecorder';
import { getDisplayFileName, getTaskDisplayName } from '../services/parsing/utils/TaskContent';
import { TaskStyling } from '../views/sharedUI/TaskStyling';
import { TimerProgressUI } from './TimerProgressUI';
import { TimerSettingsMenu } from './TimerSettingsMenu';
import { AudioUtils } from './AudioUtils';
import { TimeFormatter } from '../utils/TimeFormatter';
import { t } from '../i18n';
import { getEffectiveColor } from '../services/data/EffectiveProperties';
import { canTriggerFlow } from '../services/flow/FlowTrigger';
import { NextTaskSuggester, suggestionKey } from './NextTaskSuggester';

export class TimerRenderer {
    private closeConfirmTimers = new Map<string, number>();
    private suggester: NextTaskSuggester;

    constructor(
        private ctx: TimerContext,
        private lifecycle: TimerLifecycle,
        private creator: TimerCreator,
    ) {
        this.suggester = new NextTaskSuggester(ctx.plugin);
    }

    // ─── Render ──────────────────────────────────────────────

    render(): void {
        if (this.ctx.timers.size === 0) {
            this.ctx.destroyContainer();
            return;
        }
        const container = this.ctx.ensureContainer();
        container.empty();
        this.renderPinBadge(container);
        for (const [taskId] of this.ctx.timers) {
            this.renderTimerItem(taskId);
        }
    }

    renderTimerItem(taskId: string): void {
        const container = this.ctx.ensureContainer();

        const timer = this.ctx.timers.get(taskId);
        if (!timer) return;

        let itemEl = container.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement;
        const isNewItem = !itemEl;

        if (isNewItem) {
            itemEl = container.createDiv('timer-widget__item');
            itemEl.dataset.taskId = taskId;
            if (timer.taskColor) {
                TaskStyling.applyTaskColor(itemEl, timer.taskColor);
            }
        }
        const isIdle = this.lifecycle.isIdleTimer(taskId);
        itemEl.toggleClass('timer-widget__item--idle', isIdle);

        // Idle item shows a next-task suggestion; rebuild when it changes.
        const nextKey = isIdle ? suggestionKey(this.suggester.getSuggestion()) : '';

        const currentExpanded = itemEl.dataset.expanded === 'true';
        const needsRebuild = isNewItem
            || currentExpanded !== timer.isExpanded
            || (isIdle && itemEl.dataset.nextTaskKey !== nextKey);

        if (needsRebuild) {
            itemEl.empty();
            itemEl.dataset.expanded = timer.isExpanded.toString();
            if (isIdle) {
                itemEl.dataset.nextTaskKey = nextKey;
            }

            // Header
            const header = itemEl.createDiv('timer-widget__header');

            const titleContainer = header.createDiv('timer-widget__title');

            if (timer.recordMode !== 'self' && timer.timerType !== 'idle') {
                // Child mode: inline input as title
                const labelInput = titleContainer.createEl('input', {
                    type: 'text',
                    cls: 'timer-widget__title-input',
                    placeholder: '\u2014',
                    value: timer.customLabel,
                    attr: { size: '1' },
                });
                labelInput.oninput = () => {
                    timer.customLabel = labelInput.value;
                    this.ctx.persistTimersToStorage();
                };
            } else {
                // Self/idle mode: static task name
                const nameSpan = titleContainer.createSpan('timer-widget__title-name');
                nameSpan.setText(timer.taskName);
            }

            const fileName = getDisplayFileName(timer.taskName, timer.taskFile);
            if (fileName) {
                const fileSpan = titleContainer.createSpan('timer-widget__title-file');
                fileSpan.setText(fileName);
            }

            if (!timer.isExpanded) {
                const timeSpan = header.createSpan('timer-widget__header-time');
                timeSpan.dataset.timeDisplay = 'header';
                timeSpan.setText(this.getTimerDisplayText(timer));
                timeSpan.toggleClass('timer-widget__header-time--break', timer.phase === 'break');

                if (timer.timerType === 'interval') {
                    const group = timer.groups[timer.currentGroupIndex];
                    const segment = this.creator.getCurrentIntervalSegment(timer);
                    if (group && segment) {
                        const repeatSpan = header.createSpan('timer-widget__header-repeat');
                        const repeatText = group.repeatCount === 0
                            ? `${segment.label} ${timer.currentRepeatIndex + 1}`
                            : `${segment.label} ${timer.currentRepeatIndex + 1}/${group.repeatCount}`;
                        repeatSpan.setText(repeatText);
                    }
                }
            }

            // Settings button (only for pomodoro-like interval timers)
            if (timer.timerType === 'interval' && timer.intervalSource === 'pomodoro') {
                const settingsBtn = header.createEl('button', { cls: 'timer-widget__settings-btn' });
                setIcon(settingsBtn, 'settings');
                settingsBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.showSettingsMenu(e, taskId);
                };
            }

            // Toggle button
            const toggleBtn = header.createEl('button', { cls: 'timer-widget__toggle-btn' });
            setIcon(toggleBtn, timer.isExpanded ? 'chevron-down' : 'chevron-right');
            toggleBtn.onclick = () => {
                timer.isExpanded = !timer.isExpanded;
                this.renderTimerItem(taskId);
                this.ctx.persistTimersToStorage();
            };

            // Close button
            const closeBtn = header.createEl('button', { cls: 'timer-widget__close-btn' });
            setIcon(closeBtn, 'x');
            closeBtn.onclick = () => {
                // Skip confirmation for non-running timers
                if (!timer.isRunning) {
                    this.clearCloseConfirmTimer(taskId);
                    this.lifecycle.closeTimer(taskId);
                    return;
                }
                // Idle timers close without confirmation, but ignore accidental clicks
                // right after the idle timer spawns (e.g. double-clicking a previous close)
                if (timer.phase === 'idle') {
                    if (Date.now() - timer.startTimeMs < 500) return;
                    this.clearCloseConfirmTimer(taskId);
                    this.lifecycle.closeTimer(taskId);
                    return;
                }

                // Already in confirming state → execute close
                if (closeBtn.classList.contains('timer-widget__close-btn--confirming')) {
                    this.clearCloseConfirmTimer(taskId);
                    this.lifecycle.closeTimer(taskId);
                    return;
                }

                // Enter confirming state
                closeBtn.classList.add('timer-widget__close-btn--confirming');
                this.closeConfirmTimers.set(taskId, window.setTimeout(() => {
                    closeBtn.classList.remove('timer-widget__close-btn--confirming');
                    closeBtn.classList.add('timer-widget__close-btn--fading');
                    this.closeConfirmTimers.delete(taskId);
                    window.setTimeout(() => {
                        closeBtn.classList.remove('timer-widget__close-btn--fading');
                    }, 500);
                }, 2000));
            };

            // Expandable content
            if (timer.isExpanded) {
                const content = itemEl.createDiv('timer-widget__content');
                this.renderTimerUI(content, timer);
            }
        } else {
            this.updateTimerDisplay(itemEl, timer);
        }
    }

    // ─── Destroy ─────────────────────────────────────────────

    destroy(): void {
        for (const id of this.closeConfirmTimers.values()) {
            clearTimeout(id);
        }
        this.closeConfirmTimers.clear();
        this.ctx.destroyContainer();
    }

    // ─── Pin badge ───────────────────────────────────────────

    private renderPinBadge(container: HTMLElement): void {
        const existing = container.querySelector(':scope > .timer-widget__pin-badge') as HTMLButtonElement | null;
        if (!this.ctx.shouldShowPinBadge()) {
            // No second window to migrate to — pin would be a no-op control.
            existing?.remove();
            return;
        }
        const state = this.ctx.getPinState();
        const badge = existing ?? (() => {
            const b = container.createEl('button', { cls: 'timer-widget__pin-badge' });
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                this.ctx.togglePin();
            });
            return b;
        })();
        badge.classList.toggle('timer-widget__pin-badge--pinned', state === 'pinned');
        badge.classList.toggle('timer-widget__pin-badge--pending', state === 'pending');
        badge.empty();
        const iconHost = badge.createSpan();
        setIcon(iconHost, state === 'pinned' ? 'pin' : 'pin-off');
        badge.setAttribute(
            'aria-label',
            state === 'pinned' ? t('timer.pinPinned') : t('timer.pinPending'),
        );
    }

    // ─── Private ─────────────────────────────────────────────

    private clearCloseConfirmTimer(taskId: string): void {
        const id = this.closeConfirmTimers.get(taskId);
        if (id !== undefined) {
            clearTimeout(id);
            this.closeConfirmTimers.delete(taskId);
        }
    }

    private updateTimerDisplay(itemEl: HTMLElement, timer: TimerInstance): void {
        this.syncTimerTaskInfo(itemEl, timer);

        const headerTime = itemEl.querySelector('[data-time-display="header"]') as HTMLElement;
        if (headerTime) {
            headerTime.setText(this.getTimerDisplayText(timer));
            headerTime.toggleClass('timer-widget__header-time--break', timer.phase === 'break');
        }
        TimerProgressUI.updateDisplay(itemEl, timer, this.formatSignedTime.bind(this));
    }

    private syncTimerTaskInfo(itemEl: HTMLElement, timer: TimerInstance): void {
        if (this.lifecycle.isIdleTimer(timer.id) || timer.id.startsWith('daily-')) return;

        const task = this.ctx.plugin.getTaskIndex().getTask(timer.taskId);
        if (!task) return;

        const newName = getTaskDisplayName(task);
        if (newName !== timer.taskName) {
            timer.taskName = newName;
            const nameEl = itemEl.querySelector('.timer-widget__title-name') as HTMLElement;
            if (nameEl) nameEl.setText(newName);
        }

        const newColor = getEffectiveColor(task) ?? '';
        if (newColor !== timer.taskColor) {
            timer.taskColor = newColor;
            if (newColor) {
                TaskStyling.applyTaskColor(itemEl, newColor);
            }
        }
    }

    private renderTimerUI(container: HTMLElement, timer: TimerInstance): void {

        const progressContainer = container.createDiv('timer-widget__progress-container');
        this.renderCircularProgress(progressContainer, timer);

        const controls = container.createDiv('timer-widget__controls');
        this.renderControls(controls, timer);
    }

    private renderCircularProgress(container: HTMLElement, timer: TimerInstance): void {
        TimerProgressUI.render(container, timer, this.formatSignedTime.bind(this));
    }

    private renderControls(container: HTMLElement, timer: TimerInstance): void {
        switch (timer.timerType) {
            case 'countup':
                this.renderCountupControls(container, timer);
                return;
            case 'countdown':
                this.renderCountdownControls(container, timer);
                return;
            case 'interval':
                this.renderIntervalControls(container, timer);
                return;
            case 'idle':
                this.renderIdleControls(container, timer);
                return;
            default:
                return;
        }
    }

    /** Idle item: suggest the next task to start (current window > upcoming today). */
    private renderIdleControls(container: HTMLElement, timer: IdleTimer): void {
        const suggestion = this.suggester.getSuggestion();
        if (!suggestion) return;
        const { task, kind } = suggestion;

        const next = container.createDiv('timer-widget__next');
        const color = getEffectiveColor(task);
        if (color) {
            TaskStyling.applyTaskColor(next, color);
        }

        const info = next.createDiv('timer-widget__next-info');
        info.createSpan({
            cls: 'timer-widget__next-label',
            text: kind === 'current' ? t('timer.nextCurrent') : t('timer.nextUpcoming'),
        });
        info.createSpan({
            cls: 'timer-widget__next-name',
            text: getTaskDisplayName(task),
        });
        if (task.effectiveStartTime && task.effectiveEndTime) {
            info.createSpan({
                cls: 'timer-widget__next-time',
                text: `${task.effectiveStartTime}–${task.effectiveEndTime}`,
            });
        }

        const startBtn = next.createEl('button', {
            cls: 'timer-widget__btn timer-widget__btn--primary timer-widget__next-start',
        });
        setIcon(startBtn, 'play');
        startBtn.createSpan({ text: ` ${t('timer.start')}` });
        startBtn.onclick = () => {
            // Same accidental-click guard as the idle close button
            if (Date.now() - timer.startTimeMs < 500) return;
            this.startSuggestedTask(task);
        };
    }

    /**
     * Mirrors the task card's "Track self → Countup" start. Tasks whose
     * completion would trigger a flow command must not have their start
     * date rewritten (self mode does), so they record as child instead.
     */
    private startSuggestedTask(task: DisplayTask): void {
        const selfUnsafe = canTriggerFlow(task, this.ctx.plugin.settings.statusDefinitions);
        this.ctx.startTimer({
            taskId: task.id,
            taskName: getTaskDisplayName(task),
            taskOriginalText: task.originalText,
            taskFile: task.file,
            taskColor: getEffectiveColor(task) ?? '',
            recordMode: selfUnsafe ? 'child' : 'self',
            parserId: task.parserId,
            timerTargetId: task.timerTargetId ?? task.blockId,
            autoStart: true,
            timerType: 'countup',
        });
    }

    private renderCountupControls(container: HTMLElement, timer: CountupTimer): void {
        if (timer.phase === 'idle') {
            const startBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--primary'
            });
            setIcon(startBtn, 'play');
            startBtn.createSpan({ text: ' Start' });
            startBtn.onclick = () => {
                timer.phase = 'work';
                timer.startTimeMs = Date.now();
                timer.pausedElapsedTime = 0;
                timer.elapsedTime = 0;
                timer.isRunning = true;
                this.lifecycle.startTimerTicker(timer.id);
                AudioUtils.playStartSound();
                this.render();
                this.ctx.persistTimersToStorage();
            };
        } else if (timer.isRunning) {
            const stopBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--secondary'
            });
            setIcon(stopBtn, 'square');
            stopBtn.createSpan({ text: ' Stop' });
            stopBtn.onclick = async () => {
                this.lifecycle.pauseTimer(timer);
                AudioUtils.playFinishSound();

                if (timer.recordMode === 'self') {
                    await this.ctx.recorder.updateTaskDirectly(timer);
                } else {
                    await this.ctx.recorder.addSessionRecord(timer);
                }

                this.lifecycle.closeTimer(timer.id);
            };
        } else {
            const resumeBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--primary'
            });
            setIcon(resumeBtn, 'play');
            resumeBtn.createSpan({ text: ' Resume' });
            resumeBtn.onclick = () => {
                this.lifecycle.resumeTimer(timer);
            };
        }
    }

    private renderCountdownControls(container: HTMLElement, timer: CountdownTimer): void {
        if (timer.phase === 'idle' && timer.elapsedTime === 0) {
            const startBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--primary'
            });
            setIcon(startBtn, 'play');
            startBtn.createSpan({ text: ' Start' });
            startBtn.onclick = () => {
                timer.phase = 'work';
                timer.startTimeMs = Date.now();
                timer.pausedElapsedTime = 0;
                timer.elapsedTime = 0;
                timer.timeRemaining = timer.totalTime;
                timer.isRunning = true;
                this.lifecycle.startTimerTicker(timer.id);
                AudioUtils.playStartSound();
                this.render();
                this.ctx.persistTimersToStorage();
            };
            return;
        }

        if (timer.isRunning) {
            const stopBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--secondary'
            });
            setIcon(stopBtn, 'square');
            stopBtn.createSpan({ text: ' Stop' });
            stopBtn.onclick = async () => {
                this.lifecycle.pauseTimer(timer);
                AudioUtils.playFinishSound();
                if (timer.recordMode === 'self') {
                    await this.ctx.recorder.updateTaskDirectly(timer);
                } else {
                    await this.ctx.recorder.addCountdownRecord(timer);
                }
                this.lifecycle.closeTimer(timer.id);
            };
            return;
        }

        const resumeBtn = container.createEl('button', {
            cls: 'timer-widget__btn timer-widget__btn--primary'
        });
        setIcon(resumeBtn, 'play');
        resumeBtn.createSpan({ text: ' Resume' });
        resumeBtn.onclick = () => {
            this.lifecycle.resumeTimer(timer);
        };
    }

    private renderIntervalControls(container: HTMLElement, timer: IntervalTimer): void {
        if (timer.phase === 'idle') {
            const startBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--primary'
            });
            setIcon(startBtn, 'play');
            startBtn.createSpan({ text: ' Start' });
            startBtn.onclick = () => {
                const segment = this.creator.getCurrentIntervalSegment(timer);
                if (!segment) return;
                timer.phase = segment.type;
                timer.segmentTimeRemaining = segment.durationSeconds;
                timer.startTimeMs = Date.now();
                timer.pausedElapsedTime = 0;
                timer.totalElapsedTime = this.creator.computeIntervalCompletedDuration(timer);
                timer.isRunning = true;
                this.lifecycle.startTimerTicker(timer.id);
                AudioUtils.playStartSound();
                this.render();
                this.ctx.persistTimersToStorage();
            };
            return;
        }

        if (timer.phase === 'prepare') {
            const resumeBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--primary'
            });
            setIcon(resumeBtn, 'play');
            resumeBtn.createSpan({ text: ' Resume' });
            resumeBtn.onclick = () => {
                this.lifecycle.resumeTimer(timer);
            };

            const stopBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--secondary'
            });
            setIcon(stopBtn, 'square');
            stopBtn.createSpan({ text: ' Stop' });
            stopBtn.onclick = async () => {
                this.lifecycle.pauseOrSnapshotIntervalForStop(timer);
                AudioUtils.playFinishSound();
                if (timer.recordMode === 'self') {
                    await this.ctx.recorder.updateTaskDirectly(timer);
                } else {
                    await this.ctx.recorder.addIntervalRecord(timer);
                }
                this.lifecycle.closeTimer(timer.id);
            };
            return;
        }

        if (timer.isRunning) {
            const pauseBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--secondary'
            });
            setIcon(pauseBtn, 'pause');
            pauseBtn.createSpan({ text: ' Pause' });
            pauseBtn.onclick = () => {
                this.lifecycle.pauseIntervalToPrepare(timer);
                AudioUtils.playPauseSound();
                this.render();
                this.ctx.persistTimersToStorage();
            };
            return;
        }

        const resumeBtn = container.createEl('button', {
            cls: 'timer-widget__btn timer-widget__btn--primary'
        });
        setIcon(resumeBtn, 'play');
        resumeBtn.createSpan({ text: ' Resume' });
        resumeBtn.onclick = () => {
            this.lifecycle.resumeTimer(timer);
        };

        const stopBtn = container.createEl('button', {
            cls: 'timer-widget__btn timer-widget__btn--secondary'
        });
        setIcon(stopBtn, 'square');
        stopBtn.createSpan({ text: ' Stop' });
        stopBtn.onclick = async () => {
            this.lifecycle.pauseOrSnapshotIntervalForStop(timer);
            AudioUtils.playFinishSound();
            if (timer.recordMode === 'self') {
                await this.ctx.recorder.updateTaskDirectly(timer);
            } else {
                await this.ctx.recorder.addIntervalRecord(timer);
            }
            this.lifecycle.closeTimer(timer.id);
        };
    }


    private formatSignedTime(seconds: number): string {
        return TimeFormatter.formatSignedSeconds(seconds);
    }

    private getTimerDisplayText(timer: TimerInstance): string {
        switch (timer.timerType) {
            case 'countup':
            case 'idle':
                return TimeFormatter.formatSeconds(timer.elapsedTime);
            case 'countdown':
                return TimeFormatter.formatSignedSeconds(timer.timeRemaining);
            case 'interval':
                return TimeFormatter.formatSeconds(timer.segmentTimeRemaining);
            default:
                return '00:00';
        }
    }

    private showSettingsMenu(e: MouseEvent, taskId: string): void {
        const timer = this.ctx.timers.get(taskId);
        if (!timer || timer.timerType !== 'interval' || timer.intervalSource !== 'pomodoro') return;

        TimerSettingsMenu.showPomodoroSettings({
            app: this.ctx.app,
            plugin: this.ctx.plugin,
            timer,
            event: e,
            onPersist: () => this.ctx.persistTimersToStorage(),
            onRender: () => this.render()
        });
    }
}
