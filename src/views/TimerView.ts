/**
 * Timer View (formerly Pomodoro View)
 *
 * タスク非紐付けの独立タイマービュー。4モード: countup / countdown / pomodoro / interval。
 * 走行は測り方と時計の組で、表示と出来事はウィジェットと同じ `TimerProgress` が
 * 導く。ウィジェットとの違いは、記録を書かないことと、出来事への応じ方（countdown
 * が 0 をまたぐと鳴らして告げ、区間の終わりを告げる）。
 */

import { ItemView, type WorkspaceLeaf, Notice, setIcon, type ViewStateResult } from 'obsidian';
import { logDebug } from '../log/log';
import type { PluginContext } from '../PluginContext';
import { VIEW_DESCRIPTORS, viewDisplayName } from './ViewDescriptors';
import { TimerProgressUI, type RingOptions, type RingState } from '../timer/TimerProgressUI';
import { IntervalTemplateLoader, type IntervalTemplate } from '../timer/IntervalTemplateLoader';
import { AudioUtils } from '../timer/AudioUtils';
import { pomodoroGroups, segmentAt, START_CURSOR } from '../timer/IntervalMath';
import { freeze, readSeconds, restart, resume, type Clock } from '../timer/TimerClock';
import { progressOf, tickOf, type Measure } from '../timer/TimerProgress';
import { TimeFormatter } from '../utils/TimeFormatter';
import { ViewUriBuilder } from './sharedLogic/ViewUriBuilder';
import type { ViewUriOptions } from './sharedLogic/ViewUriBuilder';
import { IntervalTemplateCreator } from './customMenus/IntervalTemplateCreator';
import { TimerToolbar } from './TimerToolbar';
import { TimerSettingsMenu } from '../timer/TimerSettingsMenu';
import { createControlButton, type ControlButtonVariant } from '../timer/TimerControlButton';
import { TimerSchema, TimerCodec, TIMER_VIEW_MODES, type TimerViewMode } from './TimerSchema';
import { t } from '../i18n';


/** 走行。時計が止まっていれば一時停止。 */
interface Run {
    measure: Measure;
    clock: Clock;
}

export class TimerView extends ItemView {
    private plugin: PluginContext;
    private container: HTMLElement;
    private timerViewMode: TimerViewMode = 'pomodoro';
    private customName?: string;
    private run: Run | null = null;
    /** 前の tick の時刻。tick はここから今までに起きたことに応じる。 */
    private lastTickMs = 0;
    private tickIntervalId: number | null = null;

    private templateLoader: IntervalTemplateLoader;
    private templateCreator: IntervalTemplateCreator | null = null;
    private templates: IntervalTemplate[] = [];
    private selectedTemplate: IntervalTemplate | null = null;
    private toolbar: TimerToolbar;

    constructor(leaf: WorkspaceLeaf, plugin: PluginContext) {
        super(leaf);
        this.plugin = plugin;
        this.templateLoader = new IntervalTemplateLoader(plugin.app);

        this.toolbar = new TimerToolbar({
            getMode: () => this.timerViewMode,
            isIdle: () => !this.run,
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
        if (this.run) return;
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
                            this.run = null;
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
        return TimerSchema.viewType;
    }

    getDisplayText(): string {
        return this.customName || viewDisplayName(TimerSchema.viewType);
    }

    getIcon(): string {
        return VIEW_DESCRIPTORS[TimerSchema.viewType].icon;
    }

    async onOpen(): Promise<void> {
        logDebug(`[${this.getViewType()}] opened`);
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('timer-view');
        this.render();
    }

    private readonly codec = TimerCodec;

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

    // ─── Measure ────────────────────────────────────────────────

    /** 今のモードの測り方。interval でテンプレートを選んでいなければ null。 */
    private measureOf(): Measure | null {
        const settings = this.plugin.settings;
        switch (this.timerViewMode) {
            case 'countup':
                return { type: 'countup' };
            case 'countdown':
                return { type: 'countdown', totalSeconds: settings.countdownMinutes * 60 };
            case 'pomodoro':
                return {
                    type: 'interval',
                    source: 'pomodoro',
                    groups: pomodoroGroups(settings.pomodoroWorkMinutes, settings.pomodoroBreakMinutes),
                    at: START_CURSOR,
                };
            case 'interval':
                if (!this.selectedTemplate) return null;
                return { type: 'interval', source: 'template', groups: this.selectedTemplate.groups, at: START_CURSOR };
        }
    }

    // ─── Timer Actions ──────────────────────────────────────────

    private startTimer(): void {
        const measure = this.measureOf();
        if (!measure) return;
        const now = Date.now();
        this.run = { measure, clock: restart(now) };
        this.lastTickMs = now;

        AudioUtils.playStartSound();
        this.startTicker();
        this.render();
    }

    private pauseTimer(): void {
        if (!this.run || this.run.clock.kind !== 'running') return;
        this.run.clock = freeze(this.run.clock, Date.now());
        this.stopTicker();
        this.render();
    }

    private resumeTimer(): void {
        if (!this.run || this.run.clock.kind === 'running') return;
        const now = Date.now();
        this.run.clock = resume(this.run.clock, now);
        this.lastTickMs = now;
        AudioUtils.playStartSound();
        this.startTicker();
        this.render();
    }

    private resetTimer(): void {
        this.stopTicker();
        this.run = null;
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
        const run = this.run;
        if (!run || run.clock.kind !== 'running') return;

        const now = Date.now();
        const tick = tickOf(run, now, this.lastTickMs);
        this.lastTickMs = now;

        if (tick.finishedAtMs !== null) {
            this.finish();
            return;
        }

        const ended = run.measure.type === 'interval' ? segmentAt(run.measure.groups, run.measure.at) : null;
        run.measure = tick.measure;

        if (tick.crossedZero) {
            AudioUtils.playFinishSound();
            new Notice(t('timer.complete'));
        }
        if (tick.segmentsMoved > 0) {
            AudioUtils.playTransitionConfirm();
            if (ended?.type === 'work') {
                new Notice(t('timer.workComplete'));
            } else if (ended?.type === 'break') {
                new Notice(t('timer.breakComplete'));
            }
        }
        if (tick.warn) {
            AudioUtils.playWarningBeep();
        }

        if (tick.segmentsMoved > 0) {
            this.render();
        } else {
            this.updateDisplay();
        }
    }

    /** interval の最後の区間が終わった。 */
    private finish(): void {
        this.stopTicker();
        AudioUtils.playFinishSound();
        new Notice(t('timer.allIntervalsComplete'));
        this.run = null;
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
        if (this.timerViewMode === 'interval' && !this.run) {
            this.renderTemplateSelector(mainContainer);
            return;
        }

        const ring = this.ringState();
        if (ring) {
            const progressContainer = mainContainer.createDiv('timer-view__progress-container');
            TimerProgressUI.render(progressContainer, ring, this.ringOptions());
        }

        const controls = mainContainer.createDiv('timer-view__controls');
        this.renderControls(controls);
    }

    private updateDisplay(): void {
        const ring = this.ringState();
        if (ring) TimerProgressUI.update(this.container, ring, this.ringOptions());
    }

    /** 走行の今の表示。開始前は測り方の 0 秒を色無しで見せる。 */
    private ringState(): RingState | null {
        if (this.run) {
            return progressOf(this.run.measure, readSeconds(this.run.clock, Date.now()));
        }
        const measure = this.measureOf();
        return measure ? { ...progressOf(measure, 0), tone: 'plain' } : null;
    }

    private ringOptions(): RingOptions {
        return { block: 'timer-view', size: 200, format: (seconds) => TimeFormatter.formatSignedSeconds(seconds) };
    }

    private renderControls(container: HTMLElement): void {
        if (!this.run) {
            this.addViewButton(container, 'primary', 'play', t('timer.start'), () => this.startTimer());
            return;
        }

        if (this.run.clock.kind === 'running') {
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
                const editBtn = item.createEl('button', { cls: 'tv-icon-btn timer-view__template-edit-btn' });
                setIcon(editBtn.createSpan(), 'settings');
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.templateCreator) {
                        this.templateCreator = new IntervalTemplateCreator(this.app, this.plugin.getOperations());
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
                this.templateCreator = new IntervalTemplateCreator(this.app, this.plugin.getOperations());
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
                        const name = viewDisplayName(TimerSchema.viewType);
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
        return ViewUriBuilder.build(TimerSchema.viewType, opts);
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
        if (this.run) return;
        this.render();
    }
}
