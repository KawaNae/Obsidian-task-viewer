/**
 * Pomodoro Timer View
 * 
 * リッチなタイマーUIを提供する専用ビュー。
 * 円形プログレスリング + 時間表示 + コントロールボタン
 */

import { ItemView, WorkspaceLeaf, Notice, Menu, setIcon } from 'obsidian';
import TaskViewerPlugin from '../main';
import { PomodoroService, PomodoroState, PomodoroMode } from '../services/PomodoroService';
import { InputModal } from '../modals/InputModal';

export const VIEW_TYPE_POMODORO = 'pomodoro-view';

export class PomodoroView extends ItemView {
    private plugin: TaskViewerPlugin;
    private pomodoroService: PomodoroService;
    private container: HTMLElement;
    private unsubscribe: (() => void) | null = null;

    // Task info (passed via setState)
    private linkedTaskId?: string;
    private linkedTaskName?: string;

    constructor(leaf: WorkspaceLeaf, plugin: TaskViewerPlugin, pomodoroService: PomodoroService) {
        super(leaf);
        this.plugin = plugin;
        this.pomodoroService = pomodoroService;
    }

    getViewType(): string {
        return VIEW_TYPE_POMODORO;
    }

    getDisplayText(): string {
        return 'Pomodoro Timer';
    }

    getIcon(): string {
        return 'clock';
    }

    async onOpen(): Promise<void> {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('pomodoro-view');

        // Subscribe to state changes
        this.unsubscribe = this.pomodoroService.onStateChange((state) => {
            this.render();
        });

        // Subscribe to completion events
        this.pomodoroService.onComplete(async (mode, taskId) => {
            // Play completion sound
            const { AudioUtils } = require('../utils/AudioUtils');
            if (mode === 'work') {
                AudioUtils.playWorkCompleteChime();
                new Notice('🍅 Pomodoro complete! Time for a break.');

                // Add pomodoro record as child task
                if (taskId && this.linkedTaskId) {
                    await this.addPomodoroRecord();
                }
            } else {
                AudioUtils.playBreakCompleteChime();
                new Notice('☕ Break complete! Ready for another pomodoro?');
            }
        });

        this.render();
    }

    async onClose(): Promise<void> {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }

    // Save state for popout window restore
    getState(): any {
        return {
            taskId: this.linkedTaskId,
            taskName: this.linkedTaskName,
        };
    }

    // Receive state from popout window or workspace.getLeaf
    async setState(state: any, result: any): Promise<void> {
        if (state?.taskId) {
            this.linkedTaskId = state.taskId;
            this.linkedTaskName = state.taskName || '';
            // Start pomodoro with this task
            this.pomodoroService.start(this.linkedTaskId);
            // Play start sound
            const { AudioUtils } = require('../utils/AudioUtils');
            AudioUtils.playStartSound();
        }
        this.render();
    }

    private render(): void {
        this.container.empty();

        const state = this.pomodoroService.getState();

        // Settings button (gear icon) - positioned at top right of view
        const settingsBtn = this.container.createEl('button', {
            cls: 'pomodoro-view__settings-btn',
            attr: { 'aria-label': 'Settings' }
        });
        setIcon(settingsBtn, 'settings');
        settingsBtn.onclick = (e) => this.showSettingsMenu(e);

        // Main container with gradient background
        const mainContainer = this.container.createDiv('pomodoro-view__main');

        // Task name display (if linked to a task)
        if (this.linkedTaskName) {
            const taskLabel = mainContainer.createDiv('pomodoro-view__task-label');
            taskLabel.setText(`🎯 ${this.linkedTaskName}`);
        }

        // Circular progress container
        const progressContainer = mainContainer.createDiv('pomodoro-view__progress-container');
        this.renderCircularProgress(progressContainer, state);

        // Controls
        const controls = mainContainer.createDiv('pomodoro-view__controls');
        this.renderControls(controls, state);
    }

    private renderCircularProgress(container: HTMLElement, state: PomodoroState): void {
        const size = 200;  // ViewBox size (virtual)
        const strokeWidth = 8;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const progress = state.totalTime > 0 ? state.timeRemaining / state.totalTime : 1;
        const offset = circumference * (1 - progress);

        // SVG for circular progress (responsive with viewBox)
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.setAttribute('class', 'pomodoro-view__progress-ring');

        // Background circle
        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', (size / 2).toString());
        bgCircle.setAttribute('cy', (size / 2).toString());
        bgCircle.setAttribute('r', radius.toString());
        bgCircle.setAttribute('class', 'pomodoro-view__progress-ring-bg');
        bgCircle.setAttribute('stroke-width', strokeWidth.toString());
        svg.appendChild(bgCircle);

        // Progress circle
        const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        progressCircle.setAttribute('cx', (size / 2).toString());
        progressCircle.setAttribute('cy', (size / 2).toString());
        progressCircle.setAttribute('r', radius.toString());
        progressCircle.setAttribute('class', `pomodoro-view__progress-ring-progress pomodoro-view__progress-ring-progress--${state.mode}`);
        progressCircle.setAttribute('stroke-width', strokeWidth.toString());
        progressCircle.setAttribute('stroke-dasharray', circumference.toString());
        progressCircle.setAttribute('stroke-dashoffset', offset.toString());
        progressCircle.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
        svg.appendChild(progressCircle);

        container.appendChild(svg);

        // Time display in center
        const timeDisplay = container.createDiv('pomodoro-view__time-display');
        timeDisplay.setText(this.formatTime(state.timeRemaining));
    }

    private renderControls(container: HTMLElement, state: PomodoroState): void {
        if (state.mode === 'idle') {
            // Start button
            const startBtn = container.createEl('button', {
                cls: 'pomodoro-view__btn pomodoro-view__btn--primary'
            });
            setIcon(startBtn, 'play');
            startBtn.createSpan({ text: ' Start' });
            startBtn.onclick = () => {
                // Initialize AudioContext on user gesture (required for autoplay policy)
                const { AudioUtils } = require('../utils/AudioUtils');
                AudioUtils.playStartSound();
                this.pomodoroService.start();
            };
        } else if (state.isRunning) {
            // Pause button
            const pauseBtn = container.createEl('button', {
                cls: 'pomodoro-view__btn pomodoro-view__btn--secondary'
            });
            setIcon(pauseBtn, 'pause');
            pauseBtn.createSpan({ text: ' Pause' });
            pauseBtn.onclick = () => this.pomodoroService.pause();

            // Reset button
            const resetBtn = container.createEl('button', {
                cls: 'pomodoro-view__btn pomodoro-view__btn--danger'
            });
            setIcon(resetBtn, 'x');
            resetBtn.createSpan({ text: ' Reset' });
            resetBtn.onclick = () => this.pomodoroService.reset();
        } else {
            // Paused - show resume and reset buttons
            const resumeBtn = container.createEl('button', {
                cls: 'pomodoro-view__btn pomodoro-view__btn--primary'
            });
            setIcon(resumeBtn, 'play');
            resumeBtn.createSpan({ text: ' Resume' });
            resumeBtn.onclick = () => this.pomodoroService.resume();

            const resetBtn = container.createEl('button', {
                cls: 'pomodoro-view__btn pomodoro-view__btn--danger'
            });
            setIcon(resetBtn, 'x');
            resetBtn.createSpan({ text: ' Reset' });
            resetBtn.onclick = () => this.pomodoroService.reset();
        }
    }

    private formatTime(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    private showSettingsMenu(e: MouseEvent): void {
        const menu = new Menu();

        menu.addItem((item) => {
            item.setTitle('Work Duration')
                .setDisabled(true);
        });

        const workOptions = [15, 25, 30, 45, 50];
        workOptions.forEach((mins) => {
            menu.addItem((item) => {
                const current = this.plugin.settings.pomodoroWorkMinutes;
                item.setTitle(`  ${mins} min${current === mins ? ' ✓' : ''}`)
                    .onClick(async () => {
                        this.plugin.settings.pomodoroWorkMinutes = mins;
                        await this.plugin.saveSettings();
                        this.render();
                    });
            });
        });

        // Custom work duration
        menu.addItem((item) => {
            const current = this.plugin.settings.pomodoroWorkMinutes;
            const isCustom = !workOptions.includes(current);
            item.setTitle(`  Custom...${isCustom ? ` (${current} min) \u2713` : ''}`)
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
                                this.render();
                            }
                        }
                    ).open();
                });
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('Break Duration')
                .setDisabled(true);
        });

        const breakOptions = [5, 10, 15];
        breakOptions.forEach((mins) => {
            menu.addItem((item) => {
                const current = this.plugin.settings.pomodoroBreakMinutes;
                item.setTitle(`  ${mins} min${current === mins ? ' ✓' : ''}`)
                    .onClick(async () => {
                        this.plugin.settings.pomodoroBreakMinutes = mins;
                        await this.plugin.saveSettings();
                        this.render();
                    });
            });
        });

        // Custom break duration
        menu.addItem((item) => {
            const current = this.plugin.settings.pomodoroBreakMinutes;
            const isCustom = !breakOptions.includes(current);
            item.setTitle(`  Custom...${isCustom ? ` (${current} min) \u2713` : ''}`)
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
                                this.render();
                            }
                        }
                    ).open();
                });
        });

        menu.showAtMouseEvent(e);
    }

    /**
     * Add a pomodoro record as child task to the linked parent task.
     * Format: - [x] 🍅 @YYYY-MM-DDTHH:mm>HH:mm
     */
    private async addPomodoroRecord(): Promise<void> {
        if (!this.linkedTaskId) return;

        // Get the parent task
        const taskIndex = this.plugin.getTaskIndex();
        const parentTask = taskIndex.getTask(this.linkedTaskId);
        if (!parentTask) {
            console.warn('[PomodoroView] Parent task not found:', this.linkedTaskId);
            return;
        }

        // Calculate start and end times
        const endTime = new Date();
        const workMinutes = this.plugin.settings.pomodoroWorkMinutes;
        const startTime = new Date(endTime.getTime() - workMinutes * 60 * 1000);

        // Format datetime strings
        const formatDate = (d: Date) => d.toISOString().split('T')[0];
        const formatTime = (d: Date) => `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

        const dateStr = formatDate(startTime);
        const startTimeStr = formatTime(startTime);
        const endTimeStr = formatTime(endTime);

        // Build child task line with proper indentation (4 spaces for child)
        const childLine = `    - [x] 🍅 @${dateStr}T${startTimeStr}>${endTimeStr}`;

        // Insert as child task
        const taskRepository = this.plugin.getTaskRepository();
        await taskRepository.insertLineAfterTask(parentTask, childLine);

        new Notice('🍅 Pomodoro recorded!');
    }
}
