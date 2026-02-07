/**
 * Floating Timer Widget
 * 
 * フローティングウィジェットとして複数のタイマー（Pomodoro/Countup）を管理。
 * アコーディオン形式で個別にトグル可能。
 */

import { App, setIcon, Notice, Menu } from 'obsidian';
import TaskViewerPlugin from '../main';
import { AudioUtils } from '../utils/AudioUtils';
import { InputModal } from '../modals/InputModal';
import { TimerInstance } from './TimerInstance';
import { TimerRecorder } from './TimerRecorder';
import { TimerProgressUI } from './TimerProgressUI';

export class TimerWidget {
    private app: App;
    private plugin: TaskViewerPlugin;
    private container: HTMLElement | null = null;
    private timers: Map<string, TimerInstance> = new Map();
    private isDragging = false;
    private dragOffset = { x: 0, y: 0 };
    private recorder: TimerRecorder;

    constructor(app: App, plugin: TaskViewerPlugin) {
        this.app = app;
        this.plugin = plugin;
        this.recorder = new TimerRecorder(app, plugin);
    }

    /**
     * Show the widget and start a new timer for the given task
     */
    show(taskId: string, taskName: string, taskOriginalText: string = '', taskFile: string = '', recordMode: 'child' | 'self' = 'child', parserId: string = 'at-notation'): void {
        // Create container if not exists
        if (!this.container) {
            this.createContainer();
        }

        // Check if timer already exists for this task
        if (this.timers.has(taskId)) {
            new Notice('This task already has an active timer');
            return;
        }

        // Create new timer instance (starts in idle mode - user must click Start)
        const timer: TimerInstance = {
            id: taskId,
            taskId: taskId,
            taskName: taskName,
            taskOriginalText: taskOriginalText,
            taskFile: taskFile,
            startTime: new Date(),
            timeRemaining: this.plugin.settings.pomodoroWorkMinutes * 60,
            totalTime: this.plugin.settings.pomodoroWorkMinutes * 60,
            mode: 'idle',
            isRunning: false,
            isExpanded: true,
            intervalId: null,
            customLabel: '',
            timerType: 'pomodoro',
            elapsedTime: 0,
            startTimeMs: 0,
            pausedElapsedTime: 0,
            autoRepeat: false,
            recordMode: recordMode,
            parserId: parserId,
        };

        this.timers.set(taskId, timer);
        this.render();
    }

    /**
     * Show the widget and start a new countup timer for the given task
     * @param recordMode 'child' = add child task, 'self' = update this task's start/end
     * @param autoStart if true, start the timer immediately
     */
    showCountup(taskId: string, taskName: string, taskOriginalText: string = '', taskFile: string = '', recordMode: 'child' | 'self' = 'child', autoStart: boolean = false, parserId: string = 'at-notation'): void {
        // Create container if not exists
        if (!this.container) {
            this.createContainer();
        }

        // Check if timer already exists for this task
        if (this.timers.has(taskId)) {
            new Notice('This task already has an active timer');
            return;
        }

        // Create new countup timer instance
        const timer: TimerInstance = {
            id: taskId,
            taskId: taskId,
            taskName: taskName,
            taskOriginalText: taskOriginalText,
            taskFile: taskFile,
            startTime: new Date(),
            timeRemaining: 0, // not used for countup
            totalTime: 0, // not used for countup
            mode: autoStart ? 'work' : 'idle',
            isRunning: autoStart,
            isExpanded: true,
            intervalId: null,
            customLabel: '',
            timerType: 'countup',
            elapsedTime: 0,
            startTimeMs: autoStart ? Date.now() : 0,
            pausedElapsedTime: 0,
            autoRepeat: false,
            recordMode: recordMode,
            parserId: parserId,
        };

        this.timers.set(taskId, timer);

        if (autoStart) {
            this.startTimer(taskId);
            AudioUtils.playStartSound();
        }

        this.render();
    }

    private createContainer(): void {
        this.container = document.body.createDiv('timer-widget');
        this.container.style.position = 'fixed';
        this.container.style.right = '20px';
        this.container.style.bottom = '20px';

        // Make draggable
        this.setupDrag();
    }

    private setupDrag(): void {
        if (!this.container) return;

        const header = this.container;

        header.addEventListener('pointerdown', (e) => {
            if ((e.target as HTMLElement).closest('.timer-widget__item')) {
                // Don't start drag if clicking inside an item
                if ((e.target as HTMLElement).closest('button, input')) return;
            }

            this.isDragging = true;
            const rect = this.container!.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            this.container!.style.cursor = 'grabbing';

            // Capture pointer for reliable tracking across boundaries
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

    private startTimer(taskId: string): void {
        const timer = this.timers.get(taskId);
        if (!timer) return;

        timer.intervalId = window.setInterval(() => {
            this.tick(taskId);
        }, 1000);
    }

    private stopTimer(taskId: string): void {
        const timer = this.timers.get(taskId);
        if (!timer || timer.intervalId === null) return;

        window.clearInterval(timer.intervalId);
        timer.intervalId = null;
    }

    private tick(taskId: string): void {
        const timer = this.timers.get(taskId);
        if (!timer || !timer.isRunning) return;

        // Calculate elapsed time based on real time (not tick count)
        const now = Date.now();
        const currentSessionElapsed = Math.floor((now - timer.startTimeMs) / 1000);
        const totalElapsed = timer.pausedElapsedTime + currentSessionElapsed;

        if (timer.timerType === 'countup') {
            // Countup mode: update elapsed time based on real time
            timer.elapsedTime = totalElapsed;
            this.renderTimerItem(taskId);
        } else {
            // Pomodoro mode: calculate remaining time based on real time
            timer.timeRemaining = Math.max(0, timer.totalTime - totalElapsed);
            if (timer.timeRemaining > 0) {
                this.renderTimerItem(taskId);
            } else {
                this.handleComplete(taskId);
            }
        }
    }

    private async handleComplete(taskId: string): Promise<void> {
        const timer = this.timers.get(taskId);
        if (!timer) return;

        this.stopTimer(taskId);

        if (timer.mode === 'work') {
            // Work complete - add child task record
            AudioUtils.playWorkCompleteChime();
            new Notice(`🍅 ${timer.taskName} - Pomodoro complete!`);

            await this.recorder.addPomodoroRecord(timer);

            // Start break
            timer.mode = 'break';
            timer.timeRemaining = this.plugin.settings.pomodoroBreakMinutes * 60;
            timer.totalTime = this.plugin.settings.pomodoroBreakMinutes * 60;
            timer.startTimeMs = Date.now();
            timer.pausedElapsedTime = 0;
            timer.isRunning = true;
            this.startTimer(taskId);
        } else {
            // Break complete
            AudioUtils.playBreakCompleteChime();
            new Notice(`☕ ${timer.taskName} - Break complete!`);

            if (timer.autoRepeat) {
                // Auto-repeat: start work session again
                timer.mode = 'work';
                timer.timeRemaining = this.plugin.settings.pomodoroWorkMinutes * 60;
                timer.totalTime = this.plugin.settings.pomodoroWorkMinutes * 60;
                timer.startTime = new Date();
                timer.startTimeMs = Date.now();
                timer.pausedElapsedTime = 0;
                timer.isRunning = true;
                this.startTimer(taskId);
                AudioUtils.playStartSound();
            } else {
                // Reset to idle
                timer.mode = 'idle';
                timer.timeRemaining = this.plugin.settings.pomodoroWorkMinutes * 60;
                timer.totalTime = this.plugin.settings.pomodoroWorkMinutes * 60;
                timer.startTimeMs = 0;
                timer.pausedElapsedTime = 0;
                timer.isRunning = false;
            }
        }

        this.render();
    }

    private render(): void {
        if (!this.container) return;
        this.container.empty();

        if (this.timers.size === 0) {
            this.container.remove();
            this.container = null;
            return;
        }

        for (const [taskId] of this.timers) {
            this.renderTimerItem(taskId);
        }
    }

    private renderTimerItem(taskId: string): void {
        if (!this.container) return;

        const timer = this.timers.get(taskId);
        if (!timer) return;

        // Find or create item container
        let itemEl = this.container.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement;
        const isNewItem = !itemEl;

        if (isNewItem) {
            itemEl = this.container.createDiv('timer-widget__item');
            itemEl.dataset.taskId = taskId;
        }

        // Only rebuild if new item or structure changed (e.g., expanded/collapsed toggle)
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
                // Show time in header when collapsed
                const timeSpan = header.createSpan('timer-widget__header-time');
                timeSpan.dataset.timeDisplay = 'header';
                if (timer.timerType === 'countup') {
                    timeSpan.setText(this.formatTime(timer.elapsedTime));
                } else {
                    timeSpan.setText(this.formatTime(timer.timeRemaining));
                    if (timer.mode === 'break') {
                        timeSpan.addClass('timer-widget__header-time--break');
                    }
                }
            }

            // Settings button (only for pomodoro)
            if (timer.timerType !== 'countup') {
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
            };

            // Close button
            const closeBtn = header.createEl('button', { cls: 'timer-widget__close-btn' });
            setIcon(closeBtn, 'x');
            closeBtn.onclick = () => {
                this.closeTimer(taskId);
            };

            // Expandable content
            if (timer.isExpanded) {
                const content = itemEl.createDiv('timer-widget__content');
                this.renderTimerUI(content, timer);
            }
        } else {
            // Partial update: only update time displays and progress ring
            this.updateTimerDisplay(itemEl, timer);
        }
    }

    private updateTimerDisplay(itemEl: HTMLElement, timer: TimerInstance): void {
        // Update header time (when collapsed)
        const headerTime = itemEl.querySelector('[data-time-display="header"]') as HTMLElement;
        if (headerTime) {
            if (timer.timerType === 'countup') {
                headerTime.setText(this.formatTime(timer.elapsedTime));
            } else {
                headerTime.setText(this.formatTime(timer.timeRemaining));
            }
        }

        // Update progress ring and time display using TimerProgressUI
        TimerProgressUI.updateDisplay(itemEl, timer, this.formatTime.bind(this));
    }

    private renderTimerUI(container: HTMLElement, timer: TimerInstance): void {
        // Custom label input field - only show for 'child' recordMode (not for 'self')
        if (timer.recordMode !== 'self') {
            const labelContainer = container.createDiv('timer-widget__label-container');
            const labelInput = labelContainer.createEl('input', {
                type: 'text',
                cls: 'timer-widget__label-input',
                placeholder: 'What are you working on? (empty = 🍅)',
                value: timer.customLabel
            });
            labelInput.oninput = () => {
                timer.customLabel = labelInput.value;
            };
        }

        // Circular progress
        const progressContainer = container.createDiv('timer-widget__progress-container');
        this.renderCircularProgress(progressContainer, timer);

        // Controls
        const controls = container.createDiv('timer-widget__controls');
        this.renderControls(controls, timer);
    }

    private renderCircularProgress(container: HTMLElement, timer: TimerInstance): void {
        TimerProgressUI.render(container, timer, this.formatTime.bind(this));
    }

    private renderControls(container: HTMLElement, timer: TimerInstance): void {
        if (timer.timerType === 'countup') {
            // Countup mode controls
            this.renderCountupControls(container, timer);
        } else {
            // Pomodoro mode controls
            this.renderPomodoroControls(container, timer);
        }
    }

    private renderPomodoroControls(container: HTMLElement, timer: TimerInstance): void {
        if (timer.mode === 'idle') {
            const startBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--primary'
            });
            setIcon(startBtn, 'play');
            startBtn.createSpan({ text: ' Start' });
            startBtn.onclick = () => {
                timer.mode = 'work';
                timer.startTime = new Date();
                timer.startTimeMs = Date.now();
                timer.pausedElapsedTime = 0;
                timer.isRunning = true;
                this.startTimer(timer.id);
                AudioUtils.playStartSound();
                this.render();
            };
        } else if (timer.isRunning) {
            const pauseBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--secondary'
            });
            setIcon(pauseBtn, 'pause');
            pauseBtn.createSpan({ text: ' Pause' });
            pauseBtn.onclick = () => {
                // Save accumulated elapsed time before pause
                const now = Date.now();
                const currentSessionElapsed = Math.floor((now - timer.startTimeMs) / 1000);
                timer.pausedElapsedTime += currentSessionElapsed;
                timer.isRunning = false;
                this.stopTimer(timer.id);
                this.render();
            };

            const resetBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--danger'
            });
            setIcon(resetBtn, 'x');
            resetBtn.createSpan({ text: ' Reset' });
            resetBtn.onclick = () => {
                this.resetTimer(timer.id);
            };
        } else {
            const resumeBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--primary'
            });
            setIcon(resumeBtn, 'play');
            resumeBtn.createSpan({ text: ' Resume' });
            resumeBtn.onclick = () => {
                timer.startTimeMs = Date.now(); // Reset start time for new session
                timer.isRunning = true;
                this.startTimer(timer.id);
                AudioUtils.playStartSound();
                this.render();
            };

            const resetBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--danger'
            });
            setIcon(resetBtn, 'x');
            resetBtn.createSpan({ text: ' Reset' });
            resetBtn.onclick = () => {
                this.resetTimer(timer.id);
            };
        }
    }

    private renderCountupControls(container: HTMLElement, timer: TimerInstance): void {
        if (timer.mode === 'idle') {
            // Start button
            const startBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--primary'
            });
            setIcon(startBtn, 'play');
            startBtn.createSpan({ text: ' Start' });
            startBtn.onclick = () => {
                timer.mode = 'work';
                timer.startTime = new Date();
                timer.startTimeMs = Date.now();
                timer.pausedElapsedTime = 0;
                timer.elapsedTime = 0;
                timer.isRunning = true;
                this.startTimer(timer.id);
                AudioUtils.playStartSound();
                this.render();
            };
        } else if (timer.isRunning) {
            // Stop button (saves record)
            const stopBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--secondary'
            });
            setIcon(stopBtn, 'square');
            stopBtn.createSpan({ text: ' Stop' });
            stopBtn.onclick = async () => {
                timer.isRunning = false;
                this.stopTimer(timer.id);
                AudioUtils.playWorkCompleteChime();

                // Record based on recordMode
                if (timer.recordMode === 'self') {
                    await this.recorder.updateTaskDirectly(timer);
                } else {
                    await this.recorder.addCountupRecord(timer);
                }

                this.closeTimer(timer.id);
            };

            // Cancel button (no record)
            const cancelBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--danger'
            });
            setIcon(cancelBtn, 'x');
            cancelBtn.createSpan({ text: ' Cancel' });
            cancelBtn.onclick = () => {
                this.closeTimer(timer.id);
            };
        } else {
            // Paused state (shouldn't normally happen for countup, but handle it)
            const resumeBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--primary'
            });
            setIcon(resumeBtn, 'play');
            resumeBtn.createSpan({ text: ' Resume' });
            resumeBtn.onclick = () => {
                timer.startTimeMs = Date.now(); // Reset start time for new session
                timer.isRunning = true;
                this.startTimer(timer.id);
                this.render();
            };

            const cancelBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--danger'
            });
            setIcon(cancelBtn, 'x');
            cancelBtn.createSpan({ text: ' Cancel' });
            cancelBtn.onclick = () => {
                this.closeTimer(timer.id);
            };
        }
    }

    private resetTimer(taskId: string): void {
        const timer = this.timers.get(taskId);
        if (!timer) return;

        this.stopTimer(taskId);
        timer.mode = 'idle';
        timer.timeRemaining = this.plugin.settings.pomodoroWorkMinutes * 60;
        timer.totalTime = this.plugin.settings.pomodoroWorkMinutes * 60;
        timer.startTimeMs = 0;
        timer.pausedElapsedTime = 0;
        timer.isRunning = false;
        this.render();
    }

    private closeTimer(taskId: string): void {
        this.stopTimer(taskId);
        this.timers.delete(taskId);
        this.render();
    }

    private formatTime(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    private showSettingsMenu(e: MouseEvent, taskId: string): void {
        const timer = this.timers.get(taskId);
        if (!timer) return;

        const menu = new Menu();

        menu.addItem((item) => {
            item.setTitle('Work Duration').setDisabled(true);
        });

        const workOptions = [15, 25, 30, 45, 50];
        workOptions.forEach((mins) => {
            menu.addItem((item) => {
                const current = this.plugin.settings.pomodoroWorkMinutes;
                item.setTitle(`  ${mins} min${current === mins ? ' ✓' : ''}`)
                    .onClick(async () => {
                        this.plugin.settings.pomodoroWorkMinutes = mins;
                        await this.plugin.saveSettings();
                        // Update timer if in idle
                        if (timer.mode === 'idle') {
                            timer.timeRemaining = mins * 60;
                            timer.totalTime = mins * 60;
                            this.render();
                        }
                    });
            });
        });

        menu.addItem((item) => {
            const current = this.plugin.settings.pomodoroWorkMinutes;
            const isCustom = !workOptions.includes(current);
            item.setTitle(`  Custom...${isCustom ? ` (${current}min) ✓` : ''}`)
                .onClick(() => {
                    new InputModal(
                        this.app,
                        'Work Duration',
                        'Minutes (1-120)',
                        current.toString(),
                        async (value) => {
                            const mins = parseInt(value);
                            if (!isNaN(mins) && mins > 0 && mins <= 120) {
                                this.plugin.settings.pomodoroWorkMinutes = mins;
                                await this.plugin.saveSettings();
                                if (timer.mode === 'idle') {
                                    timer.timeRemaining = mins * 60;
                                    timer.totalTime = mins * 60;
                                    this.render();
                                }
                            }
                        }
                    ).open();
                });
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('Break Duration').setDisabled(true);
        });

        const breakOptions = [5, 10, 15];
        breakOptions.forEach((mins) => {
            menu.addItem((item) => {
                const current = this.plugin.settings.pomodoroBreakMinutes;
                item.setTitle(`  ${mins} min${current === mins ? ' ✓' : ''}`)
                    .onClick(async () => {
                        this.plugin.settings.pomodoroBreakMinutes = mins;
                        await this.plugin.saveSettings();
                    });
            });
        });

        menu.addItem((item) => {
            const current = this.plugin.settings.pomodoroBreakMinutes;
            const isCustom = !breakOptions.includes(current);
            item.setTitle(`  Custom...${isCustom ? ` (${current}min) ✓` : ''}`)
                .onClick(() => {
                    new InputModal(
                        this.app,
                        'Break Duration',
                        'Minutes (1-60)',
                        current.toString(),
                        async (value) => {
                            const mins = parseInt(value);
                            if (!isNaN(mins) && mins > 0 && mins <= 60) {
                                this.plugin.settings.pomodoroBreakMinutes = mins;
                                await this.plugin.saveSettings();
                            }
                        }
                    ).open();
                });
        });

        menu.addSeparator();

        // Auto Repeat toggle
        menu.addItem((item) => {
            item.setTitle(`Auto Repeat${timer.autoRepeat ? ' ✓' : ''}`)
                .onClick(() => {
                    timer.autoRepeat = !timer.autoRepeat;
                });
        });

        menu.showAtMouseEvent(e);
    }

    destroy(): void {
        for (const [taskId] of this.timers) {
            this.stopTimer(taskId);
        }
        this.timers.clear();
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
    }
}
