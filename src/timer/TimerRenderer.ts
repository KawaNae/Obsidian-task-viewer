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
import type {
    CountdownTimer,
    CountupTimer,
    IdleTimer,
    IntervalTimer,
    TimerInstance,
} from './TimerInstance';
import { isDailyTimer } from './TimerInstance';
import type { TimerContext } from './TimerContext';
import type { TimerCreator } from './TimerCreator';
import type { TimerLifecycle } from './TimerLifecycle';
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
import type { TimerContentBinding } from './TimerContentBinding';
import { autoGrowTextarea } from '../utils/TextareaAutoGrow';

export class TimerRenderer {
    private closeConfirmTimers = new Map<string, number>();
    private suggester: NextTaskSuggester;
    /** {@link growTitleInputs} の次フレーム再適用ぶんの未発火 rAF。destroy で取り消す。 */
    private titleGrowFrame: { win: Window; id: number } | null = null;

    constructor(
        private ctx: TimerContext,
        private lifecycle: TimerLifecycle,
        private creator: TimerCreator,
        private contentBinding: TimerContentBinding,
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
        for (const [timerId] of this.ctx.timers) {
            this.renderTimerItem(timerId);
        }
        // 全 item が出揃った後（loop の外）でオートグロー — item 構築中に掛けると
        // 兄弟がまだ無い未沈静化のレイアウトで scrollHeight を測ってしまう。
        this.growTitleInputs(container);
    }

    renderTimerItem(timerId: string): void {
        const container = this.ctx.ensureContainer();

        const timer = this.ctx.timers.get(timerId);
        if (!timer) return;

        // DOM key is the timer id, not the task id: a file rename rewrites
        // `timer.taskId` and would otherwise strand this node.
        let itemEl = container.querySelector(`[data-timer-id="${timerId}"]`) as HTMLElement;
        const isNewItem = !itemEl;

        if (isNewItem) {
            itemEl = container.createDiv('timer-widget__item');
            itemEl.dataset.timerId = timerId;
            if (timer.taskColor) {
                TaskStyling.applyTaskColor(itemEl, timer.taskColor);
            }
        }
        const isIdle = this.lifecycle.isIdleTimer(timerId);
        itemEl.toggleClass('timer-widget__item--idle', isIdle);
        itemEl.toggleClass('timer-widget__item--suspended', timer.runState === 'suspended');

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

            if (timer.timerType !== 'idle') {
                // 走っている行（尻尾）の content をその場で編集する。self も含めて
                // 同じ扱いで、self の編集は対象タスク行そのものの改名になる。
                // textarea: 記法は 1 行のままだが、長い名前は表示だけ複数行に
                // 折り返す（オートグローで高さを追従、Enter は改行させず確定）。
                const labelInput = titleContainer.createEl('textarea', {
                    cls: 'timer-widget__title-input',
                    // 名前の無い行（tv-content 未設定の tvFile など）でも、何を
                    // 計っているのかは見えている必要がある。
                    placeholder: timer.taskName || '\u2014',
                    attr: { rows: '1', wrap: 'soft' },
                });
                // textarea に value 属性は無いので明示代入。オートグローは
                // ここではまだ掛けない — 兄弟がまだ出揃っていない（render 全体
                // の組み立て完了後に growTitleInputs でまとめて掛ける）。
                labelInput.value = this.contentBinding.displayValue(timer);
                this.bindTitleInputConfirmKey(labelInput);
                this.contentBinding.bind(timer, labelInput);
            } else {
                // Idle: 対象が無いので編集する行も無い
                const nameSpan = titleContainer.createSpan('timer-widget__title-name');
                nameSpan.setText(timer.taskName);
            }

            const fileName = getDisplayFileName(timer.taskName, timer.taskFile);
            if (fileName) {
                const fileSpan = titleContainer.createSpan('timer-widget__title-file');
                fileSpan.setText(fileName);
            }

            if (timer.runState === 'suspended') {
                header.createSpan({ cls: 'timer-widget__state-badge', text: t('timer.suspended') });
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
                    this.showSettingsMenu(e, timerId);
                };
            }

            // Toggle button
            const toggleBtn = header.createEl('button', { cls: 'timer-widget__toggle-btn' });
            setIcon(toggleBtn, timer.isExpanded ? 'chevron-down' : 'chevron-right');
            toggleBtn.onclick = () => {
                timer.isExpanded = !timer.isExpanded;
                this.renderTimerItem(timerId);
                // 単独呼び出し（render() の loop 経由ではない）なので、この item の
                // 組み立て完了後という意味で自分でオートグローを掛け直す。
                this.growTitleInputs(this.ctx.ensureContainer());
                this.ctx.persistTimersToStorage();
            };

            // Close button
            const closeBtn = header.createEl('button', { cls: 'timer-widget__close-btn' });
            setIcon(closeBtn, 'x');
            closeBtn.onclick = () => {
                // 中断中は記録済み＝失うものが無いので確認なしで閉じる。
                // 走行中は 2-tap 確認（走行分は記録せず捨てる）。
                if (timer.runState === 'suspended' || !timer.isRunning) {
                    this.clearCloseConfirmTimer(timerId);
                    this.lifecycle.closeTimer(timerId);
                    return;
                }
                // Idle timers close without confirmation, but ignore accidental clicks
                // right after the idle timer spawns (e.g. double-clicking a previous close)
                if (timer.phase === 'idle') {
                    if (Date.now() - timer.startTimeMs < 500) return;
                    this.clearCloseConfirmTimer(timerId);
                    this.lifecycle.closeTimer(timerId);
                    return;
                }

                // Already in confirming state → execute close.
                // 走行中の破棄なので、開始時に書いた走行中の行も引き取らせる。
                if (closeBtn.classList.contains('timer-widget__close-btn--confirming')) {
                    this.clearCloseConfirmTimer(timerId);
                    void this.lifecycle.discardTimer(timer);
                    return;
                }

                // Enter confirming state
                closeBtn.classList.add('timer-widget__close-btn--confirming');
                this.closeConfirmTimers.set(timerId, window.setTimeout(() => {
                    closeBtn.classList.remove('timer-widget__close-btn--confirming');
                    closeBtn.classList.add('timer-widget__close-btn--fading');
                    this.closeConfirmTimers.delete(timerId);
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
        if (this.titleGrowFrame) {
            this.titleGrowFrame.win.cancelAnimationFrame(this.titleGrowFrame.id);
            this.titleGrowFrame = null;
        }
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

    /**
     * Enter で改行せず確定させる。IME 確定の Enter は isComposing 判定が
     * ブラウザ間で揺れるので、compositionstart/end の自前フラグも併用する
     * （`bracketPairing.ts` と同じイディオム）。改行はスペースに畳んで記録
     * するので textarea に残っても実害は無いが、Enter 経由では最初から
     * 入れさせない。
     */
    private bindTitleInputConfirmKey(el: HTMLTextAreaElement): void {
        let composing = false;
        el.addEventListener('compositionstart', () => { composing = true; });
        el.addEventListener('compositionend', () => { composing = false; });
        el.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.isComposing && !composing) {
                e.preventDefault();
                el.blur();
            }
        });
    }

    /**
     * container 内の全 title textarea にオートグローを掛け直す。**呼び出し側
     * は DOM の組み立てが完全に終わってから呼ぶこと** — item 構築の途中（兄弟
     * がまだ append されていない）で呼ぶと、沈静化前のレイアウトで測った小さい
     * scrollHeight が inline style に焼き付く（実測: 200 字で render 前 152px
     * → render 後 114px。scrollHeight 自体は 152 のまま — ヘルパは正しく、呼ぶ
     * 時点が早すぎるのが原因）。
     *
     * 同期 1 回だけでは足りないケースがあるため、Timeline のスクロール復元と
     * 同じ「sync + 次フレーム再適用」で収束させる。window は popout を考慮し
     * container 自身から解決する（`HostWindow.ts` と同じ理由）。
     */
    private growTitleInputs(container: HTMLElement): void {
        const grow = (): void => {
            container.querySelectorAll('.timer-widget__title-input')
                .forEach((el) => autoGrowTextarea(el as HTMLTextAreaElement));
        };
        grow();

        if (this.titleGrowFrame) {
            this.titleGrowFrame.win.cancelAnimationFrame(this.titleGrowFrame.id);
            this.titleGrowFrame = null;
        }
        const win = container.ownerDocument.defaultView ?? window;
        const id = win.requestAnimationFrame(() => {
            this.titleGrowFrame = null;
            grow();
        });
        this.titleGrowFrame = { win, id };
    }

    private clearCloseConfirmTimer(timerId: string): void {
        const id = this.closeConfirmTimers.get(timerId);
        if (id !== undefined) {
            clearTimeout(id);
            this.closeConfirmTimers.delete(timerId);
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
        if (this.lifecycle.isIdleTimer(timer.id)) return;

        // 入力欄は md 側の変化に追随する（打鍵中と未書き込みの入力があるときは
        // binding が見送る）。デイリーノート起点でも尻尾があれば同じ扱い。
        const inputEl = itemEl.querySelector('.timer-widget__title-input') as HTMLTextAreaElement | null;
        if (inputEl) this.contentBinding.syncFromFile(timer, inputEl);

        // デイリーノート起点は対象タスクを持たない（id は `daily-<date>`）。
        if (isDailyTimer(timer)) return;

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
            case 'countdown':
                this.renderSessionControls(container, timer);
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

    /**
     * countup / countdown の controls。セッション状態機械の 4 出口のうち 3 つを
     * 出す（✕ はヘッダ）。
     *
     *   未開始   … [▶ 開始]（まだセッションが 1 つも無い状態。出口ではない）
     *   走行中   … [⏸ 中断][■ 終了]
     *   中断中   … [▶ 再開][■ 終了]
     *
     * interval は現行の Pause(prepare)/Stop を維持するので、ここには来ない。
     */
    private renderSessionControls(container: HTMLElement, timer: CountupTimer | CountdownTimer): void {
        const neverStarted = !timer.isRunning
            && timer.runState === 'running'
            && timer.sessionCount === 0
            && timer.elapsedTime === 0;

        if (neverStarted) {
            this.addControlButton(container, 'primary', 'play', t('timer.start'), () => {
                timer.phase = 'work';
                timer.startTimeMs = Date.now();
                timer.pausedElapsedTime = 0;
                timer.elapsedTime = 0;
                if (timer.timerType === 'countdown') {
                    timer.timeRemaining = timer.totalTime;
                }
                timer.isRunning = true;
                this.lifecycle.startTimerTicker(timer.id);
                AudioUtils.playStartSound();
                this.render();
                this.ctx.persistTimersToStorage();
            });
            return;
        }

        if (timer.runState === 'suspended') {
            this.addControlButton(container, 'primary', 'play', t('timer.resume'), () => {
                this.lifecycle.resumeSession(timer);
            });
        } else {
            this.addControlButton(container, 'secondary', 'pause', t('timer.suspend'), () => {
                AudioUtils.playPauseSound();
                void this.lifecycle.suspendTimer(timer);
            });
        }

        // ■ 終了は「記録して閉じる」。タスクの完了はユーザーが checkbox で宣言する
        // ものなので、ここでは状態を触らない（だから ✓ ではなく ■）。
        this.addControlButton(container, 'primary', 'square', t('timer.finish'), () => {
            AudioUtils.playFinishSound();
            void this.lifecycle.finishTimer(timer);
        });
    }

    /**
     * controls のボタン 1 個。アイコンは **span ラッパー経由** で入れる —
     * WebKit は inline-flex ボタン直下の SVG を描画しない（既知の iPad 制約）。
     */
    private addControlButton(
        container: HTMLElement,
        variant: 'primary' | 'secondary',
        icon: string,
        label: string,
        onClick: () => void,
    ): HTMLButtonElement {
        const btn = container.createEl('button', {
            cls: `timer-widget__btn timer-widget__btn--${variant}`,
        });
        setIcon(btn.createSpan({ cls: 'timer-widget__btn-icon' }), icon);
        btn.createSpan({ text: label });
        btn.onclick = onClick;
        return btn;
    }

    private renderIntervalControls(container: HTMLElement, timer: IntervalTimer): void {
        if (timer.phase === 'idle') {
            const startBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--primary'
            });
            setIcon(startBtn, 'play');
            startBtn.createSpan({ text: ` ${t('timer.start')}` });
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
            resumeBtn.createSpan({ text: ` ${t('timer.resume')}` });
            resumeBtn.onclick = () => {
                this.lifecycle.resumeTimer(timer);
            };

            const stopBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--secondary'
            });
            setIcon(stopBtn, 'square');
            stopBtn.createSpan({ text: ` ${t('timer.stop')}` });
            stopBtn.onclick = () => {
                void this.lifecycle.stopIntervalTimer(timer);
            };
            return;
        }

        if (timer.isRunning) {
            const pauseBtn = container.createEl('button', {
                cls: 'timer-widget__btn timer-widget__btn--secondary'
            });
            setIcon(pauseBtn, 'pause');
            pauseBtn.createSpan({ text: ` ${t('timer.pause')}` });
            pauseBtn.onclick = () => {
                this.lifecycle.pauseIntervalToPrepare(timer);
                AudioUtils.playPauseSound();
                this.render();
                this.ctx.persistTimersToStorage();
            };
            return;
        }

        // 区間中（work / break）で走っていない状態。UI 操作では作れない
        // （一時停止は必ず prepare に入る）が、停止の記録待ちのまま Obsidian が
        // 落ちると localStorage にこの形が残り、復元でここに来る。操作列が無いと
        // 記録も終了もできなくなるので、prepare と同じ 2 つを出す。
        const resumeBtn = container.createEl('button', {
            cls: 'timer-widget__btn timer-widget__btn--primary'
        });
        setIcon(resumeBtn, 'play');
        resumeBtn.createSpan({ text: ` ${t('timer.resume')}` });
        resumeBtn.onclick = () => {
            this.lifecycle.resumeTimer(timer);
        };

        const stopBtn = container.createEl('button', {
            cls: 'timer-widget__btn timer-widget__btn--secondary'
        });
        setIcon(stopBtn, 'square');
        stopBtn.createSpan({ text: ` ${t('timer.stop')}` });
        stopBtn.onclick = () => {
            void this.lifecycle.stopIntervalTimer(timer);
        };
    }


    private formatSignedTime(seconds: number): string {
        return TimeFormatter.formatSignedSeconds(seconds);
    }

    private getTimerDisplayText(timer: TimerInstance): string {
        if (timer.runState === 'suspended') {
            return TimeFormatter.formatSeconds(timer.recordedElapsedTime);
        }
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

    private showSettingsMenu(e: MouseEvent, timerId: string): void {
        const timer = this.ctx.timers.get(timerId);
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
