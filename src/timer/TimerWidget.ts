/**
 * Floating Timer Widget
 * 
 * フローティングウィジェットとして複数のタイマー（Pomodoro/Countup）を管理。
 * アコーディオン形式で個別にトグル可能。
 */

import { type App, Notice, type Plugin } from 'obsidian';
import { t } from '../i18n';
import type { PluginContext } from '../PluginContext';
import { AudioUtils } from './AudioUtils';
import type {
    TimerInstance,
    TimerStartConfig
} from './TimerInstance';
import { isDailyTimer } from './TimerInstance';
import { TimerRecorder } from './TimerRecorder';
import { TaskIdGenerator } from '../services/display/TaskIdGenerator';
import { TimerStorageUtils } from './TimerStorageUtils';
import { decideTimerStartMode, type TimerStartChoice } from './TimerStartMode';
import type { Task } from '../types';
import { TimerStartChoiceModal } from '../modals/TimerStartChoiceModal';
import { TimerCreator } from './TimerCreator';
import { TimerLifecycle } from './TimerLifecycle';
import { TimerRenderer } from './TimerRenderer';
import { TimerContentBinding } from './TimerContentBinding';
import { TimerPersistence } from './TimerPersistence';
import { TimerTargetManager } from './TimerTargetManager';
import { TimerWidgetWindowObserver, type PinState } from './TimerWidgetWindowObserver';
import { autoGrowTextarea } from '../utils/TextareaAutoGrow';
import {
    type TimerContext,
    IDLE_TIMER_ID,
} from './TimerContext';
import { logInfo } from '../log/log';

/**
 * Hands out the running timer widget. Declared beside the widget for the same
 * reason `ApiHost` lives beside `TaskApi`: naming it in `PluginContext` would
 * relocate the import cycle rather than close it.
 */
export interface TimerHost {
    getTimerWidget(): TimerWidget;
}

export class TimerWidget implements TimerContext {
    readonly app: App;
    readonly plugin: PluginContext & Plugin;
    readonly timers: Map<string, TimerInstance> = new Map();
    readonly recorder: TimerRecorder;
    private storageUtils: TimerStorageUtils;
    private creator: TimerCreator;
    private lifecycle: TimerLifecycle;
    private renderer: TimerRenderer;
    private contentBinding: TimerContentBinding;
    private persistence: TimerPersistence;
    private targetManager: TimerTargetManager;
    private observer: TimerWidgetWindowObserver | null = null;

    constructor(app: App, plugin: PluginContext & Plugin) {
        this.app = app;
        this.plugin = plugin;
        this.storageUtils = new TimerStorageUtils(app);
        this.recorder = new TimerRecorder(app, plugin, this.storageUtils);
        this.creator = new TimerCreator(this, this.storageUtils);
        this.lifecycle = new TimerLifecycle(this, this.creator);
        // 値を書き換えた直後にオートグローを掛け直す（input 時 / syncFromFile 時）。
        // bind 直後（初期値セット時）の一回は TimerRenderer 側が自分で呼ぶ。
        this.contentBinding = new TimerContentBinding(this, autoGrowTextarea);
        this.renderer = new TimerRenderer(this, this.lifecycle, this.creator, this.contentBinding);
        this.persistence = new TimerPersistence(this, this.creator, this.lifecycle, this.storageUtils);
        this.targetManager = new TimerTargetManager(this, this.storageUtils);
    }

    /**
     * Wire up window observation and restore persisted timers. Must be called
     * after `workspace.onLayoutReady` so the observer can resolve which window
     * currently holds the active leaf.
     */
    activate(): void {
        logInfo('[Timer:activate]');
        if (this.observer) return;
        this.observer = new TimerWidgetWindowObserver(this.app, this.plugin, this);
        this.observer.start();
        this.persistence.restoreTimersFromStorage((timerId) => {
            if (!this.lifecycle.isIdleTimer(timerId)) {
                const timer = this.timers.get(timerId);
                // 対象行に id が要るのは self だけ（開始経路と同じ条件）。child /
                // sibling は自分が書いたレコード行が尻尾 id を持つので、復元を
                // きっかけにユーザーのタスク行へ id を足すのは筋が違う。
                if (timer
                    && timer.recordMode === 'self'
                    && !timer.timerTargetId
                    && !isDailyTimer(timer)) {
                    void this.targetManager.ensureTimerTargetId(timerId);
                }
            }
        });
    }

    // ─── TimerContext: container delegation to observer ───────

    ensureContainer(): HTMLElement {
        if (!this.observer) {
            // Defensive: fall back to immediate observer creation. activate()
            // should have run already; this only happens if a timer is
            // started before layout-ready, which is uncommon.
            this.observer = new TimerWidgetWindowObserver(this.app, this.plugin, this);
            this.observer.start();
        }
        return this.observer.ensureContainer();
    }

    destroyContainer(): void {
        this.observer?.destroyContainer();
    }

    getPinState(): PinState {
        return this.observer?.getPinState() ?? 'pinned';
    }

    togglePin(): void {
        this.observer?.togglePin();
    }

    shouldShowPinBadge(): boolean {
        return this.observer?.shouldShowPinBadge() ?? false;
    }

    /**
     * Unified timer start API for all timer types.
     *
     * 完了済み（`[x]`）のタスクへの開始だけはここで一旦止めてユーザーに訊く
     * （{@link decideTimerStartMode}）。全ての開始経路がこのメソッドを通るので、
     * 分岐はここ 1 箇所で足りる。未完了タスクへの開始は従来どおり即時 — 主経路に
     * 摩擦を足さない。
     */
    startTimer(config: TimerStartConfig): void {
        const taskId = config.timerType === 'idle' ? IDLE_TIMER_ID : config.taskId;
        const timerTargetId = config.timerTargetId;
        if (config.timerType !== 'idle' && this.lifecycle.hasActiveTimerForTask(taskId, timerTargetId)) {
            new Notice(t('timer.alreadyActive'));
            return;
        }

        // 対象タスクは 1 度だけ引く。読み取り専用の判定も `[x]` の判定も同じ行を見る。
        const target = this.resolveStartTarget(config);

        // 読み取り専用の記法（day-planner / tasks-plugin）にタイマーを掛けても、
        // 開始時の書き込みも停止時の記録も落ちる。計測そのものは動いてしまうので、
        // ユーザーは終わるまで何も残らないことに気づけない。開始経路は提案・カード
        // メニュー・各ビューに散っているので、全経路が通るここで 1 度だけ止める。
        if (target?.isReadOnly) {
            new Notice(t('notice.timerTargetReadOnly'));
            return;
        }

        if (config.timerType !== 'idle') {
            this.lifecycle.stopIdleTimer();
        } else if (this.timers.has(IDLE_TIMER_ID)) {
            return;
        }

        if (this.shouldAskAboutCompletedTask(config, target)) {
            this.askStartChoice(config);
            return;
        }

        this.startTimerNow(config);
    }

    /**
     * 開始前に見る対象タスク。idle と daily と taskId 無しは引く先が無い。
     */
    private resolveStartTarget(config: TimerStartConfig): Task | undefined {
        if (config.timerType === 'idle') return undefined;
        if (!config.taskId || isDailyTimer(config)) return undefined;
        return this.plugin.getTaskReadService().getTask(config.taskId);
    }

    /**
     * `[x]` のタスクに開始しようとしているか。判定は `statusChar` のみで、
     * self 系（対象行を書き換えるモード）に限る — child 起点は器に足すだけなので
     * 完了済みでも失うものが無い。
     */
    private shouldAskAboutCompletedTask(config: TimerStartConfig, target: Task | undefined): boolean {
        if (!target) return false;
        if (config.recordMode !== 'self') return false;

        return decideTimerStartMode(target.statusChar) === 'ask';
    }

    private askStartChoice(config: TimerStartConfig): void {
        new TimerStartChoiceModal(this.app, config.taskName, (choice: TimerStartChoice) => {
            if (choice === 'cancel') {
                // 走行中が居ないまま idle を止めた状態で戻らないよう起こし直す。
                this.lifecycle.startIdleTimerIfNothingRunning();
                return;
            }
            this.startTimerNow({
                ...config,
                recordMode: choice === 'continue' ? 'sibling' : 'self',
            });
        }).open();
    }

    /**
     * 1 本目のセッションを書いてタイマーを走らせる。書き方は `recordMode` が持つ
     * （self = 対象行を消費 / child = 子に挿す / sibling = 完了済みの続きとして隣に
     * 挿す）。2 本目以降は再開時に recorder が尻尾の兄弟へ並べる。
     */
    private startTimerNow(config: TimerStartConfig): void {
        const timer = this.creator.createTimer(config);
        this.timers.set(timer.id, timer);

        if (timer.isRunning) {
            this.lifecycle.startTimerTicker(timer.id);
            if (timer.timerType !== 'idle') {
                AudioUtils.playStartSound();
            }
        }

        // Write start time immediately so the task moves on Timeline
        if (config.timerType !== 'idle') {
            if (timer.recordMode === 'self') {
                void this.recorder.updateTaskStartTime(timer);
            } else {
                void this.writeFirstSession(timer);
            }
        }

        this.render();
        this.persistTimersToStorage();
        // self だけが対象タスク行に id を要る（記録でその行を書き換えるため）。
        // child / sibling は自分が書いたレコード行が尻尾 id を持つので、対象行に
        // 目印を足さない（ノートに残る自動 id を増やさない）。
        if (!this.lifecycle.isIdleTimer(timer.id)
            && !isDailyTimer(timer)
            && timer.recordMode === 'self') {
            void this.targetManager.ensureTimerTargetId(timer.id);
        }
    }

    private async writeFirstSession(timer: TimerInstance): Promise<void> {
        const sessionTaskId = timer.recordMode === 'sibling'
            ? await this.recorder.startContinuationSession(timer)
            : await this.recorder.createChildAtStart(timer);
        if (sessionTaskId) {
            this.persistTimersToStorage();
        }
        // 書き込みの往復中に打たれた入力は行き先が無く下書きに溜まっている。
        // 行が生えた今なら書ける。
        await this.flushTimerContent(timer.id);
    }

    async flushTimerContent(timerId: string): Promise<void> {
        const timer = this.timers.get(timerId);
        if (!timer) return;
        await this.contentBinding.flush(timer);
    }

    discardTimerContent(timerId: string): void {
        const timer = this.timers.get(timerId);
        if (!timer) return;
        this.contentBinding.discard(timer);
    }

    /**
     * 閉じたタイマーの後始末。ノートに残る自動 id は 0 個にする — 尻尾の `^id` を
     * 外してから、対象行に付けた id を片付ける（self では同じ行を指すことがあるが、
     * どちらも「自動生成のときだけ・冪等」なので二重に走っても無害）。
     */
    onTimerClosed(timer: TimerInstance): void {
        void (async () => {
            // 尻尾の `^id` を外す前に書き切る。先に外すと書き先を引けなくなる。
            await this.contentBinding.flush(timer);
            this.contentBinding.release(timer.id);
            await this.recorder.clearTailRecordId(timer);
            await this.targetManager.cleanupGeneratedTargetId(timer);
        })();
    }

    render(): void {
        this.renderer.render();
    }

    renderTimerItem(timerId: string): void {
        this.renderer.renderTimerItem(timerId);
    }

    handleFileRename(oldPath: string, newPath: string): void {
        let changed = false;

        for (const timer of this.timers.values()) {
            if (timer.taskFile === oldPath) {
                timer.taskFile = newPath;
                changed = true;
            }

            const renamedTaskId = TaskIdGenerator.renameFile(timer.taskId, oldPath, newPath);
            if (renamedTaskId !== timer.taskId) {
                timer.taskId = renamedTaskId;
                changed = true;
            }
        }

        if (changed) {
            this.persistTimersToStorage();
        }
    }

    persistTimersToStorage(): void {
        this.persistence.persistTimersToStorage();
    }

    destroy(): void {
        for (const [timerId] of this.timers) {
            this.lifecycle.stopTimerTick(timerId);
        }
        this.lifecycle.clearPrepareState();
        this.timers.clear();
        this.renderer.destroy();
    }
}
