/**
 * Timer View (formerly Pomodoro View)
 *
 * タスク非紐付けの独立タイマービュー。4モード: countup / countdown / pomodoro / interval。
 * 走行は測り方と時計の組で、表示と出来事はウィジェットと同じ `TimerProgress` が
 * 導く。ウィジェットとの違いは、記録を書かないことと、出来事への応じ方（countdown
 * が 0 をまたぐと鳴らして告げ、区間の終わりを告げる）。
 */

import { type Menu, type WorkspaceLeaf, Notice, setIcon } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import type { TimerHost } from '../timer/TimerWidget';
import { TimerProgressUI, type RingOptions, type RingState } from '../timer/TimerProgressUI';
import { IntervalTemplateLoader, type IntervalTemplate } from '../timer/IntervalTemplateLoader';
import { AudioUtils } from '../timer/AudioUtils';
import { pomodoroGroups, segmentAt, START_CURSOR } from '../timer/IntervalMath';
import { freeze, readSeconds, restart, resume, type Clock } from '../timer/TimerClock';
import { progressOf, tickOf, type Measure } from '../timer/TimerProgress';
import { TimeFormatter } from '../utils/TimeFormatter';
import { IntervalTemplateCreator } from './customMenus/IntervalTemplateCreator';
import { TimerToolbar } from './TimerToolbar';
import { TimerSettingsMenu } from '../timer/TimerSettingsMenu';
import { createControlButton, type ControlButtonVariant } from '../timer/TimerControlButton';
import { TimerCodec, TIMER_VIEW_MODES, type TimerConfig, type TimerViewMode } from './TimerSchema';
import { TaskViewerView } from './base/TaskViewerView';
import { t } from '../i18n';


/** 走行。時計が止まっていれば一時停止。 */
interface Run {
    measure: Measure;
    clock: Clock;
}

/**
 * Its state is TimerSchema's config (name, mode, the interval template's
 * name), held in the base's store and saved with the workspace.
 *
 * 走行中のタイマーは状態に入れず、保存しない。このビューのタイマーは記録を書かない
 * ので、再起動をまたいで復元しても計っていない時間を計ったことにするだけになる
 * （記録を持つウィジェット側は `TimerPersistence` が別に面倒を見る）。走行はその
 * モードのもので、状態のモードが変われば（メニュー、上書きの URI、既定に戻す）捨てる。
 *
 * The view hears none of the plugin's events (`ViewDescriptors`): it runs its
 * own clock of seconds while a timer runs.
 */
export class TimerView extends TaskViewerView<TimerConfig> {
    private container: HTMLElement;
    private run: Run | null = null;
    /** 前の tick の時刻。tick はここから今までに起きたことに応じる。 */
    private lastTickMs = 0;
    private tickIntervalId: number | null = null;

    private templateLoader: IntervalTemplateLoader;
    private templateCreator: IntervalTemplateCreator | null = null;
    private templates: IntervalTemplate[] = [];
    private toolbar: TimerToolbar;

    constructor(leaf: WorkspaceLeaf, plugin: PluginContext & TimerHost) {
        super(leaf, plugin, TimerCodec);
        this.templateLoader = new IntervalTemplateLoader(plugin.app);

        this.toolbar = new TimerToolbar({
            host: this.toolbarHost(),
            commands: {
                isIdle: () => !this.run,
                selectMode: (event) => this.showModeMenu(event),
                reloadTemplates: () => void this.loadTemplates(),
                settingsOptions: () => this.toolbarHost().settingsOptions((menu) => this.appendDurationItems(menu)),
            },
        });

        this.store.subscribe((patch, prev) => {
            // 走行はそのモードのもの。モードが変われば捨てる。
            if (this.mode() !== (prev.timerViewMode ?? 'pomodoro')) {
                this.stopTicker();
                this.run = null;
            }
            // interval に入るたびにテンプレートを読み直す（選んだ名前はそのあと引く）。
            if ('timerViewMode' in patch && this.mode() === 'interval') void this.loadTemplates();
        });
    }

    /** The mode the view is in. */
    private mode(): TimerViewMode {
        return this.state.timerViewMode ?? 'pomodoro';
    }

    /** The interval template chosen: the one of the state's name among those read. */
    private selectedTemplate(): IntervalTemplate | null {
        const name = this.state.intervalTemplate;
        return name === undefined ? null : this.templates.find(t => t.name === name) ?? null;
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
                        .setChecked(this.mode() === mode)
                        .onClick(() => this.update({ timerViewMode: mode, intervalTemplate: undefined }));
                });
            }
        }, { kind: 'mouseEvent', event });
    }

    protected openView(): void {
        this.container = this.contentEl;
        this.container.empty();
        this.container.addClass('timer-view');
    }

    protected closeView(): void {
        this.stopTicker();
    }

    // ─── Measure ────────────────────────────────────────────────

    /** 今のモードの測り方。interval でテンプレートを選んでいなければ null。 */
    private measureOf(): Measure | null {
        const settings = this.plugin.settings;
        switch (this.mode()) {
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
            case 'interval': {
                const template = this.selectedTemplate();
                if (!template) return null;
                return { type: 'interval', source: 'template', groups: template.groups, at: START_CURSOR };
            }
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
        this.requestDraw();
    }

    private pauseTimer(): void {
        if (!this.run || this.run.clock.kind !== 'running') return;
        this.run.clock = freeze(this.run.clock, Date.now());
        this.stopTicker();
        this.requestDraw();
    }

    private resumeTimer(): void {
        if (!this.run || this.run.clock.kind === 'running') return;
        const now = Date.now();
        this.run.clock = resume(this.run.clock, now);
        this.lastTickMs = now;
        AudioUtils.playStartSound();
        this.startTicker();
        this.requestDraw();
    }

    private resetTimer(): void {
        this.stopTicker();
        this.run = null;
        this.requestDraw();
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
            this.requestDraw();
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
        this.requestDraw();
    }

    // ─── Rendering ──────────────────────────────────────────────

    protected draw(): void {
        this.toolbar.detach();
        this.container.empty();

        const toolbarHost = this.container.createDiv('timer-view__toolbar-host');
        this.toolbar.mount(toolbarHost);

        const mainContainer = this.container.createDiv('timer-view__main');

        // Interval mode: show template selector when idle
        if (this.mode() === 'interval' && !this.run) {
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

    /**
     * Read the interval templates, and draw. A chosen template whose name
     * changed in its file stays chosen, under its new name.
     */
    private async loadTemplates(): Promise<void> {
        const chosen = this.selectedTemplate()?.filePath;
        const folder = this.plugin.settings.intervalTemplateFolder;
        this.templates = await this.templateLoader.loadTemplates(folder);

        if (chosen !== undefined) {
            const name = this.templates.find(t => t.filePath === chosen)?.name;
            if (name !== this.state.intervalTemplate) {
                this.update({ intervalTemplate: name });
                return;
            }
        }
        this.requestDraw();
    }

    /** Choose the template saved at `filePath`, once the templates are read again. */
    private async chooseSaved(filePath: string): Promise<void> {
        this.templates = await this.templateLoader.loadTemplates(this.plugin.settings.intervalTemplateFolder);
        this.update({ intervalTemplate: this.templates.find(t => t.filePath === filePath)?.name });
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
        const selected = this.selectedTemplate();

        if (this.templates.length === 0) {
            list.createDiv({
                cls: 'timer-view__template-empty',
                text: t('timer.noTemplatesFound'),
            });
        } else {
            for (const template of this.templates) {
                const item = list.createDiv({
                    cls: 'timer-view__template-item'
                        + (selected === template ? ' timer-view__template-item--selected' : ''),
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
                        onSaved: (filePath: string) => this.chooseSaved(filePath),
                    });
                });

                item.onclick = () => this.update({ intervalTemplate: template.name });
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
                onSaved: (filePath: string) => this.chooseSaved(filePath),
            });
        };

        // Controls below (Start button)
        if (this.templates.length > 0) {
            const controls = parent.createDiv('timer-view__controls');
            const startBtn = this.addViewButton(controls, 'primary', 'play', t('timer.start'), () => {
                if (selected) this.startTimer();
            });
            startBtn.disabled = !selected;
            if (!selected) {
                startBtn.addClass('timer-view__btn--disabled');
            }
        }
    }

    // ─── Settings Menu ──────────────────────────────────────────

    /**
     * The lengths of the mode, above the shared settings. ビューは走行中タイマー
     * を持たないので、設定を保存して作り直すだけ。長さの選択肢はウィジェットと同じ部品。
     */
    private appendDurationItems(menu: Menu): void {
        const mode = this.mode();
        if (mode === 'countdown') {
            TimerSettingsMenu.addCountdownField(menu, this.app, {
                get: () => this.plugin.settings.countdownMinutes,
                set: (minutes) => this.saveDurationSetting('countdownMinutes', minutes),
            });
        } else if (mode === 'pomodoro') {
            TimerSettingsMenu.addPomodoroFields(menu, this.app, {
                getWorkMinutes: () => this.plugin.settings.pomodoroWorkMinutes,
                setWorkMinutes: (minutes) => this.saveDurationSetting('pomodoroWorkMinutes', minutes),
                getBreakMinutes: () => this.plugin.settings.pomodoroBreakMinutes,
                setBreakMinutes: (minutes) => this.saveDurationSetting('pomodoroBreakMinutes', minutes),
            });
        }
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
        this.requestDraw();
    }
}
