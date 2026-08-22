/**
 * Timer View (formerly Pomodoro View)
 *
 * タスク非紐付けの独立タイマービュー。
 * 4モード対応: countup / countdown / pomodoro / interval
 * TimerInstance 型と TimerProgressUI を再利用。
 */

import { ItemView, type WorkspaceLeaf, Notice, setIcon, type ViewStateResult } from 'obsidian';
import { logDebug } from '../log/log';
import type TaskViewerPlugin from '../main';
import { VIEW_META_TIMER } from '../constants/viewRegistry';
import type {
    CountupTimer,
    CountdownTimer,
    IntervalGroup,
    IntervalTimer,
    TimerInstance,
    TimerPhase,
} from '../timer/TimerInstance';
import { TimerProgressUI } from '../timer/TimerProgressUI';
import { IntervalTemplateLoader, type IntervalTemplate } from '../timer/IntervalTemplateLoader';
import { AudioUtils } from '../timer/AudioUtils';
import {
    advanceSegment,
    computeCompletedDuration,
    computeTotalDuration,
    getCurrentSegment,
} from '../timer/IntervalMath';
import {
    accumulatePausedElapsed,
    applyCountdownTick,
    applyCountupTick,
    applyIntervalPauseSnapshot,
    applyIntervalTick,
} from '../timer/TimerTickMath';
import { TimeFormatter } from '../utils/TimeFormatter';
import { ViewUriBuilder } from './sharedLogic/ViewUriBuilder';
import type { ViewUriOptions } from './sharedLogic/ViewUriBuilder';
import { IntervalTemplateCreator } from './customMenus/IntervalTemplateCreator';
import { TimerToolbar } from './TimerToolbar';
import { TimerSettingsMenu } from '../timer/TimerSettingsMenu';
import { createControlButton, type ControlButtonVariant } from '../timer/TimerControlButton';
import { codecFor, type ViewConfigCodec } from '../services/viewConfig';
import { TIMER_VIEW_MODES, type TimerConfig, type TimerViewMode } from './TimerSchema';
import { t } from '../i18n';

export const VIEW_TYPE_TIMER = VIEW_META_TIMER.type;

const TIMER_VIEW_ID = '__timer-view__';

export class TimerView extends ItemView {
    private plugin: TaskViewerPlugin;
    private container: HTMLElement;
    private timerViewMode: TimerViewMode = 'pomodoro';
    private customName?: string;
    private timer: TimerInstance | null = null;
    private tickIntervalId: number | null = null;

    private templateLoader: IntervalTemplateLoader;
    private templateCreator: IntervalTemplateCreator | null = null;
    private templates: IntervalTemplate[] = [];
    private selectedTemplate: IntervalTemplate | null = null;
    private toolbar: TimerToolbar;

    constructor(leaf: WorkspaceLeaf, plugin: TaskViewerPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.templateLoader = new IntervalTemplateLoader(plugin.app);

        this.toolbar = new TimerToolbar({
            plugin: this.plugin,
            getMode: () => this.timerViewMode,
            isIdle: () => !this.timer,
            onSelectMode: (event) => this.showModeMenu(event),
            onReloadTemplates: () => {
                void (async () => {
                    await this.loadTemplates();
                    this.render();
                })();
            },
            onShowSettingsMenu: (e) => this.showSettingsMenu(e),
        });
    }

    private showModeMenu(event: MouseEvent): void {
        if (this.timer) return;
        const labels: Record<TimerViewMode, string> = {
            countup: t('timer.countup'),
            countdown: t('timer.countdown'),
            pomodoro: t('timer.pomodoro'),
            interval: t('timer.interval'),
        };
        this.plugin.menuPresenter.present((menu) => {
            for (const mode of TIMER_VIEW_MODES) {
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
                            this.requestSaveState();
                        });
                });
            }
        }, { kind: 'mouseEvent', event });
    }

    getViewType(): string {
        return VIEW_TYPE_TIMER;
    }

    getDisplayText(): string {
        return this.customName || VIEW_META_TIMER.displayText;
    }

    getIcon(): string {
        return VIEW_META_TIMER.icon;
    }

    async onOpen(): Promise<void> {
        logDebug(`[${this.getViewType()}] opened`);
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('timer-view');
        this.render();
    }

    private get codec(): ViewConfigCodec<TimerConfig> {
        return codecFor(VIEW_TYPE_TIMER) as ViewConfigCodec<TimerConfig>;
    }

    /** 保存対象の状態が変わったことを workspace に伝える（次の保存で getState が呼ばれる）。 */
    private requestSaveState(): void {
        void this.app.workspace.requestSaveLayout();
    }

    /**
     * ワークスペース保存に乗せる状態。
     *
     * 走行中のタイマーは持ち出さない。このビューのタイマーは記録を書かないので、
     * 再起動をまたいで復元しても計っていない時間を計ったことにするだけになる
     * （記録を持つウィジェット側は `TimerPersistence` が別に面倒を見る）。
     */
    getState(): Record<string, unknown> {
        return this.codec.serializeConfig({
            customName: this.customName,
            timerViewMode: this.timerViewMode,
            intervalTemplate: this.selectedTemplate?.name,
        });
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        await super.setState(state, result);

        const config = this.codec.parseConfig(state as Record<string, unknown>);
        // 既定値は当てない。キーの無い状態辞書で呼ばれたときに今のモードを
        // 捨ててしまう（Obsidian は復元以外でも setState を呼ぶ）。
        if (config.timerViewMode) this.timerViewMode = config.timerViewMode;
        if (config.customName !== undefined) this.customName = config.customName;

        if (config.intervalTemplate && this.timerViewMode === 'interval') {
            await this.loadTemplates();
            this.selectedTemplate = this.templates.find(t => t.name === config.intervalTemplate) ?? null;
        }

        if (this.container) this.render();
    }

    async onClose(): Promise<void> {
        logDebug(`[${this.getViewType()}] closed`);
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
            recordMode: 'self' as const,
            parserId: 'tv-inline',
            taskColor: '',
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
                const totalDuration = computeTotalDuration(groups);
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


    // ─── Timer Actions ──────────────────────────────────────────

    private startTimer(): void {
        this.timer = this.createTimerInstance();
        const now = Date.now();
        this.timer.startTimeMs = now;
        this.timer.isRunning = true;

        if (this.timer.timerType === 'interval') {
            const segment = getCurrentSegment(this.timer);
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

        accumulatePausedElapsed(this.timer, Date.now());
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
            case 'interval':
                applyIntervalPauseSnapshot(this.timer);
                break;
        }

        this.render();
    }

    private resumeTimer(): void {
        if (!this.timer || this.timer.isRunning) return;

        if (this.timer.timerType === 'interval') {
            const segment = getCurrentSegment(this.timer);
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

        switch (this.timer.timerType) {
            case 'countup':
                applyCountupTick(this.timer, now);
                this.updateDisplay();
                return;
            case 'countdown': {
                const tick = applyCountdownTick(this.timer, now);
                // phase は進捗リングの色の元。セッションが在るかどうかは
                // `this.timer` が持つので、ここを「未開始」の判定に使わない。
                this.timer.phase = tick.remaining < 0 ? 'idle' : 'work';
                if (tick.warn) {
                    AudioUtils.playWarningBeep();
                }
                if (tick.crossedZero) {
                    AudioUtils.playFinishSound();
                    new Notice(t('timer.complete'));
                }
                this.updateDisplay();
                return;
            }
            case 'interval': {
                const tick = applyIntervalTick(this.timer, now);
                if (tick.outcome === 'no-segment') {
                    this.handleIntervalFinish();
                    return;
                }
                if (tick.outcome === 'segment-complete') {
                    this.handleSegmentComplete();
                    return;
                }
                if (tick.warn) {
                    AudioUtils.playWarningBeep();
                }
                this.updateDisplay();
                return;
            }
        }
    }

    // ─── Completion Handlers ────────────────────────────────────

    private handleSegmentComplete(): void {
        if (!this.timer || this.timer.timerType !== 'interval') return;

        this.stopTicker();
        const currentSegment = getCurrentSegment(this.timer);
        if (!currentSegment) {
            this.handleIntervalFinish();
            return;
        }

        // Update totalElapsedTime
        this.timer.totalElapsedTime = computeCompletedDuration(this.timer) + currentSegment.durationSeconds;

        // Advance to next segment first to decide which sound to play
        const moved = advanceSegment(this.timer);
        if (!moved) {
            this.handleIntervalFinish();
            return;
        }

        // Play transition confirm chime (only when continuing to next segment)
        AudioUtils.playTransitionConfirm();
        if (currentSegment.type === 'work') {
            new Notice(t('timer.workComplete'));
        } else if (currentSegment.type === 'break') {
            new Notice(t('timer.breakComplete'));
        }

        const nextSegment = getCurrentSegment(this.timer);
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
        AudioUtils.playFinishSound();
        new Notice(t('timer.allIntervalsComplete'));
        this.timer = null;
        this.render();
    }

    // ─── Rendering ──────────────────────────────────────────────

    private render(): void {
        this.toolbar.detach();
        this.container.empty();

        const toolbarHost = this.container.createDiv('timer-view__toolbar-host');
        this.toolbar.mount(toolbarHost);

        const mainContainer = this.container.createDiv('timer-view__main');

        // Interval mode: show template selector when idle
        if (this.timerViewMode === 'interval' && !this.timer) {
            this.renderTemplateSelector(mainContainer);
            return;
        }

        // Progress ring
        const progressContainer = mainContainer.createDiv('timer-view__progress-container');
        const displayTimer = this.timer ?? this.createTimerInstance();
        TimerProgressUI.render(progressContainer, displayTimer, this.formatTime.bind(this), 200);

        // Controls
        const controls = mainContainer.createDiv('timer-view__controls');
        this.renderControls(controls);
    }

    private updateDisplay(): void {
        if (!this.timer) return;
        TimerProgressUI.updateDisplay(this.container, this.timer, this.formatTime.bind(this), 200);
    }

    private renderControls(container: HTMLElement): void {
        if (!this.timer) {
            this.addViewButton(container, 'primary', 'play', t('timer.start'), () => this.startTimer());
            return;
        }

        if (this.timer.isRunning) {
            this.addViewButton(container, 'secondary', 'pause', t('timer.pause'), () => {
                this.pauseTimer();
                AudioUtils.playPauseSound();
            });
            this.addViewButton(container, 'danger', 'square', t('timer.stop'), () => {
                AudioUtils.playFinishSound();
                this.resetTimer();
            });
            return;
        }

        // 一時停止中。カウントダウンが 0 を過ぎていてもここに来る。
        this.addViewButton(container, 'primary', 'play', t('timer.resume'), () => this.resumeTimer());
        this.addViewButton(container, 'danger', 'x', t('timer.reset'), () => this.resetTimer());
    }

    /** ビューの操作ボタン。ブロック名を固定しただけの薄い包み。 */
    private addViewButton(
        container: HTMLElement,
        variant: ControlButtonVariant,
        icon: string,
        label: string,
        onClick: () => void,
    ): HTMLButtonElement {
        return createControlButton(container, { block: 'timer-view', variant, icon, label, onClick });
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
                cls: 'timer-view__template-empty',
                text: t('timer.setIntervalFolder'),
            });
            return;
        }

        const list = parent.createDiv('timer-view__template-list');

        if (this.templates.length === 0) {
            list.createDiv({
                cls: 'timer-view__template-empty',
                text: t('timer.noTemplatesFound'),
            });
        } else {
            for (const template of this.templates) {
                const item = list.createDiv({
                    cls: 'timer-view__template-item'
                        + (this.selectedTemplate === template ? ' timer-view__template-item--selected' : ''),
                });

                const iconEl = item.createSpan('timer-view__template-icon');
                setIcon(iconEl, template.icon);

                item.createSpan({ cls: 'timer-view__template-name', text: template.name });
                item.createSpan({ cls: 'timer-view__template-duration', text: template.totalDurationLabel });

                // Edit gear button
                const editBtn = item.createEl('button', { cls: 'timer-view__template-edit-btn' });
                setIcon(editBtn.createSpan(), 'settings');
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.templateCreator) {
                        this.templateCreator = new IntervalTemplateCreator(this.app);
                    }
                    this.templateCreator.showEdit(editBtn, folder, template, {
                        onSaved: async (filePath: string) => {
                            await this.loadTemplates();
                            this.selectedTemplate = this.templates.find(t => t.filePath === filePath) ?? null;
                            this.render();
                            this.requestSaveState();
                        },
                    });
                });

                item.onclick = () => {
                    this.selectedTemplate = template;
                    this.render();
                    this.requestSaveState();
                };
            }
        }

        // "New Template" button — inside template list, filter-popover__add-btn style
        const addBtn = list.createEl('button', {
            cls: 'timer-view__add-template-btn',
        });
        const addIcon = addBtn.createSpan('timer-view__add-template-icon');
        setIcon(addIcon, 'plus');
        addBtn.createSpan({ text: t('timer.newTemplate') });
        addBtn.onclick = () => {
            if (!this.templateCreator) {
                this.templateCreator = new IntervalTemplateCreator(this.app);
            }
            this.templateCreator.show(addBtn, folder, {
                onSaved: async (filePath: string) => {
                    await this.loadTemplates();
                    this.selectedTemplate = this.templates.find(t => t.filePath === filePath) ?? null;
                    this.render();
                    this.requestSaveState();
                },
            });
        };

        // Controls below (Start button)
        if (this.templates.length > 0) {
            const controls = parent.createDiv('timer-view__controls');
            const startBtn = this.addViewButton(controls, 'primary', 'play', t('timer.start'), () => {
                if (this.selectedTemplate) this.startTimer();
            });
            startBtn.disabled = !this.selectedTemplate;
            if (!this.selectedTemplate) {
                startBtn.addClass('timer-view__btn--disabled');
            }
        }
    }

    // ─── Settings Menu ──────────────────────────────────────────

    private showSettingsMenu(e: MouseEvent): void {
        this.plugin.menuPresenter.present((menu) => {
            // Mode-specific settings。長さの選択肢はウィジェットと同じ部品。
            // ビューは走行中タイマーを持たないので、設定を保存して作り直すだけ。
            if (this.timerViewMode === 'countdown') {
                TimerSettingsMenu.addCountdownField(menu, this.app, {
                    get: () => this.plugin.settings.countdownMinutes,
                    set: (minutes) => this.saveDurationSetting('countdownMinutes', minutes),
                });
                menu.addSeparator();
            } else if (this.timerViewMode === 'pomodoro') {
                TimerSettingsMenu.addPomodoroFields(menu, this.app, {
                    getWorkMinutes: () => this.plugin.settings.pomodoroWorkMinutes,
                    setWorkMinutes: (minutes) => this.saveDurationSetting('pomodoroWorkMinutes', minutes),
                    getBreakMinutes: () => this.plugin.settings.pomodoroBreakMinutes,
                    setBreakMinutes: (minutes) => this.saveDurationSetting('pomodoroBreakMinutes', minutes),
                });
                menu.addSeparator();
            }

            // Copy URI (all modes)
            menu.addItem((item) => {
                item.setTitle(t('timer.copyUri'))
                    .setIcon('link')
                    .onClick(async () => {
                        const uri = this.buildCurrentUri();
                        await navigator.clipboard.writeText(uri);
                        new Notice(t('notice.uriCopied'));
                    });
            });

            // Copy as link (all modes)
            menu.addItem((item) => {
                item.setTitle(t('timer.copyAsLink'))
                    .setIcon('external-link')
                    .onClick(async () => {
                        const uri = this.buildCurrentUri();
                        const name = VIEW_META_TIMER.displayText;
                        const link = `[${name}](${uri})`;
                        await navigator.clipboard.writeText(link);
                        new Notice(t('notice.linkCopied'));
                    });
            });
        }, { kind: 'mouseEvent', event: e });
    }

    private buildCurrentUri(): string {
        const opts: ViewUriOptions = {
            position: ViewUriBuilder.detectLeafPosition(this.leaf, this.app.workspace),
            mode: this.timerViewMode,
        };
        if (this.timerViewMode === 'interval' && this.selectedTemplate) {
            opts.intervalTemplate = this.selectedTemplate.name;
        }
        return ViewUriBuilder.build(VIEW_TYPE_TIMER, opts);
    }

    private async saveDurationSetting(
        key: 'countdownMinutes' | 'pomodoroWorkMinutes' | 'pomodoroBreakMinutes',
        minutes: number,
    ): Promise<void> {
        this.plugin.settings[key] = minutes;
        await this.plugin.saveSettings();
        this.applyDurationSettingsToTimer();
    }

    /**
     * 変えた長さを次のタイマーに映す。走っている（超過中も含む）なら触らない —
     * 計っている最中のセッションを設定変更で捨てるわけにはいかない。
     */
    private applyDurationSettingsToTimer(): void {
        if (this.timer) return;
        this.render();
    }

    // ─── Utilities ──────────────────────────────────────────────

    private formatTime(seconds: number): string {
        return TimeFormatter.formatSignedSeconds(seconds);
    }
}
