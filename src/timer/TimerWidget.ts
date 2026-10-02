/**
 * Floating Timer Widget
 *
 * フローティングウィジェットとして複数のタイマー（countup、countdown、ポモドーロ）
 * と、走っているタイマーが無いときの次のタスクの提案を見せる。
 */

import { type App, Notice } from 'obsidian';
import { t } from '../i18n';
import type { EventRegistrar, PluginContext } from '../PluginContext';
import type { Task } from '../types';
import { AudioUtils } from './AudioUtils';
import { TimerRecorder } from './TimerRecorder';
import { TimerStartChoiceModal } from '../modals/TimerStartChoiceModal';
import type { TimerStartChoice } from './TimerStartMode';
import { decideStart } from './TimerStartRules';
import { TimerLifecycle } from './TimerLifecycle';
import { TimerRenderer } from './TimerRenderer';
import { TimerContentBinding } from './TimerContentBinding';
import { TimerPersistence } from './TimerPersistence';
import { TimerBoard } from './TimerBoard';
import { TimerRuntime } from './TimerRuntime';
import { newTimerId, type RecordMode, type Subject, type TimerState } from './TimerState';
import type { Measure } from './TimerProgress';
import { restart } from './TimerClock';
import { pomodoroGroups, START_CURSOR } from './IntervalMath';
import { TimerWidgetWindowObserver, type PinState } from './TimerWidgetWindowObserver';
import { autoGrowTextarea } from '../utils/TextareaAutoGrow';
import { getTaskDisplayName } from '../services/display/TaskContent';
import { getEffectiveColor } from '../services/data/EffectiveProperties';
import { DateUtils } from '../utils/DateUtils';
import { logInfo, logWarn } from '../log/log';
import type { SendingLines, SendTimers } from '../services/data/NoteOps';
import { anchorsOf, checkTimerSend, timerSendText } from './TimerSendCheck';

/**
 * Hands out the running timer widget. Declared beside the widget for the same
 * reason `ApiHost` lives beside `TaskApi`: naming it in `PluginContext` would
 * relocate the import cycle rather than close it.
 */
export interface TimerHost {
    getTimerWidget(): TimerWidget;
}

/** 何を測って始めるか。ウィジェットは汎用の interval を始めない。 */
export type TimerStart =
    | { kind: 'countup' }
    | { kind: 'countdown'; seconds: number }
    | { kind: 'pomodoro' };

/** タイマーの主題: 対象のタスクか、デイリーノートの日。 */
export type TimerSubjectInput = Task | { daily: string };

export class TimerWidget implements SendTimers {
    readonly app: App;
    readonly plugin: PluginContext & EventRegistrar;
    readonly board: TimerBoard;
    readonly runtime = new TimerRuntime();
    readonly recorder: TimerRecorder;
    readonly lifecycle: TimerLifecycle;
    private renderer: TimerRenderer;
    private contentBinding: TimerContentBinding;
    private persistence: TimerPersistence;
    private observer: TimerWidgetWindowObserver | null = null;
    /** 索引の変化の購読を解く。{@link activate} で結び、{@link destroy} で解く。 */
    private unwatchIndex: (() => void) | null = null;

    constructor(app: App, plugin: PluginContext & EventRegistrar) {
        this.app = app;
        this.plugin = plugin;
        this.persistence = new TimerPersistence(app);
        this.board = new TimerBoard({
            persist: () => this.persistence.persist(this.board.values(), this.board.idle),
            render: () => this.render(),
        });
        this.recorder = new TimerRecorder(plugin, {
            dispatch: (timer, event) => this.board.dispatch(timer, event),
            timers: () => this.board.values(),
        });
        // 値を書き換えた直後にオートグローを掛け直す（input 時 / syncFromFile 時）。
        this.contentBinding = new TimerContentBinding(plugin, this.board, this.recorder, autoGrowTextarea);
        this.lifecycle = new TimerLifecycle({
            board: this.board,
            runtime: this.runtime,
            recorder: this.recorder,
            content: this.contentBinding,
            renderTimes: () => this.renderer.renderTimes(),
        });
        this.renderer = new TimerRenderer({
            app,
            plugin,
            board: this.board,
            runtime: this.runtime,
            lifecycle: this.lifecycle,
            contentBinding: this.contentBinding,
            container: this,
            startTimer: (task) => this.startTimer(task, 'self', { kind: 'countup' }),
        });
    }

    /**
     * Wire up window observation and restore persisted timers. Must be called
     * after `workspace.onLayoutReady` so the observer can resolve which window
     * currently holds the active leaf.
     *
     * widget の表示（名前欄、名前、色）は索引の読みから作るので、索引が変わる
     * たびに合わせ直す。tick は時間の表示だけを進める。
     */
    activate(): void {
        logInfo('[Timer:activate]');
        if (this.observer) return;
        this.observer = new TimerWidgetWindowObserver(this.app, this.plugin, this);
        this.observer.start();
        this.unwatchIndex = this.plugin.getIndex().onChange(() => this.renderer.refreshFromIndex());
        const { timers, idle } = this.persistence.restore();
        this.board.restore(timers, idle);
        this.render();
        if (timers.length > 0) this.scheduleRestoredCheck();
    }

    // ─── container（observer に任せる） ─────────────────────────

    ensureContainer(): HTMLElement {
        if (!this.observer) throw new Error('TimerWidget: rendered before activate');
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

    // ─── 開始の命令 ─────────────────────────────────────────────

    /**
     * タイマーを始める。押した瞬間に走り出し、1 本目の行を書く（書けなければ閉じる）。
     *
     * 写し（名前、色、ノート、錨、self で上書きする前の start）は Task からここで
     * 1 回だけ取る。始めてよいか、self を使えるかは `TimerStartRules` が答える。
     * 二重起動は、対象の行の錨とデイリーノートの日で判定する（錨の無い行は、まだ
     * どのタイマーの対象でもない）。
     */
    startTimer(subject: TimerSubjectInput, mode: RecordMode, start: TimerStart): void {
        if ('daily' in subject) {
            const date = subject.daily;
            if (this.board.values().some(timer => timer.subject.kind === 'daily' && timer.subject.date === date)) {
                new Notice(t('timer.alreadyActive'));
                return;
            }
            this.launch(this.newTimer({ kind: 'daily', date }, '', date, '', 'child', start, null), null);
            return;
        }

        const task = subject;
        if (task.anchor && this.hasTimerOn(task.file, task.anchor)) {
            new Notice(t('timer.alreadyActive'));
            return;
        }
        const verdict = decideStart(task, mode, this.plugin.settings.statusDefinitions);
        switch (verdict.kind) {
            case 'refuse':
                new Notice(t('notice.timerTargetReadOnly'));
                return;
            case 'ask':
                new TimerStartChoiceModal(this.app, getTaskDisplayName(task), (choice: TimerStartChoice) => {
                    if (choice === 'cancel') return;
                    this.startOnTask(task, choice === 'continue' ? 'sibling' : 'self', start);
                }).open();
                return;
            case 'start':
                this.startOnTask(task, verdict.mode, start);
                return;
        }
    }

    /** 開いているタイマーが、ノート `file` の錨 `anchor` の行を対象にしているか。 */
    private hasTimerOn(file: string, anchor: string): boolean {
        return this.board.values().some(timer =>
            timer.file === file && timer.subject.kind === 'task' && timer.subject.anchor === anchor);
    }

    private startOnTask(task: Task, mode: RecordMode, start: TimerStart): void {
        const anchor = this.recorder.startAnchor(task);
        if (!anchor) return;
        const priorStartMs = mode === 'self' ? startMsOf(task) : null;
        const timer = this.newTimer(
            { kind: 'task', anchor }, task.file, getTaskDisplayName(task), getEffectiveColor(task) ?? '', mode, start, priorStartMs);
        this.launch(timer, task);
    }

    private newTimer(
        subject: Subject, file: string, name: string, color: string,
        mode: RecordMode, start: TimerStart, priorStartMs: number | null,
    ): TimerState {
        return {
            id: newTimerId(),
            subject,
            file,
            name,
            color,
            mode,
            measure: this.measureOf(start),
            clock: restart(Date.now()),
            session: { kind: 'running', from: 0 },
            tail: null,
            owned: [],
            opening: null,
            recorded: { seconds: 0, count: 0 },
            priorStartMs,
            draft: null,
            expanded: true,
        };
    }

    /** 設定は始めるたびに読む（起動時に固めると、設定の変更が次のタイマーに乗らない）。 */
    private measureOf(start: TimerStart): Measure {
        const { pomodoroWorkMinutes, pomodoroBreakMinutes } = this.plugin.settings;
        switch (start.kind) {
            case 'countup': return { type: 'countup' };
            case 'countdown': return { type: 'countdown', totalSeconds: Math.max(1, Math.floor(start.seconds)) };
            case 'pomodoro':
                return { type: 'interval', source: 'pomodoro', groups: pomodoroGroups(pomodoroWorkMinutes, pomodoroBreakMinutes), at: START_CURSOR };
        }
    }

    private launch(timer: TimerState, task: Task | null): void {
        this.board.add(timer);
        this.board.setIdle(null);
        AudioUtils.playStartSound();
        void this.lifecycle.begin(timer, task);
    }

    // ─── 復元 ───────────────────────────────────────────────────

    /**
     * 書く途中で落ちたタイマーの `opening` に、**最初の onChange を待ってから**
     * ファイルで答える（`TimerRecorder.adoptOpening`）。復元は layout-ready の直後に
     * 走り、初回のスキャンはまだ終わっていない。最初の変更の通知を、スキャンが
     * タスクを流し始めた合図にする。
     */
    private scheduleRestoredCheck(): void {
        let done = false;
        const unsubscribe = this.plugin.getIndex().onChange(() => {
            if (done) return;
            done = true;
            unsubscribe();
            void (async () => {
                for (const timer of this.board.values()) await this.recorder.adoptOpening(timer);
            })();
        });
    }

    // ─── 描画 ───────────────────────────────────────────────────

    /** 組み直す。activate の前は描かない（activate が復元のあとに描く）。tick は見せるものがある間だけ回す。 */
    render(): void {
        if (!this.observer) return;
        this.renderer.render();
        if (this.board.size > 0 || this.board.idle) this.runtime.startTick(() => this.lifecycle.tick());
        else this.runtime.stopTick();
    }

    // ─── ノートの移動 ───────────────────────────────────────────

    handleFileRename(oldPath: string, newPath: string): void {
        for (const timer of this.board.values()) {
            if (timer.file === oldPath) this.board.dispatch(timer, { type: 'followed', file: newPath });
        }
    }

    /**
     * Why the open timers keep a send of rows from being made, in one
     * sentence (`checkTimerSend`); null when nothing keeps it. Every open
     * timer is asked, one waiting to record as well.
     */
    refuse(sending: SendingLines): string | null {
        const timers = this.board.values().map(timer => ({ name: timer.name, file: timer.file, anchors: anchorsOf(timer) }));
        const verdict = checkTimerSend(timers, sending);
        return verdict.kind === 'clear' ? null : timerSendText(verdict);
    }

    /**
     * The rows of the note `from` were sent to the note `to` and have left
     * `from`, the lines carrying `anchors` with them: each timer of `from`
     * whose `^id`s ({@link anchorsOf}) all went finds its lines in `to` from
     * now on, as {@link handleFileRename} has it follow a note renamed.
     *
     * Asked as the write of `from` lands, so it is asked again here rather
     * than taken from the check before the send: a timer may have written
     * since. One whose `^id`s went only in part is left where it is, and
     * said in the log: the check would have kept the send.
     */
    follow(from: string, to: string, anchors: readonly string[]): void {
        const went = new Set(anchors);
        for (const timer of this.board.values()) {
            if (timer.file !== from) continue;
            const own = anchorsOf(timer);
            const going = own.filter(id => went.has(id));
            if (going.length === 0) continue;
            if (going.length < own.length) {
                logWarn(`[Timer:follow] only ${going.join(',')} of ${own.join(',')} went from ${from} to ${to}, the timer is left in ${from}`);
                continue;
            }
            logInfo(`[Timer:follow] ${own.join(',')} ${from} -> ${to}`);
            this.board.dispatch(timer, { type: 'followed', file: to });
        }
    }

    destroy(): void {
        this.unwatchIndex?.();
        this.unwatchIndex = null;
        this.board.flush();
        this.runtime.clear();
        this.board.clear();
        this.renderer.destroy();
    }
}

/** 行の start（日付と時刻）のミリ秒。時刻の無い start は null（覚える時刻が無い）。 */
function startMsOf(task: Task): number | null {
    if (!task.startDate || !task.startTime) return null;
    const ms = DateUtils.toDateTime(task.startDate, task.startTime).getTime();
    return Number.isNaN(ms) ? null : ms;
}
