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

interface TimerInstance {
    id: string;
    taskId: string;
    taskName: string;
    startTime: Date;
    timeRemaining: number;
    totalTime: number;
    mode: 'work' | 'break' | 'idle';
    isRunning: boolean;
    isExpanded: boolean;
    intervalId: number | null;
    customLabel: string;
    timerType: 'pomodoro' | 'countup';
    elapsedTime: number; // for countup mode (seconds)
}

export class TimerWidget {
    private app: App;
    private plugin: TaskViewerPlugin;
    private container: HTMLElement | null = null;
    private timers: Map<string, TimerInstance> = new Map();
    private isDragging = false;
    private dragOffset = { x: 0, y: 0 };

    constructor(app: App, plugin: TaskViewerPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    /**
     * Show the widget and start a new timer for the given task
     */
    show(taskId: string, taskName: string): void {
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
        };

        this.timers.set(taskId, timer);
        this.render();
    }

    /**
     * Show the widget and start a new countup timer for the given task
     */
    showCountup(taskId: string, taskName: string): void {
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
            startTime: new Date(),
            timeRemaining: 0, // not used for countup
            totalTime: 0, // not used for countup
            mode: 'idle',
            isRunning: false,
            isExpanded: true,
            intervalId: null,
            customLabel: '',
            timerType: 'countup',
            elapsedTime: 0,
        };

        this.timers.set(taskId, timer);
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

        header.addEventListener('mousedown', (e) => {
            if ((e.target as HTMLElement).closest('.timer-widget__item')) {
                // Don't start drag if clicking inside an item
                if ((e.target as HTMLElement).closest('button, input')) return;
            }

            this.isDragging = true;
            const rect = this.container!.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            this.container!.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging || !this.container) return;

            const x = e.clientX - this.dragOffset.x;
            const y = e.clientY - this.dragOffset.y;

            this.container.style.left = `${x}px`;
            this.container.style.top = `${y}px`;
            this.container.style.right = 'auto';
            this.container.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', () => {
            this.isDragging = false;
            if (this.container) {
                this.container.style.cursor = 'grab';
            }
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

        if (timer.timerType === 'countup') {
            // Countup mode: increment elapsed time
            timer.elapsedTime++;
            this.renderTimerItem(taskId);
        } else {
            // Pomodoro mode: decrement remaining time
            if (timer.timeRemaining > 0) {
                timer.timeRemaining--;
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

            await this.addPomodoroRecord(timer);

            // Start break
            timer.mode = 'break';
            timer.timeRemaining = this.plugin.settings.pomodoroBreakMinutes * 60;
            timer.totalTime = this.plugin.settings.pomodoroBreakMinutes * 60;
            timer.isRunning = true;
            this.startTimer(taskId);
        } else {
            // Break complete
            AudioUtils.playBreakCompleteChime();
            new Notice(`☕ ${timer.taskName} - Break complete!`);

            // Reset to idle
            timer.mode = 'idle';
            timer.timeRemaining = this.plugin.settings.pomodoroWorkMinutes * 60;
            timer.totalTime = this.plugin.settings.pomodoroWorkMinutes * 60;
            timer.isRunning = false;
        }

        this.render();
    }

    private async addPomodoroRecord(timer: TimerInstance): Promise<void> {
        const taskIndex = this.plugin.getTaskIndex();
        const parentTask = taskIndex.getTask(timer.taskId);
        if (!parentTask) return;

        const endTime = new Date();
        const workMinutes = this.plugin.settings.pomodoroWorkMinutes;
        const startTime = new Date(endTime.getTime() - workMinutes * 60 * 1000);

        const formatDate = (d: Date) => d.toISOString().split('T')[0];
        const formatTime = (d: Date) => `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

        const dateStr = formatDate(startTime);
        const startTimeStr = formatTime(startTime);
        const endTimeStr = formatTime(endTime);

        // Use 🍅 + custom label if provided
        const customText = timer.customLabel.trim();
        const label = customText ? `🍅 ${customText}` : '🍅';
        const childLine = `    - [x] ${label} @${dateStr}T${startTimeStr}>${endTimeStr}`;

        const taskRepository = this.plugin.getTaskRepository();
        await taskRepository.insertLineAfterTask(parentTask, childLine);

        new Notice('🍅 Pomodoro recorded!');
    }

    private async addCountupRecord(timer: TimerInstance): Promise<void> {
        const taskIndex = this.plugin.getTaskIndex();
        const parentTask = taskIndex.getTask(timer.taskId);
        if (!parentTask) return;

        // Calculate start and end times based on elapsed time
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - timer.elapsedTime * 1000);

        const formatDate = (d: Date) => d.toISOString().split('T')[0];
        const formatTime = (d: Date) => `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

        const dateStr = formatDate(startTime);
        const startTimeStr = formatTime(startTime);
        const endTimeStr = formatTime(endTime);

        // Use ⏱️ + custom label if provided
        const customText = timer.customLabel.trim();
        const label = customText ? `⏱️ ${customText}` : '⏱️';
        const childLine = `    - [x] ${label} @${dateStr}T${startTimeStr}>${endTimeStr}`;

        const taskRepository = this.plugin.getTaskRepository();
        await taskRepository.insertLineAfterTask(parentTask, childLine);

        new Notice(`⏱️ Timer recorded! (${this.formatTime(timer.elapsedTime)})`);
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

        // Update main time display
        const mainTimeDisplay = itemEl.querySelector('.timer-widget__time-display') as HTMLElement;
        if (mainTimeDisplay) {
            if (timer.timerType === 'countup') {
                mainTimeDisplay.setText(this.formatTime(timer.elapsedTime));
            } else {
                mainTimeDisplay.setText(this.formatTime(timer.timeRemaining));
            }
        }

        // Update progress ring
        const progressCircle = itemEl.querySelector('.timer-widget__progress-ring-progress') as SVGCircleElement;
        if (progressCircle) {
            const size = 120;
            const strokeWidth = 6;
            const radius = (size - strokeWidth) / 2;
            const circumference = 2 * Math.PI * radius;

            let progress: number;
            if (timer.timerType === 'countup') {
                const COUNTUP_FULL_ROTATION_SECONDS = 30 * 60;
                progress = (timer.elapsedTime % COUNTUP_FULL_ROTATION_SECONDS) / COUNTUP_FULL_ROTATION_SECONDS;
            } else {
                progress = timer.totalTime > 0 ? timer.timeRemaining / timer.totalTime : 1;
            }

            const offset = circumference * (1 - progress);
            progressCircle.setAttribute('stroke-dashoffset', offset.toString());
        }
    }

    private renderTimerUI(container: HTMLElement, timer: TimerInstance): void {
        // Custom label input field
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

        // Circular progress
        const progressContainer = container.createDiv('timer-widget__progress-container');
        this.renderCircularProgress(progressContainer, timer);

        // Controls
        const controls = container.createDiv('timer-widget__controls');
        this.renderControls(controls, timer);
    }

    private renderCircularProgress(container: HTMLElement, timer: TimerInstance): void {
        const size = 120;
        const strokeWidth = 6;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;

        // Calculate progress based on timer type
        let progress: number;
        let displayTime: number;
        if (timer.timerType === 'countup') {
            // Countup: ring fills up over time (1 full rotation = 30 minutes)
            const COUNTUP_FULL_ROTATION_SECONDS = 30 * 60; // 30 minutes
            progress = (timer.elapsedTime % COUNTUP_FULL_ROTATION_SECONDS) / COUNTUP_FULL_ROTATION_SECONDS;
            displayTime = timer.elapsedTime;
        } else {
            // Pomodoro: show countdown progress
            progress = timer.totalTime > 0 ? timer.timeRemaining / timer.totalTime : 1;
            displayTime = timer.timeRemaining;
        }
        const offset = circumference * (1 - progress);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.setAttribute('class', 'timer-widget__progress-ring');

        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', (size / 2).toString());
        bgCircle.setAttribute('cy', (size / 2).toString());
        bgCircle.setAttribute('r', radius.toString());
        bgCircle.setAttribute('class', 'timer-widget__progress-ring-bg');
        bgCircle.setAttribute('stroke-width', strokeWidth.toString());
        svg.appendChild(bgCircle);

        const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        progressCircle.setAttribute('cx', (size / 2).toString());
        progressCircle.setAttribute('cy', (size / 2).toString());
        progressCircle.setAttribute('r', radius.toString());
        progressCircle.setAttribute('class', `timer-widget__progress-ring-progress timer-widget__progress-ring-progress--${timer.mode}`);
        progressCircle.setAttribute('stroke-width', strokeWidth.toString());
        progressCircle.setAttribute('stroke-dasharray', circumference.toString());
        progressCircle.setAttribute('stroke-dashoffset', offset.toString());
        progressCircle.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
        svg.appendChild(progressCircle);

        container.appendChild(svg);

        const timeDisplay = container.createDiv('timer-widget__time-display');
        timeDisplay.setText(this.formatTime(displayTime));

        // Add type indicator for countup
        if (timer.timerType === 'countup') {
            timeDisplay.addClass('timer-widget__time-display--countup');
        }
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
                timer.isRunning = true;
                timer.elapsedTime = 0;
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
                await this.addCountupRecord(timer);
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
