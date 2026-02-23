/**
 * Timer View (formerly Pomodoro View)
 *
 * タスク非紐付けの独立タイマービュー。
 * 4モード対応: countup / countdown / pomodoro / interval
 * TimerInstance 型と TimerProgressUI を再利用。
 */

import { ItemView, WorkspaceLeaf, Notice, Menu, setIcon } from 'obsidian';
import TaskViewerPlugin from '../main';
import { InputModal } from '../modals/InputModal';
import { VIEW_META_POMODORO } from '../constants/viewRegistry';
import {
    CountupTimer,
    CountdownTimer,
    IntervalGroup,
    IntervalTimer,
    IntervalSegment,
    TimerInstance,
    TimerPhase,
} from '../timer/TimerInstance';
import { TimerProgressUI } from '../timer/TimerProgressUI';
import { IntervalTemplateLoader, IntervalTemplate } from '../timer/IntervalTemplateLoader';
import { AudioUtils } from '../utils/AudioUtils';
import { TimeFormatter } from '../utils/TimeFormatter';

export const VIEW_TYPE_POMODORO = VIEW_META_POMODORO.type;

type TimerViewMode = 'countup' | 'countdown' | 'pomodoro' | 'interval';

const TIMER_VIEW_ID = '__timer-view__';

export class PomodoroView extends ItemView {
    private plugin: TaskViewerPlugin;
    private container: HTMLElement;
    private timerViewMode: TimerViewMode = 'pomodoro';
    private timer: TimerInstance | null = null;
    private tickIntervalId: number | null = null;

    private templateLoader: IntervalTemplateLoader;
    private templates: IntervalTemplate[] = [];
    private selectedTemplate: IntervalTemplate | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: TaskViewerPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.templateLoader = new IntervalTemplateLoader(plugin.app);
    }

    getViewType(): string {
        return VIEW_TYPE_POMODORO;
    }

    getDisplayText(): string {
        return VIEW_META_POMODORO.displayText;
    }

    getIcon(): string {
        return VIEW_META_POMODORO.icon;
    }

    async onOpen(): Promise<void> {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('pomodoro-view');
        this.render();
    }

    async onClose(): Promise<void> {
        this.stopTicker();
    }

    // ─── Timer Instance Creation ────────────────────────────────

    private createTimerInstance(): TimerInstance {
        const now = Date.now();
        const base = {
            id: TIMER_VIEW_ID,
            taskId: TIMER_VIEW_ID,
            taskName: '',
            taskOriginalText: '',
            taskFile: '',
            startTimeMs: 0,
            pausedElapsedTime: 0,
            phase: 'idle' as TimerPhase,
            isRunning: false,
            isExpanded: true,
            intervalId: null,
            customLabel: '',
            recordMode: 'self' as const,
            parserId: 'at-notation',
        };

        switch (this.timerViewMode) {
            case 'countup':
                return { ...base, timerType: 'countup', elapsedTime: 0 } as CountupTimer;
            case 'countdown': {
                const total = this.plugin.settings.countdownMinutes * 60;
                return {
                    ...base,
                    timerType: 'countdown',
                    timeRemaining: total,
                    totalTime: total,
                    elapsedTime: 0,
                } as CountdownTimer;
            }
            case 'pomodoro': {
                const workSec = this.plugin.settings.pomodoroWorkMinutes * 60;
                const breakSec = this.plugin.settings.pomodoroBreakMinutes * 60;
                const groups: IntervalGroup[] = [{
                    segments: [
                        { label: 'Work', durationSeconds: workSec, type: 'work' },
                        { label: 'Break', durationSeconds: breakSec, type: 'break' },
                    ],
                    repeatCount: 0,
                }];
                return {
                    ...base,
                    timerType: 'interval',
                    intervalSource: 'pomodoro',
                    groups,
                    currentGroupIndex: 0,
                    currentSegmentIndex: 0,
                    currentRepeatIndex: 0,
                    segmentTimeRemaining: workSec,
                    totalElapsedTime: 0,
                    totalDuration: 0,
                } as IntervalTimer;
            }
            case 'interval': {
                if (!this.selectedTemplate) {
                    return { ...base, timerType: 'countup', elapsedTime: 0 } as CountupTimer;
                }
                const groups = this.selectedTemplate.groups;
                const firstSeg = groups[0]?.segments[0];
                const totalDuration = this.computeTotalDurationFromGroups(groups);
                return {
                    ...base,
                    timerType: 'interval',
                    groups,
                    currentGroupIndex: 0,
                    currentSegmentIndex: 0,
                    currentRepeatIndex: 0,
                    segmentTimeRemaining: firstSeg?.durationSeconds ?? 0,
                    totalElapsedTime: 0,
                    totalDuration,
                } as IntervalTimer;
            }
        }
    }

    private computeTotalDurationFromGroups(groups: IntervalGroup[]): number {
        let total = 0;
        for (const group of groups) {
            if (group.repeatCount === 0) return 0;
            const groupSec = group.segments.reduce((sum, s) => sum + s.durationSeconds, 0);
            total += groupSec * Math.max(1, group.repeatCount);
        }
        return total;
    }

    // ─── Timer Actions ──────────────────────────────────────────

    private startTimer(): void {
        this.timer = this.createTimerInstance();
        const now = Date.now();
        this.timer.startTimeMs = now;
        this.timer.isRunning = true;

        if (this.timer.timerType === 'interval') {
            const segment = this.getCurrentSegment(this.timer);
            this.timer.phase = segment ? segment.type : 'work';
        } else {
            this.timer.phase = 'work';
        }

        AudioUtils.playStartSound();
        this.startTicker();
        this.render();
    }

    private pauseTimer(): void {
        if (!this.timer || !this.timer.isRunning) return;

        const now = Date.now();
        if (this.timer.startTimeMs > 0) {
            const sessionElapsed = Math.floor((now - this.timer.startTimeMs) / 1000);
            this.timer.pausedElapsedTime += Math.max(0, sessionElapsed);
        }
        this.timer.isRunning = false;
        this.stopTicker();

        switch (this.timer.timerType) {
            case 'countup':
                this.timer.elapsedTime = this.timer.pausedElapsedTime;
                break;
            case 'countdown':
                this.timer.elapsedTime = this.timer.pausedElapsedTime;
                this.timer.timeRemaining = this.timer.totalTime - this.timer.elapsedTime;
                break;
            case 'interval': {
                const segment = this.getCurrentSegment(this.timer);
                if (segment) {
                    this.timer.segmentTimeRemaining = Math.max(0, segment.durationSeconds - this.timer.pausedElapsedTime);
                    const completedBefore = this.computeCompletedDuration(this.timer);
                    this.timer.totalElapsedTime = completedBefore + Math.min(segment.durationSeconds, this.timer.pausedElapsedTime);
                }
                break;
            }
        }

        this.render();
    }

    private resumeTimer(): void {
        if (!this.timer || this.timer.isRunning) return;

        if (this.timer.timerType === 'interval') {
            const segment = this.getCurrentSegment(this.timer);
            if (segment) {
                this.timer.phase = segment.type;
            }
        }

        this.timer.startTimeMs = Date.now();
        this.timer.isRunning = true;
        AudioUtils.playStartSound();
        this.startTicker();
        this.render();
    }

    private resetTimer(): void {
        this.stopTicker();
        this.timer = null;
        this.render();
    }

    // ─── Tick Logic ─────────────────────────────────────────────

    private startTicker(): void {
        this.stopTicker();
        this.tickIntervalId = window.setInterval(() => this.tick(), 1000);
    }

    private stopTicker(): void {
        if (this.tickIntervalId !== null) {
            window.clearInterval(this.tickIntervalId);
            this.tickIntervalId = null;
        }
    }

    private tick(): void {
        if (!this.timer || !this.timer.isRunning) return;

        const now = Date.now();
        const sessionElapsed = Math.floor((now - this.timer.startTimeMs) / 1000);
        const totalElapsed = Math.max(0, this.timer.pausedElapsedTime + sessionElapsed);

        switch (this.timer.timerType) {
            case 'countup':
                this.timer.elapsedTime = totalElapsed;
                this.updateDisplay();
                return;
            case 'countdown':
                this.timer.elapsedTime = totalElapsed;
                this.timer.timeRemaining = this.timer.totalTime - totalElapsed;
                if (this.timer.timeRemaining <= 0) {
                    this.timer.timeRemaining = 0;
                    this.handleCountdownComplete();
                } else {
                    this.updateDisplay();
                }
                return;
            case 'interval': {
                const segment = this.getCurrentSegment(this.timer);
                if (!segment) {
                    this.handleIntervalFinish();
                    return;
                }
                const segmentElapsed = Math.max(0, this.timer.pausedElapsedTime + sessionElapsed);
                this.timer.segmentTimeRemaining = Math.max(0, segment.durationSeconds - segmentElapsed);
                const completedBefore = this.computeCompletedDuration(this.timer);
                this.timer.totalElapsedTime = completedBefore + Math.min(segment.durationSeconds, segmentElapsed);

                if (this.timer.segmentTimeRemaining > 0) {
                    this.updateDisplay();
                } else {
                    this.handleSegmentComplete();
                }
                return;
            }
        }
    }

    // ─── Completion Handlers ────────────────────────────────────

    private handleCountdownComplete(): void {
        this.stopTicker();
        AudioUtils.playWorkCompleteChime();
        new Notice('Timer complete!');
        this.timer = null;
        this.render();
    }

    private handleSegmentComplete(): void {
        if (!this.timer || this.timer.timerType !== 'interval') return;

        this.stopTicker();
        const currentSegment = this.getCurrentSegment(this.timer);
        if (!currentSegment) {
            this.handleIntervalFinish();
            return;
        }

        // Update totalElapsedTime
        this.timer.totalElapsedTime = this.computeCompletedDuration(this.timer) + currentSegment.durationSeconds;

        // Play transition chime
        if (currentSegment.type === 'work') {
            AudioUtils.playWorkCompleteChime();
            new Notice('Work complete! Time for a break.');
        } else if (currentSegment.type === 'break') {
            AudioUtils.playBreakCompleteChime();
            new Notice('Break complete! Ready to work.');
        }

        // Advance to next segment
        const moved = this.advanceSegment(this.timer);
        if (!moved) {
            this.handleIntervalFinish();
            return;
        }

        const nextSegment = this.getCurrentSegment(this.timer);
        if (!nextSegment) {
            this.handleIntervalFinish();
            return;
        }

        this.timer.segmentTimeRemaining = nextSegment.durationSeconds;
        this.timer.phase = nextSegment.type;
        this.timer.startTimeMs = Date.now();
        this.timer.pausedElapsedTime = 0;
        this.timer.isRunning = true;
        this.startTicker();
        this.render();
    }

    private handleIntervalFinish(): void {
        this.stopTicker();
        AudioUtils.playWorkCompleteChime();
        new Notice('All intervals complete!');
        this.timer = null;
        this.render();
    }

    // ─── Interval Helpers ───────────────────────────────────────

    private getCurrentSegment(timer: IntervalTimer): IntervalSegment | null {
        const group = timer.groups[timer.currentGroupIndex];
        if (!group) return null;
        return group.segments[timer.currentSegmentIndex] ?? null;
    }

    private advanceSegment(timer: IntervalTimer): boolean {
        const currentGroup = timer.groups[timer.currentGroupIndex];
        if (!currentGroup) return false;

        // Next segment in current group
        if (timer.currentSegmentIndex + 1 < currentGroup.segments.length) {
            timer.currentSegmentIndex++;
            return true;
        }

        // Next repeat of current group
        if (currentGroup.repeatCount === 0 || timer.currentRepeatIndex + 1 < Math.max(1, currentGroup.repeatCount || 1)) {
            timer.currentRepeatIndex++;
            timer.currentSegmentIndex = 0;
            return true;
        }

        // Next group
        if (timer.currentGroupIndex + 1 < timer.groups.length) {
            timer.currentGroupIndex++;
            timer.currentRepeatIndex = 0;
            timer.currentSegmentIndex = 0;
            return true;
        }

        return false;
    }

    private computeCompletedDuration(timer: IntervalTimer): number {
        let total = 0;
        for (let g = 0; g < timer.groups.length; g++) {
            const group = timer.groups[g];
            const repeats = group.repeatCount === 0
                ? (g === timer.currentGroupIndex ? timer.currentRepeatIndex : 0)
                : Math.max(1, group.repeatCount || 1);
            const groupDuration = group.segments.reduce((sum, s) => sum + s.durationSeconds, 0);

            if (g < timer.currentGroupIndex) {
                total += groupDuration * repeats;
                continue;
            }
            if (g > timer.currentGroupIndex) break;

            total += groupDuration * timer.currentRepeatIndex;
            for (let s = 0; s < timer.currentSegmentIndex; s++) {
                total += group.segments[s].durationSeconds;
            }
        }
        return total;
    }

    // ─── Rendering ──────────────────────────────────────────────

    private render(): void {
        this.container.empty();

        // Toolbar
        this.renderToolbar();

        const mainContainer = this.container.createDiv('pomodoro-view__main');

        // Interval mode: show template selector when idle
        if (this.timerViewMode === 'interval' && (!this.timer || this.timer.phase === 'idle')) {
            this.renderTemplateSelector(mainContainer);
            return;
        }

        // Progress ring
        const progressContainer = mainContainer.createDiv('pomodoro-view__progress-container');
        const displayTimer = this.timer ?? this.createTimerInstance();
        TimerProgressUI.render(progressContainer, displayTimer, this.formatTime.bind(this), 200);

        // Controls
        const controls = mainContainer.createDiv('pomodoro-view__controls');
        this.renderControls(controls);
    }

    private renderToolbar(): void {
        const toolbar = this.container.createDiv('view-toolbar');

        const isIdle = !this.timer || this.timer.phase === 'idle';

        // Mode dropdown (left)
        const modeBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--dropdown' });
        const modeIcon = modeBtn.createSpan('view-toolbar__btn-icon');
        const modeLabel = modeBtn.createSpan({ cls: 'view-toolbar__btn-label' });
        setIcon(modeIcon, 'chevrons-up-down');

        const labels: Record<TimerViewMode, string> = {
            countup: 'Countup',
            countdown: 'Countdown',
            pomodoro: 'Pomodoro',
            interval: 'Interval',
        };
        modeLabel.setText(labels[this.timerViewMode]);
        modeBtn.disabled = !isIdle;

        modeBtn.onclick = (e) => {
            if (!isIdle) return;
            const menu = new Menu();
            for (const mode of ['countup', 'countdown', 'pomodoro', 'interval'] as TimerViewMode[]) {
                menu.addItem((item) => {
                    item.setTitle(labels[mode])
                        .setChecked(this.timerViewMode === mode)
                        .onClick(async () => {
                            this.timerViewMode = mode;
                            this.timer = null;
                            this.selectedTemplate = null;
                            if (mode === 'interval') {
                                await this.loadTemplates();
                            }
                            this.render();
                        });
                });
            }
            menu.showAtMouseEvent(e);
        };

        // Spacer
        toolbar.createDiv('view-toolbar__spacer');

        // Interval mode: refresh button
        if (this.timerViewMode === 'interval' && isIdle) {
            const refreshBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
            setIcon(refreshBtn, 'refresh-cw');
            refreshBtn.setAttribute('aria-label', 'Reload templates');
            refreshBtn.onclick = async () => {
                await this.loadTemplates();
                this.render();
            };
        }

        // Settings gear (right, countdown/pomodoro only)
        if (this.timerViewMode === 'countdown' || this.timerViewMode === 'pomodoro') {
            const settingsBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
            setIcon(settingsBtn, 'settings');
            settingsBtn.setAttribute('aria-label', 'Settings');
            settingsBtn.onclick = (e) => this.showSettingsMenu(e);
        }
    }

    private updateDisplay(): void {
        if (!this.timer) return;
        TimerProgressUI.updateDisplay(this.container, this.timer, this.formatTime.bind(this), 200);
    }

    private renderControls(container: HTMLElement): void {
        if (!this.timer || this.timer.phase === 'idle') {
            // Start button
            const startBtn = container.createEl('button', {
                cls: 'pomodoro-view__btn pomodoro-view__btn--primary',
            });
            setIcon(startBtn, 'play');
            startBtn.createSpan({ text: ' Start' });
            startBtn.onclick = () => this.startTimer();
            return;
        }

        if (this.timer.isRunning) {
            // Pause button
            const pauseBtn = container.createEl('button', {
                cls: 'pomodoro-view__btn pomodoro-view__btn--secondary',
            });
            setIcon(pauseBtn, 'pause');
            pauseBtn.createSpan({ text: ' Pause' });
            pauseBtn.onclick = () => this.pauseTimer();

            // Reset button
            const resetBtn = container.createEl('button', {
                cls: 'pomodoro-view__btn pomodoro-view__btn--danger',
            });
            setIcon(resetBtn, 'x');
            resetBtn.createSpan({ text: ' Reset' });
            resetBtn.onclick = () => this.resetTimer();
            return;
        }

        // Paused state
        const resumeBtn = container.createEl('button', {
            cls: 'pomodoro-view__btn pomodoro-view__btn--primary',
        });
        setIcon(resumeBtn, 'play');
        resumeBtn.createSpan({ text: ' Resume' });
        resumeBtn.onclick = () => this.resumeTimer();

        const resetBtn = container.createEl('button', {
            cls: 'pomodoro-view__btn pomodoro-view__btn--danger',
        });
        setIcon(resetBtn, 'x');
        resetBtn.createSpan({ text: ' Reset' });
        resetBtn.onclick = () => this.resetTimer();
    }

    // ─── Interval Templates ─────────────────────────────────────

    private async loadTemplates(): Promise<void> {
        const folder = this.plugin.settings.intervalTemplateFolder;
        this.templates = await this.templateLoader.loadTemplates(folder);

        // Re-match selectedTemplate by filePath so stale references are replaced
        if (this.selectedTemplate) {
            const prev = this.selectedTemplate.filePath;
            this.selectedTemplate = this.templates.find(t => t.filePath === prev) ?? null;
        }
    }

    private renderTemplateSelector(parent: HTMLElement): void {
        const folder = this.plugin.settings.intervalTemplateFolder;

        if (!folder) {
            parent.createDiv({
                cls: 'pomodoro-view__template-empty',
                text: 'Set an interval template folder in plugin settings.',
            });
            return;
        }

        if (this.templates.length === 0) {
            parent.createDiv({
                cls: 'pomodoro-view__template-empty',
                text: 'No templates found. Add .md files with tv-segments in frontmatter.',
            });
            return;
        }

        const list = parent.createDiv('pomodoro-view__template-list');

        for (const template of this.templates) {
            const item = list.createDiv({
                cls: 'pomodoro-view__template-item'
                    + (this.selectedTemplate === template ? ' pomodoro-view__template-item--selected' : ''),
            });

            const iconEl = item.createSpan('pomodoro-view__template-icon');
            setIcon(iconEl, template.icon);

            item.createSpan({ cls: 'pomodoro-view__template-name', text: template.name });
            item.createSpan({ cls: 'pomodoro-view__template-duration', text: template.totalDurationLabel });

            item.onclick = () => {
                this.selectedTemplate = template;
                this.render();
            };
        }

        // Controls below template list
        const controls = parent.createDiv('pomodoro-view__controls');
        const startBtn = controls.createEl('button', {
            cls: 'pomodoro-view__btn pomodoro-view__btn--primary',
        });
        setIcon(startBtn, 'play');
        startBtn.createSpan({ text: ' Start' });
        startBtn.disabled = !this.selectedTemplate;
        if (!this.selectedTemplate) {
            startBtn.addClass('pomodoro-view__btn--disabled');
        }
        startBtn.onclick = () => {
            if (this.selectedTemplate) this.startTimer();
        };
    }

    // ─── Settings Menu ──────────────────────────────────────────

    private showSettingsMenu(e: MouseEvent): void {
        if (this.timerViewMode === 'countdown') {
            this.showCountdownSettingsMenu(e);
        } else if (this.timerViewMode === 'pomodoro') {
            this.showPomodoroSettingsMenu(e);
        }
    }

    private showCountdownSettingsMenu(e: MouseEvent): void {
        const menu = new Menu();

        menu.addItem((item) => {
            item.setTitle('Countdown Duration').setDisabled(true);
        });

        const presets = [5, 10, 15, 25, 30, 45, 50, 60];
        const current = this.plugin.settings.countdownMinutes;

        for (const mins of presets) {
            menu.addItem((item) => {
                item.setTitle(`  ${mins} min${current === mins ? ' \u2713' : ''}`)
                    .onClick(async () => {
                        this.plugin.settings.countdownMinutes = mins;
                        await this.plugin.saveSettings();
                        if (!this.timer || this.timer.phase === 'idle') {
                            this.timer = null;
                            this.render();
                        }
                    });
            });
        }

        menu.addItem((item) => {
            const isCustom = !presets.includes(current);
            item.setTitle(`  Custom...${isCustom ? ` (${current} min) \u2713` : ''}`)
                .onClick(() => {
                    new InputModal(
                        this.app,
                        'Countdown Duration',
                        'Minutes (1-120)',
                        current.toString(),
                        async (value) => {
                            const mins = parseInt(value);
                            if (!isNaN(mins) && mins > 0 && mins <= 120) {
                                this.plugin.settings.countdownMinutes = mins;
                                await this.plugin.saveSettings();
                                if (!this.timer || this.timer.phase === 'idle') {
                                    this.timer = null;
                                    this.render();
                                }
                            }
                        }
                    ).open();
                });
        });

        menu.showAtMouseEvent(e);
    }

    private showPomodoroSettingsMenu(e: MouseEvent): void {
        const menu = new Menu();

        menu.addItem((item) => {
            item.setTitle('Work Duration').setDisabled(true);
        });

        const workOptions = [15, 25, 30, 45, 50];
        for (const mins of workOptions) {
            menu.addItem((item) => {
                const current = this.plugin.settings.pomodoroWorkMinutes;
                item.setTitle(`  ${mins} min${current === mins ? ' \u2713' : ''}`)
                    .onClick(async () => {
                        this.plugin.settings.pomodoroWorkMinutes = mins;
                        await this.plugin.saveSettings();
                        this.applyPomodoroSettingsToTimer();
                    });
            });
        }

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
                                this.applyPomodoroSettingsToTimer();
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
        for (const mins of breakOptions) {
            menu.addItem((item) => {
                const current = this.plugin.settings.pomodoroBreakMinutes;
                item.setTitle(`  ${mins} min${current === mins ? ' \u2713' : ''}`)
                    .onClick(async () => {
                        this.plugin.settings.pomodoroBreakMinutes = mins;
                        await this.plugin.saveSettings();
                        this.applyPomodoroSettingsToTimer();
                    });
            });
        }

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
                                this.applyPomodoroSettingsToTimer();
                            }
                        }
                    ).open();
                });
        });

        menu.showAtMouseEvent(e);
    }

    private applyPomodoroSettingsToTimer(): void {
        // Only update timer if idle (not running/paused)
        if (!this.timer || this.timer.phase === 'idle') {
            this.timer = null;
            this.render();
        }
    }

    // ─── Utilities ──────────────────────────────────────────────

    private formatTime(seconds: number): string {
        return TimeFormatter.formatSignedSeconds(seconds);
    }
}
