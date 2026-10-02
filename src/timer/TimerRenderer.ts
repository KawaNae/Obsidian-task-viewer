/**
 * Timer DOM rendering: pin badge, item headers, controls, progress ring, and
 * the next-task suggestion (idle) after the timers.
 *
 * The actual container element + drag handling + viewport clamp + window
 * migration live in FloatingOverlayHost / TimerWidgetWindowObserver, which
 * the renderer reaches through `deps.container` (ensureContainer /
 * destroyContainer). This separation lets the same item DOM be rebuilt in any
 * window without the renderer caring which document it lives in.
 *
 * 描くのは `TimerBoard` の表と提案だけで、状態は変えない。操作は
 * `TimerLifecycle` に、表示の写しと開閉は `TimerBoard.dispatch` に渡す（保存と
 * 組み直しは dispatch が予約する）。
 */

import { type App, setIcon } from 'obsidian';
import type { DisplayTask } from '../types';
import type { PluginContext } from '../PluginContext';
import type { IntervalGroup } from './IntervalMath';
import { createControlButton } from './TimerControlButton';
import type { TimerLifecycle } from './TimerLifecycle';
import type { TimerBoard, IdleBoard } from './TimerBoard';
import type { TimerRuntime } from './TimerRuntime';
import { finished, type TimerState } from './TimerState';
import { readSeconds } from './TimerClock';
import { progressOf, type Measure } from './TimerProgress';
import { getDisplayFileName, getTaskDisplayName } from '../services/display/TaskContent';
import { TaskStyling } from '../views/sharedUI/TaskStyling';
import { TimerProgressUI, type RingOptions, type RingState } from './TimerProgressUI';
import { TimerSettingsMenu } from './TimerSettingsMenu';
import { OFFSET_PRESET_MINUTES, canOffsetStart, rememberedStart, startLabel } from './TimerStartOffset';
import { TimerStartOffsetModal } from '../modals/TimerStartOffsetModal';
import { TimeFormatter } from '../utils/TimeFormatter';
import { t } from '../i18n';
import { getEffectiveColor } from '../services/data/EffectiveProperties';
import { NextTaskSuggester, suggestionKey } from './NextTaskSuggester';
import type { TimerContentBinding } from './TimerContentBinding';
import { autoGrowTextarea } from '../utils/TextareaAutoGrow';

/** 提案が出た直後の ✕ と ▶ を捨てる間（直前のタイマーの ✕ の2度押しの誤打）。 */
const IDLE_GUARD_MS = 500;
/** ✕ の確認を見せる間と、確認が下りるときのフェード。 */
const CLOSE_CONFIRM_MS = 2000;
const CLOSE_FADE_MS = 500;

export interface RendererDeps {
    app: App;
    plugin: PluginContext;
    board: TimerBoard;
    runtime: TimerRuntime;
    lifecycle: TimerLifecycle;
    contentBinding: TimerContentBinding;
    container: {
        ensureContainer(): HTMLElement;
        destroyContainer(): void;
        getPinState(): 'pinned' | 'pending';
        togglePin(): void;
        shouldShowPinBadge(): boolean;
    };
    /** 提案の ▶: そのタスクを始める（`TimerWidget.startTimer`）。 */
    startTimer(task: DisplayTask): void;
}

export class TimerRenderer {
    private suggester: NextTaskSuggester;
    /** {@link growTitleInputs} の次フレーム再適用ぶんの未発火 rAF。destroy で取り消す。 */
    private titleGrowFrame: { win: Window; id: number } | null = null;

    constructor(private deps: RendererDeps) {
        this.suggester = new NextTaskSuggester(deps.plugin);
    }

    // ─── Render ──────────────────────────────────────────────

    /** 組み直す: タイマーの項目を表の順に、提案があればその後に。 */
    render(): void {
        const { board, container: host } = this.deps;
        const timers = board.values();
        const idle = board.idle;
        if (timers.length === 0 && !idle) {
            host.destroyContainer();
            return;
        }
        const container = host.ensureContainer();
        container.empty();
        this.renderPinBadge(container);
        const now = Date.now();
        for (const timer of timers) this.renderTimerItem(container, timer, now);
        if (idle) {
            const itemEl = container.createDiv('timer-widget__item timer-widget__item--idle');
            itemEl.dataset.idle = 'true';
            this.fillIdleItem(itemEl, idle, now);
        }
        // 全 item が出揃った後（loop の外）でオートグロー — item 構築中に掛けると
        // 兄弟がまだ無い未沈静化のレイアウトで scrollHeight を測ってしまう。
        this.growTitleInputs(container);
    }

    /**
     * tick の描き直し: 各タイマーの時間の表示と輪、提案の経過を進める。名前は索引の
     * 変化で合わせる（{@link refreshFromIndex}）。提案が替われば提案の項目だけを組み直す。
     */
    renderTimes(): void {
        const { board, container: host } = this.deps;
        const timers = board.values();
        const idle = board.idle;
        if (timers.length === 0 && !idle) return;
        const container = host.ensureContainer();
        const now = Date.now();
        for (const timer of timers) {
            const itemEl = this.itemOf(container, timer.id);
            if (itemEl) this.updateTimes(itemEl, timer, now);
        }
        if (!idle) return;
        const idleEl = container.querySelector(':scope > [data-idle="true"]') as HTMLElement | null;
        if (!idleEl) return;
        if (idleEl.dataset.nextTaskKey !== suggestionKey(this.suggester.getSuggestion())) {
            this.fillIdleItem(idleEl, idle, now);
            return;
        }
        TimerProgressUI.update(idleEl, idleRing(idle, now), this.ringOptions());
    }

    /**
     * 索引が変わったときに、各 widget の名前欄、名前と色、ファイル名を索引の
     * 読みから合わせ直す（{@link syncFromIndex}）。tick は時間の表示しか進めない
     * ので、読みの変化はここから届く — 復元の描画は最初のスキャンの前に走り、
     * そのときの名前欄は空になる。
     */
    refreshFromIndex(): void {
        const timers = this.deps.board.values();
        if (timers.length === 0) return;
        const container = this.deps.container.ensureContainer();
        for (const timer of timers) {
            const itemEl = this.itemOf(container, timer.id);
            if (itemEl) this.syncFromIndex(itemEl, timer);
        }
    }

    // ─── Destroy ─────────────────────────────────────────────

    destroy(): void {
        if (this.titleGrowFrame) {
            this.titleGrowFrame.win.cancelAnimationFrame(this.titleGrowFrame.id);
            this.titleGrowFrame = null;
        }
        this.deps.container.destroyContainer();
    }

    // ─── タイマーの項目 ──────────────────────────────────────

    /** DOM の鍵はタイマーの id（タイマーの一生のあいだ変わらない）。 */
    private itemOf(container: HTMLElement, timerId: string): HTMLElement | null {
        return container.querySelector(`:scope > [data-timer-id="${timerId}"]`) as HTMLElement | null;
    }

    private renderTimerItem(container: HTMLElement, timer: TimerState, now: number): void {
        const itemEl = container.createDiv('timer-widget__item');
        itemEl.dataset.timerId = timer.id;
        if (timer.color) TaskStyling.applyTaskColor(itemEl, timer.color);
        itemEl.toggleClass('timer-widget__item--suspended', timer.session.kind === 'suspended');

        const ring = timerRing(timer, now);

        // Header
        const header = itemEl.createDiv('timer-widget__header');
        const titleContainer = header.createDiv('timer-widget__title');

        // 走っている行（尻尾）の content をその場で編集する。self も含めて
        // 同じ扱いで、self の編集は対象タスク行そのものの改名になる。
        // textarea: 記法は 1 行のままだが、長い名前は表示だけ複数行に
        // 折り返す（オートグローで高さを追従、Enter は改行させず確定）。
        const labelInput = titleContainer.createEl('textarea', {
            cls: 'timer-widget__title-input',
            // 名前の無い行（空の `- [ ]` など）でも、何を
            // 計っているのかは見えている必要がある。
            placeholder: timer.name || '—',
            attr: { rows: '1', wrap: 'soft' },
        });
        // textarea に value 属性は無いので明示代入。オートグローは
        // ここではまだ掛けない — 兄弟がまだ出揃っていない（render 全体
        // の組み立て完了後に growTitleInputs でまとめて掛ける）。
        labelInput.value = this.deps.contentBinding.displayValue(timer);
        this.bindTitleInputConfirmKey(labelInput);
        this.deps.contentBinding.bind(timer, labelInput);

        this.syncFileName(titleContainer, timer);

        if (timer.session.kind === 'pending') {
            header.createSpan({ cls: 'timer-widget__state-badge', text: t('timer.unrecorded') });
        } else if (timer.session.kind === 'suspended') {
            header.createSpan({ cls: 'timer-widget__state-badge', text: t('timer.suspended') });
        }

        if (!timer.expanded) {
            const timeSpan = header.createSpan('timer-widget__header-time');
            timeSpan.dataset.timeDisplay = 'header';
            timeSpan.setText(headerTimeText(timer.measure, ring));
            timeSpan.toggleClass('timer-widget__header-time--break', ring.tone === 'break');

            if (ring.repeatText) {
                const repeatSpan = header.createSpan('timer-widget__header-repeat');
                repeatSpan.dataset.repeatDisplay = 'header';
                repeatSpan.setText(ring.repeatText);
            }
        }

        // ウィジェットの interval はポモドーロだけ。
        if (timer.measure.type === 'interval') {
            const settingsBtn = header.createEl('button', { cls: 'tv-icon-btn timer-widget__settings-btn' });
            setIcon(settingsBtn, 'settings');
            settingsBtn.onclick = (e) => {
                e.stopPropagation();
                this.showSettingsMenu(e, timer);
            };
        }

        const toggleBtn = header.createEl('button', { cls: 'tv-icon-btn timer-widget__toggle-btn' });
        setIcon(toggleBtn, timer.expanded ? 'chevron-down' : 'chevron-right');
        toggleBtn.onclick = () => this.deps.board.dispatch(timer, { type: 'toggled' });

        const closeBtn = header.createEl('button', { cls: 'tv-icon-btn timer-widget__close-btn' });
        setIcon(closeBtn, 'x');
        closeBtn.toggleClass('timer-widget__close-btn--confirming', this.deps.runtime.closeConfirm.has(timer.id));
        closeBtn.onclick = () => this.onClose(timer);

        if (timer.expanded) {
            const content = itemEl.createDiv('timer-widget__content');
            const progressContainer = content.createDiv('timer-widget__progress-container');
            TimerProgressUI.render(progressContainer, ring, this.ringOptions());
            this.bindStartOffset(progressContainer, timer);

            const controls = content.createDiv('timer-widget__controls');
            this.renderControls(controls, timer);
        }
    }

    /**
     * ✕。確認を要るかは lifecycle が答え（{@link TimerLifecycle.close}）、ここは
     * 確認の見た目だけを持つ。確認の予定は `TimerRuntime.closeConfirm` に置き、
     * 組み直しをまたいでも確認の2打目が通る。
     */
    private onClose(timer: TimerState): void {
        const { lifecycle, runtime } = this.deps;
        const verdict = lifecycle.close(timer, runtime.closeConfirm.has(timer.id));
        if (verdict === 'closing') {
            this.clearCloseConfirm(timer.id);
            return;
        }
        this.closeButtonOf(timer.id)?.addClass('timer-widget__close-btn--confirming');
        runtime.closeConfirm.set(timer.id, window.setTimeout(() => {
            runtime.closeConfirm.delete(timer.id);
            const closeBtn = this.closeButtonOf(timer.id);
            if (!closeBtn) return;
            closeBtn.removeClass('timer-widget__close-btn--confirming');
            closeBtn.addClass('timer-widget__close-btn--fading');
            window.setTimeout(() => closeBtn.removeClass('timer-widget__close-btn--fading'), CLOSE_FADE_MS);
        }, CLOSE_CONFIRM_MS));
    }

    /** 今の DOM の ✕ ボタン（確認の間に組み直されていれば、新しい方）。 */
    private closeButtonOf(timerId: string): HTMLElement | null {
        const container = this.deps.container.ensureContainer();
        return this.itemOf(container, timerId)?.querySelector('.timer-widget__close-btn') as HTMLElement | null ?? null;
    }

    private clearCloseConfirm(timerId: string): void {
        const id = this.deps.runtime.closeConfirm.get(timerId);
        if (id === undefined) return;
        window.clearTimeout(id);
        this.deps.runtime.closeConfirm.delete(timerId);
    }

    /**
     * 操作。種類を問わず同じ状態機械に乗る（✕ はヘッダ）。
     *
     *   走行中   … [⏸ 中断][■ 終了]
     *   記録待ち … [⏸ 中断][■ 終了]（固定した記録を書き直す。押した方が行き先。
     *               周を終えたポモドーロは ■ だけ）
     *   中断中   … [▶ 再開][■ 終了]
     *
     * ■ 終了は「記録して閉じる」。タスクの完了はユーザーが checkbox で宣言する
     * ものなので、ここでは状態を触らない（だから ✓ ではなく ■）。音は lifecycle が鳴らす。
     */
    private renderControls(container: HTMLElement, timer: TimerState): void {
        const { lifecycle } = this.deps;
        if (timer.session.kind === 'suspended') {
            this.addWidgetButton(container, 'play', t('timer.resume'), () => void lifecycle.resume(timer));
        } else if (!finished(timer, Date.now())) {
            this.addWidgetButton(container, 'pause', t('timer.suspend'), () => void lifecycle.stop(timer, 'suspend'));
        }
        this.addWidgetButton(container, 'square', t('timer.finish'), () => void lifecycle.stop(timer, 'close'));
    }

    /** ウィジェットの操作ボタン。ブロック名を固定しただけの薄い包み。 */
    private addWidgetButton(
        container: HTMLElement,
        icon: string,
        label: string,
        onClick: () => void,
    ): HTMLButtonElement {
        return createControlButton(container, { block: 'timer-widget', icon, label, onClick });
    }

    /** tick の描き直し: 時間の表示と輪を進める。 */
    private updateTimes(itemEl: HTMLElement, timer: TimerState, now: number): void {
        const ring = timerRing(timer, now);
        const headerTime = itemEl.querySelector('[data-time-display="header"]') as HTMLElement | null;
        if (headerTime) {
            headerTime.setText(headerTimeText(timer.measure, ring));
            headerTime.toggleClass('timer-widget__header-time--break', ring.tone === 'break');
        }
        const headerRepeat = itemEl.querySelector('[data-repeat-display="header"]') as HTMLElement | null;
        headerRepeat?.setText(ring.repeatText ?? '');
        TimerProgressUI.update(itemEl, ring, this.ringOptions());
        this.syncStartOffset(itemEl, timer);
    }

    private ringOptions(): RingOptions {
        return { block: 'timer-widget', size: 120, format: (seconds) => TimeFormatter.formatSignedSeconds(seconds) };
    }

    // ─── 索引への追随 ────────────────────────────────────────

    /**
     * 索引の読みに widget の見出しを合わせる: 入力欄、名前と色、ファイル名。
     *
     * 名前と色は対象の行（`subject.anchor` の行）から取り直し、変わっていれば
     * 表示の写しを当てる（`synced`）。デイリーノートは対象の行を持たないが、
     * ファイル（デイリーノート）は持つ。
     *
     * ファイル名は名前（名前がファイル名と同じなら出さない）と `timer.file` から
     * 作る。`file` は行を送ったとき（`TimerWidget.follow`）とノートの名前を変えた
     * とき（`handleFileRename`）に書き換わり、どちらのあとにも索引の変化が来るので、
     * ファイル名もここで追随する。
     */
    private syncFromIndex(itemEl: HTMLElement, timer: TimerState): void {
        // 入力欄は索引の読み（尻尾の行）に追随する（打鍵中と未書き込みの入力が
        // あるときは binding が見送る）。デイリーノートでも尻尾があれば同じ扱い。
        const inputEl = itemEl.querySelector('.timer-widget__title-input') as HTMLTextAreaElement | null;
        if (inputEl) this.deps.contentBinding.syncFromFile(timer, inputEl);

        if (timer.subject.kind === 'task') {
            const task = this.deps.plugin.getIndex().getTaskByAnchor(timer.file, timer.subject.anchor);
            if (task) {
                const name = getTaskDisplayName(task);
                const color = getEffectiveColor(task) ?? '';
                if (color !== timer.color && color) TaskStyling.applyTaskColor(itemEl, color);
                if (name !== timer.name || color !== timer.color) {
                    this.deps.board.dispatch(timer, { type: 'synced', name, color });
                }
                if (inputEl) inputEl.placeholder = timer.name || '—';
            }
        }

        const titleEl = itemEl.querySelector('.timer-widget__title') as HTMLElement | null;
        if (titleEl) this.syncFileName(titleEl, timer);
    }

    /**
     * 見出しのファイル名を名前と `timer.file` から合わせる。出さない条件
     * （{@link getDisplayFileName} が null）になれば外し、出す条件になれば足す。
     * 見出しを組むときも同じ手で書く。
     */
    private syncFileName(titleEl: HTMLElement, timer: TimerState): void {
        const fileName = getDisplayFileName(timer.name, timer.file);
        const fileEl = titleEl.querySelector('.timer-widget__title-file') as HTMLElement | null;
        if (!fileName) {
            fileEl?.remove();
            return;
        }
        if (fileEl) {
            if (fileEl.textContent !== fileName) fileEl.setText(fileName);
            return;
        }
        titleEl.createSpan('timer-widget__title-file').setText(fileName);
    }

    // ─── 提案（idle） ────────────────────────────────────────

    /**
     * 提案の項目を組む: 見出し（Idle と ✕）、提案が出てからの経過の輪、次のタスクの
     * 提案と ▶。提案が替われば組み直すので、その鍵を残す。
     */
    private fillIdleItem(itemEl: HTMLElement, idle: IdleBoard, now: number): void {
        const suggestion = this.suggester.getSuggestion();
        itemEl.empty();
        itemEl.dataset.nextTaskKey = suggestionKey(suggestion);

        const header = itemEl.createDiv('timer-widget__header');
        const titleContainer = header.createDiv('timer-widget__title');
        titleContainer.createSpan({ cls: 'timer-widget__title-name', text: t('timer.idle') });
        const closeBtn = header.createEl('button', { cls: 'tv-icon-btn timer-widget__close-btn' });
        setIcon(closeBtn, 'x');
        closeBtn.onclick = () => {
            if (justShown(idle)) return;
            this.deps.board.setIdle(null);
        };

        const content = itemEl.createDiv('timer-widget__content');
        const progressContainer = content.createDiv('timer-widget__progress-container');
        TimerProgressUI.render(progressContainer, idleRing(idle, now), this.ringOptions());

        if (!suggestion) return;
        const { task, kind } = suggestion;
        const controls = content.createDiv('timer-widget__controls');
        const next = controls.createDiv('timer-widget__next');
        const color = getEffectiveColor(task);
        if (color) TaskStyling.applyTaskColor(next, color);

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

        createControlButton(next, {
            block: 'timer-widget',
            icon: 'play',
            label: t('timer.start'),
            extraClass: 'timer-widget__next-start',
            onClick: () => {
                if (justShown(idle)) return;
                this.deps.startTimer(task);
            },
        });
    }

    // ─── 開始をずらす ────────────────────────────────────────

    /**
     * 経過時間の表示を、開始をずらすメニューの入口にする（countup と countdown）。
     * 押せる見た目は走っている区間だけに付け（{@link syncStartOffset}）、押した
     * ときにも確かめる — 表示の要素は状態が変わっても組み直されないことがある。
     */
    private bindStartOffset(container: HTMLElement, timer: TimerState): void {
        if (timer.measure.type !== 'countup' && timer.measure.type !== 'countdown') return;
        const display = container.querySelector('.timer-widget__time-display') as HTMLElement | null;
        if (!display) return;
        display.setAttribute('aria-label', t('timer.offsetStart'));
        display.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showStartOffsetMenu(e, timer);
        });
        this.syncStartOffset(container, timer);
    }

    private syncStartOffset(el: HTMLElement, timer: TimerState): void {
        const display = el.querySelector('.timer-widget__time-display') as HTMLElement | null;
        display?.toggleClass('timer-widget__time-display--offsettable', canOffsetStart(timer));
    }

    /**
     * 開始をずらすメニュー: 「N 分前から」、覚えた時刻（あれば）、「ずらす量を指定…」。
     * 「N 分前」は選んだ時点の今から数える。書き込みと状態の移し方は
     * {@link TimerLifecycle.offsetStart} が持つ。
     */
    private showStartOffsetMenu(e: MouseEvent, timer: TimerState): void {
        const { board, lifecycle, plugin } = this.deps;
        if (!board.has(timer) || !canOffsetStart(timer)) return;
        const offset = (startMs: number): void => void lifecycle.offsetStart(timer, startMs);
        const now = Date.now();
        const remembered = rememberedStart(timer, now, plugin.settings.startHour);

        plugin.menuPresenter.present((menu) => {
            for (const minutes of OFFSET_PRESET_MINUTES) {
                menu.addItem((item) => {
                    item.setTitle(t('timer.offsetMinutesAgo', { minutes }))
                        .onClick(() => offset(Date.now() - minutes * 60_000));
                });
            }
            if (remembered !== null) {
                menu.addItem((item) => {
                    item.setTitle(t('timer.offsetFromTime', { time: startLabel(remembered, now) }))
                        .onClick(() => offset(remembered));
                });
            }
            menu.addSeparator();
            menu.addItem((item) => {
                item.setTitle(t('timer.offsetCustom'))
                    .onClick(() => new TimerStartOffsetModal(this.deps.app, offset).open());
            });
        }, { kind: 'mouseEvent', event: e });
    }

    // ─── ポモドーロの設定 ────────────────────────────────────

    /**
     * ポモドーロの設定メニュー。設定の分を書き換え、走っているタイマーの区間の長さと
     * 自動の繰り返しも替える（`retimed`）。メニューの組み立ては `TimerSettingsMenu` が
     * 持ち、ここは行き先だけを渡す。区間の並びはポモドーロの形（work、break の
     * 1 組。`pomodoroGroups`）。
     */
    private showSettingsMenu(e: MouseEvent, timer: TimerState): void {
        const { board, plugin } = this.deps;
        if (!board.has(timer) || timer.measure.type !== 'interval') return;

        /** 1 組目を `change` で替えた区間の並び。 */
        const retime = (change: (group: IntervalGroup) => IntervalGroup): void => {
            if (timer.measure.type !== 'interval') return;
            const groups = timer.measure.groups.map((group, i) => i === 0 ? change(group) : group);
            board.dispatch(timer, { type: 'retimed', groups });
        };
        const applyMinutes = async (
            key: 'pomodoroWorkMinutes' | 'pomodoroBreakMinutes',
            segmentIndex: number,
            minutes: number,
        ): Promise<void> => {
            plugin.settings[key] = minutes;
            retime(group => ({
                ...group,
                segments: group.segments.map((segment, i) =>
                    i === segmentIndex ? { ...segment, durationSeconds: minutes * 60 } : segment),
            }));
            await plugin.saveSettings();
        };
        const firstGroup = (): IntervalGroup | undefined =>
            timer.measure.type === 'interval' ? timer.measure.groups[0] : undefined;

        plugin.menuPresenter.present((menu) => {
            TimerSettingsMenu.addPomodoroFields(menu, this.deps.app, {
                getWorkMinutes: () => plugin.settings.pomodoroWorkMinutes,
                setWorkMinutes: (minutes) => applyMinutes('pomodoroWorkMinutes', 0, minutes),
                getBreakMinutes: () => plugin.settings.pomodoroBreakMinutes,
                setBreakMinutes: (minutes) => applyMinutes('pomodoroBreakMinutes', 1, minutes),
                autoRepeat: {
                    isOn: () => firstGroup()?.repeatCount === 0,
                    toggle: () => retime(group => ({ ...group, repeatCount: group.repeatCount === 0 ? 1 : 0 })),
                },
            });
        }, { kind: 'mouseEvent', event: e });
    }

    // ─── Pin badge ───────────────────────────────────────────

    private renderPinBadge(container: HTMLElement): void {
        const host = this.deps.container;
        const existing = container.querySelector(':scope > .timer-widget__pin-badge') as HTMLButtonElement | null;
        if (!host.shouldShowPinBadge()) {
            // No second window to migrate to — pin would be a no-op control.
            existing?.remove();
            return;
        }
        const state = host.getPinState();
        const badge = existing ?? (() => {
            const b = container.createEl('button', { cls: 'timer-widget__pin-badge' });
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                host.togglePin();
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

    // ─── 名前の入力欄 ────────────────────────────────────────

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
}

/**
 * タイマーの輪と時間の表示: 時計の読みで測り方が見せるもの。中断中の時計は止めた
 * 時点の読みで、countdown とポモドーロは ▶ でそこから続くので、そのまま見せる。
 * countup は ▶ で 0 から数え直すので、中断中はこれまでの記録の合計を見せる。
 * 中断中の色は `suspended`。
 */
export function timerRing(timer: TimerState, now: number): RingState {
    const suspended = timer.session.kind === 'suspended';
    const progress = suspended && timer.measure.type === 'countup'
        ? progressOf(timer.measure, timer.recorded.seconds)
        : progressOf(timer.measure, readSeconds(timer.clock, now));
    return suspended ? { ...progress, tone: 'suspended' } : progress;
}

/** 畳んだ見出しの時間。countdown の残りは超過で負になるので符号を付ける。 */
export function headerTimeText(measure: Measure, ring: RingState): string {
    return measure.type === 'countdown'
        ? TimeFormatter.formatSignedSeconds(ring.displaySeconds)
        : TimeFormatter.formatSeconds(ring.displaySeconds);
}

/** 提案の輪: 提案が出てからの経過を数え上げの見た目で、色を付けずに見せる。 */
function idleRing(idle: IdleBoard, now: number): RingState {
    const seconds = readSeconds({ kind: 'running', startMs: idle.sinceMs }, now);
    return { ...progressOf({ type: 'countup' }, seconds), tone: 'plain' };
}

/** 提案が出た直後か（{@link IDLE_GUARD_MS}）。 */
function justShown(idle: IdleBoard): boolean {
    return Date.now() - idle.sinceMs < IDLE_GUARD_MS;
}
