/**
 * Timer DOM rendering: container, drag, controls, progress ring.
 */

import { setIcon } from 'obsidian';
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
import { TimerProgressUI } from './TimerProgressUI';
import { TimerSettingsMenu } from './TimerSettingsMenu';
import { AudioUtils } from '../utils/AudioUtils';
import { TimeFormatter } from '../utils/TimeFormatter';

export class TimerRenderer {
    private container: HTMLElement | null = null;
    private isDragging = false;
    private dragOffset = { x: 0, y: 0 };
    private closeConfirmTimers = new Map<string, number>();

    constructor(
        private ctx: TimerContext,
        private lifecycle: TimerLifecycle,
        private creator: TimerCreator,
    ) {}

    // ─── Container ───────────────────────────────────────────

    hasContainer(): boolean {
        return this.container !== null;
    }

    createContainer(): void {
        this.container = document.body.createDiv('timer-widget');
        this.container.style.position = 'fixed';
        this.container.style.right = '20px';
        this.container.style.bottom = '20px';
        this.setupDrag();
    }

    private setupDrag(): void {
        if (!this.container) return;

        const header = this.container;

        header.addEventListener('pointerdown', (e) => {
            if ((e.target as HTMLElement).closest('.timer-widget__item')) {
                if ((e.target as HTMLElement).closest('button, input')) return;
            }

            this.isDragging = true;
            const rect = this.container!.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            this.container!.style.cursor = 'grabbing';
            header.setPointerCapture(e.pointerId);
        });

        header.addEventListener('pointermove', (e) => {
            if (!this.isDragging || !this.container) return;

            const x = e.clientX - this.dragOffset.x;
            const y = e.clientY - this.dragOffset.y;

            this.container.style.left = `${x}px`;
            this.container.style.top = `${y}px`;
            this.container.style.right = 'auto';
            this.container.style.bottom = 'auto';
        });

        header.addEventListener('pointerup', (e) => {
            this.isDragging = false;
            if (this.container) {
                this.container.style.cursor = 'grab';
            }
            header.releasePointerCapture(e.pointerId);
        });

        header.addEventListener('pointercancel', (e) => {
            this.isDragging = false;
            if (this.container) {
                this.container.style.cursor = 'grab';
            }
            header.releasePointerCapture(e.pointerId);
        });
    }

    // ─── Render ──────────────────────────────────────────────

    render(): void {
        if (!this.container) return;
        this.container.empty();

        if (this.ctx.timers.size === 0) {
            this.container.remove();
            this.container = null;
            return;
        }

        for (const [taskId] of this.ctx.timers) {
            this.renderTimerItem(taskId);
        }
    }

    renderTimerItem(taskId: string): void {
        if (!this.container) return;

        const timer = this.ctx.timers.get(taskId);
        if (!timer) return;

        let itemEl = this.container.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement;
        const isNewItem = !itemEl;

        if (isNewItem) {
            itemEl = this.container.createDiv('timer-widget__item');
            itemEl.dataset.taskId = taskId;
        }
        itemEl.toggleClass('timer-widget__item--idle', this.lifecycle.isIdleTimer(taskId));

        const currentExpanded = itemEl.dataset.expanded === 'true';
        const needsRebuild = isNewItem || currentExpanded !== timer.isExpanded;

        if (needsRebuild) {
            itemEl.empty();
            itemEl.dataset.expanded = timer.isExpanded.toString();

            // Header
            const header = itemEl.createDiv('timer-widget__header');

            const titleSpan = header.createSpan('timer-widget__title');
            titleSpan.setText(timer.taskName);

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
                // Skip confirmation for non-running or idle timers
                if (!timer.isRunning || timer.phase === 'idle') {
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

    destroyContainer(): void {
        for (const id of this.closeConfirmTimers.values()) {
            clearTimeout(id);
        }
        this.closeConfirmTimers.clear();
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
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
        const headerTime = itemEl.querySelector('[data-time-display="header"]') as HTMLElement;
        if (headerTime) {
            headerTime.setText(this.getTimerDisplayText(timer));
            headerTime.toggleClass('timer-widget__header-time--break', timer.phase === 'break');
        }
        TimerProgressUI.updateDisplay(itemEl, timer, this.formatSignedTime.bind(this));
    }

    private renderTimerUI(container: HTMLElement, timer: TimerInstance): void {
        if (timer.recordMode !== 'self' && timer.timerType !== 'idle') {
            const labelContainer = container.createDiv('timer-widget__label-container');
            const labelInput = labelContainer.createEl('input', {
                type: 'text',
                cls: 'timer-widget__label-input',
                placeholder: 'What are you working on? (empty = 🍅)',
                value: timer.customLabel
            });
            labelInput.oninput = () => {
                timer.customLabel = labelInput.value;
                this.ctx.persistTimersToStorage();
            };
        }

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
                AudioUtils.playWorkCompleteChime();

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
                AudioUtils.playWorkCompleteChime();
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
                AudioUtils.playWorkCompleteChime();
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
            AudioUtils.playWorkCompleteChime();
            if (timer.recordMode === 'self') {
                await this.ctx.recorder.updateTaskDirectly(timer);
            } else {
                await this.ctx.recorder.addIntervalRecord(timer);
            }
            this.lifecycle.closeTimer(timer.id);
        };
    }

    private renderIdleControls(container: HTMLElement, timer: IdleTimer): void {
        const dismissBtn = container.createEl('button', {
            cls: 'timer-widget__btn timer-widget__btn--secondary'
        });
        setIcon(dismissBtn, 'x');
        dismissBtn.createSpan({ text: ' Dismiss' });
        dismissBtn.onclick = () => {
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
