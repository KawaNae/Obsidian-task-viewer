/**
 * Timer lifecycle: tick, pause, resume, close, idle management.
 */

import { AudioUtils } from './AudioUtils';
import type {
    CountdownTimer,
    CountupTimer,
    IdleTimer,
    IntervalTimer,
    PendingRecord,
    TimerInstance,
} from './TimerInstance';
import { getTimerElapsedSeconds } from './TimerInstance';
import { type TimerContext, IDLE_TIMER_ID } from './TimerContext';
import type { TimerCreator } from './TimerCreator';
import {
    advanceSegment,
    clampToTotalDuration,
    computeCompletedDuration,
    getCurrentSegment,
} from './IntervalMath';
import {
    accumulatePausedElapsed,
    applyCountdownTick,
    applyCountupTick,
    applyIntervalPauseSnapshot,
    applyIntervalTick,
} from './TimerTickMath';

export class TimerLifecycle {
    /** end の書き足しが飛んでいるタイマー。1 秒 tick の二重発行を防ぐ。 */
    private extending = new Set<string>();

    /**
     * prepare（interval の一時停止）に入る前の合計経過。待っている間は区間が
     * 進まないので、待ち時間だけをここを起点に足す。触るのはこのクラスだけ。
     */
    private prepareBaseElapsed = new Map<string, number>();

    /**
     * 書き込みの往復中の操作（記録する出口、再開、破棄）を持つタイマー。
     * 1 つのタイマーの操作は 1 つずつ。往復中に押された出口や再開は無視する —
     * 通すと同じ走行を二度記録し、通知も二度出る。
     */
    private busy = new Set<string>();

    constructor(
        private ctx: TimerContext,
        private creator: TimerCreator,
    ) {}

    // ─── Tick ─────────────────────────────────────────────────

    startTimerTicker(timerId: string): void {
        const timer = this.ctx.timers.get(timerId);
        if (!timer) return;
        if (timer.intervalId !== null) {
            window.clearInterval(timer.intervalId);
            timer.intervalId = null;
        }

        timer.intervalId = window.setInterval(() => {
            this.tick(timerId);
        }, 1000);
    }

    stopTimerTick(timerId: string): void {
        const timer = this.ctx.timers.get(timerId);
        if (!timer || timer.intervalId === null) return;

        window.clearInterval(timer.intervalId);
        timer.intervalId = null;
    }

    /**
     * 走行中の行の end を書き足す門。
     *
     * 実効 end を過ぎるまでは何もしない — 毎秒の tick でインデックスを引かない
     * ための門で、判断そのものは recorder が持つ。書き込みは非同期なので、
     * 返る前の tick が二重に走らないよう実行中の id を握っておく。
     *
     * 門（lazyEndFloorMs）はメモリの上だけの「次にいつ見直すか」の予定で、
     * 状態ではない。end の真の値は見直すたびにファイルから読み直すので、書き足し
     * が書けたかにかかわらず、recorder が決めた次の見直しの時刻へ進める。
     */
    private maybeExtendSessionEnd(timer: TimerInstance): void {
        if (timer.timerType === 'idle') return;
        if (timer.runState !== 'running') return;

        const floor = timer.lazyEndFloorMs;
        if (floor !== undefined && Date.now() < floor) return;
        if (this.extending.has(timer.id)) return;

        this.extending.add(timer.id);
        void this.ctx.recorder.extendRunningSession(timer)
            .then((nextFloorMs) => {
                // 行を引けなかったときだけ門を開けたままにして次の tick で再試行する。
                if (nextFloorMs !== undefined) timer.lazyEndFloorMs = nextFloorMs;
            })
            .finally(() => this.extending.delete(timer.id));
    }

    private tick(timerId: string): void {
        const timer = this.ctx.timers.get(timerId);
        if (!timer || !timer.isRunning) return;

        this.maybeExtendSessionEnd(timer);

        const now = Date.now();

        switch (timer.timerType) {
            case 'countup':
            case 'idle':
                applyCountupTick(timer, now);
                this.ctx.renderTimerItem(timerId);
                return;
            case 'countdown': {
                const tick = applyCountdownTick(timer, now);
                // 超過中は idle 扱いで見せる（表示色の切り替えだけ）。ウィジェットは
                // 0 を割っても鳴らさない — 記録が続いているので終わってはいない。
                timer.phase = tick.remaining < 0 ? 'idle' : 'work';
                this.ctx.renderTimerItem(timerId);
                return;
            }
            case 'interval': {
                if (timer.phase === 'prepare') {
                    // prepare はウィジェット固有の待機。区間は進まず、待った分だけを
                    // 足すので共有の区間計算には乗らない。
                    const sinceStart = Math.floor((now - timer.startTimeMs) / 1000);
                    const baseElapsed = this.prepareBaseElapsed.get(timerId) ?? timer.totalElapsedTime;
                    timer.totalElapsedTime = baseElapsed + Math.max(0, sinceStart);
                    this.ctx.renderTimerItem(timerId);
                    return;
                }

                const tick = applyIntervalTick(timer, now);
                if (tick.outcome === 'no-segment') {
                    void this.finishIntervalTimer(timerId, timer);
                    return;
                }
                if (tick.outcome === 'segment-complete') {
                    void this.handleIntervalSegmentComplete(timerId, timer);
                    return;
                }
                if (tick.warn) {
                    AudioUtils.playWarningBeep();
                }
                this.ctx.renderTimerItem(timerId);
                return;
            }
            default:
                return;
        }
    }

    async handleIntervalSegmentComplete(timerId: string, timer: IntervalTimer): Promise<void> {
        this.stopTimerTick(timerId);
        const currentSegment = getCurrentSegment(timer);
        if (!currentSegment) {
            await this.finishIntervalTimer(timerId, timer);
            return;
        }

        timer.totalElapsedTime = clampToTotalDuration(
            timer.totalDuration,
            computeCompletedDuration(timer) + currentSegment.durationSeconds
        );

        const moved = advanceSegment(timer);
        if (!moved) {
            await this.finishIntervalTimer(timerId, timer);
            return;
        }

        AudioUtils.playTransitionConfirm();

        const nextSegment = getCurrentSegment(timer);
        if (!nextSegment) {
            await this.finishIntervalTimer(timerId, timer);
            return;
        }

        timer.segmentTimeRemaining = nextSegment.durationSeconds;
        timer.phase = nextSegment.type;
        timer.startTimeMs = Date.now();
        timer.pausedElapsedTime = 0;
        timer.isRunning = true;
        this.startTimerTicker(timerId);
        this.ctx.render();
        this.ctx.persistTimersToStorage();
    }

    /** 最後の区間が満ちた。満ちた時刻で記録して閉じる（{@link stopAndRecord}）。 */
    private async finishIntervalTimer(timerId: string, timer: IntervalTimer): Promise<void> {
        return this.exclusive(timer, () => this.stopAndRecord(timer, 'close', () => {
            this.prepareBaseElapsed.delete(timerId);
            if (timer.totalDuration > 0) {
                timer.totalElapsedTime = timer.totalDuration;
            }
            timer.segmentTimeRemaining = 0;
            timer.isRunning = false;
            timer.pausedElapsedTime = timer.totalElapsedTime;
            this.stopTimerTick(timerId);
            AudioUtils.playFinishSound();
        }));
    }

    // ─── 記録 ─────────────────────────────────────────────────

    /** `op` を、そのタイマーの往復中の操作が無いときだけ走らせる（{@link busy}）。 */
    async exclusive(timer: TimerInstance, op: () => Promise<void>): Promise<void> {
        if (this.busy.has(timer.id)) return;
        this.busy.add(timer.id);
        try {
            await op();
        } finally {
            this.busy.delete(timer.id);
        }
    }

    /**
     * 走行を止めて記録する。**記録を書く出口はすべてここを通り**、`recordSessionEnd`
     * を呼ぶのはここだけ。
     *
     * 規則は「書けてから状態を進める」。止めた計測を `pendingRecord` に固定して
     * 保存してから書き、書けたら `then`（押した出口）へ進む。書けなければ何も
     * 戻さない — 記録待ちの状態がそのまま残り、再読み込みもまたぐ。理由の通知は
     * 書き込みの層か recorder が1回だけ出している。記録待ちで出口を押し直すと、
     * 止め直さずに固定した時刻と長さで書き直し、行き先だけを押した出口に替える。
     *
     * 記録は走行中の行の content を読むので、未書き込みの入力を先に流し込む。
     * 名前を書けなければ記録に進まない — 古い名前で記録を書けば通知が拒否と成功の
     * 2回になり、打った名前は行き先を失う。
     *
     * @param freeze 走行を止め、経過を確定させる。記録待ちで押し直したときは呼ばない。
     */
    private async stopAndRecord(timer: TimerInstance, then: PendingRecord['then'], freeze: () => void): Promise<void> {
        if (timer.pendingRecord) {
            timer.pendingRecord = { ...timer.pendingRecord, then };
        } else {
            freeze();
            timer.pendingRecord = { endMs: Date.now(), seconds: Math.max(0, getTimerElapsedSeconds(timer)), then };
        }
        this.ctx.render();
        this.ctx.persistTimersToStorage();

        const record = timer.pendingRecord;
        if (!(await this.ctx.flushTimerContent(timer.id))) return;
        if (!(await this.ctx.recorder.recordSessionEnd(timer, record))) return;

        timer.pendingRecord = null;
        timer.recordedElapsedTime += record.seconds;
        timer.sessionCount += 1;
        if (record.then === 'close') {
            this.closeTimer(timer.id);
            return;
        }
        timer.runState = 'suspended';
        timer.isExpanded = false;
        // 中断は「手を止めた」合図。走行中が居なくなったなら次タスクの提案を出す。
        this.startIdleTimerIfNothingRunning();
        this.ctx.render();
        this.ctx.persistTimersToStorage();
    }

    // ─── Pause / Resume / Close ───────────────────────────────

    pauseTimer(timer: TimerInstance): void {
        accumulatePausedElapsed(timer, Date.now());
        timer.isRunning = false;
        this.stopTimerTick(timer.id);

        switch (timer.timerType) {
            case 'countup':
            case 'idle':
                timer.elapsedTime = timer.pausedElapsedTime;
                break;
            case 'countdown':
                timer.elapsedTime = timer.pausedElapsedTime;
                timer.timeRemaining = timer.totalTime - timer.elapsedTime;
                timer.phase = timer.timeRemaining < 0 ? 'idle' : 'work';
                break;
            case 'interval':
                applyIntervalPauseSnapshot(timer);
                break;
            default:
                break;
        }
    }

    // ─── Session state machine (countup / countdown) ──────────

    /**
     * ⏸ 中断: 走行分を**記録してから**ウィジェットを生かしたまま停める。
     *
     * 現行 Stop との違いは `closeTimer` を呼ばないことだけ。記録を書き終えた行は
     * そのまま**尻尾**として残す（`tailRecordBlockId` / `recordedChildTaskId` を
     * 切らない）— 次の再開はその隣に新しいレコードを並べるので、どこが最後だった
     * かを手放してはいけない。
     *
     * `recordMode` も触らない。v2 では 1 本目の書き方（self / child / sibling）
     * だけを表し、2 本目以降は常に尻尾の兄弟なので、中断時に書き換える理由が無い。
     *
     * interval / idle は 4 出口の対象外（呼ばれない想定だが安全側で弾く）。
     */
    async suspendTimer(timer: TimerInstance): Promise<void> {
        if (timer.timerType === 'interval' || timer.timerType === 'idle') return;
        if (timer.runState === 'suspended') return;
        return this.exclusive(timer, () => this.stopAndRecord(timer, 'suspend', () => this.pauseTimer(timer)));
    }

    /**
     * ▶ 再開: 新しいセッションを始める。
     *
     * **経過は 0 から**。セッション = レコード単位なので、前のセッションの
     * 経過を持ち越すと 1 レコードの長さが実際の作業と食い違う（現行
     * {@link resumeTimer} の累積保持と違う点）。合計は
     * `recordedElapsedTime` が持っている。
     *
     * 走行中がタイムラインに見えるよう、セッション行は開始時に書く。
     */
    resumeSession(timer: TimerInstance): void {
        if (timer.runState !== 'suspended') return;
        const pressedAt = Date.now();
        // 行を書けてから走り出す。往復の間は中断のまま（出口も ▶ も busy が捨てる）。
        // 書き先（尻尾の兄弟 / フォールバックの子）の判断は recorder が持つ。
        void this.exclusive(timer, async () => {
            // 中断中に打たれた入力は直前のレコード宛。新しい行を挿す前に流し込む。
            const began = await this.ctx.flushTimerContent(timer.id)
                && await this.ctx.recorder.startNextSession(timer, pressedAt);
            if (!began) {
                // 名前か走行中の行を書けなかった。理由は1回だけ通知済み。中断のまま
                // 残る — もう一度 ▶ を押せば書き直す。
                this.ctx.render();
                this.ctx.persistTimersToStorage();
                return;
            }

            timer.runState = 'running';
            timer.startTimeMs = pressedAt;
            timer.pausedElapsedTime = 0;
            timer.isRunning = true;
            timer.isExpanded = true;
            if (timer.timerType === 'countup') {
                timer.elapsedTime = 0;
            } else if (timer.timerType === 'countdown') {
                timer.elapsedTime = 0;
                timer.timeRemaining = timer.totalTime;
                timer.phase = 'work';
            }
            this.stopIdleTimer();
            this.startTimerTicker(timer.id);
            AudioUtils.playStartSound();
            this.ctx.render();
            this.ctx.persistTimersToStorage();
            // 往復の間に打たれた分は、新しいセッションの行が受け取る。
            await this.ctx.flushTimerContent(timer.id);
        });
    }

    /**
     * ■ 終了: 走行中なら記録してからウィジェットを畳む。
     *
     * **タスクの状態は触らない**。タイマーは計測と記録の装置で、完了はユーザーが
     * checkbox で宣言するもの — v1 はここで対象タスクを `[x]` にしていたが、
     * 「状態を所有しようとしたこと」が複雑さの根だったので v2 で手放した。
     *
     * 尻尾に残っている `^id` は `closeTimer` → `onTimerClosed` が片付ける。
     */
    async finishTimer(timer: TimerInstance): Promise<void> {
        return this.exclusive(timer, async () => {
            if (timer.runState === 'suspended' || timer.timerType === 'idle') {
                this.closeTimer(timer.id);
                return;
            }
            await this.stopAndRecord(timer, 'close', () => this.pauseTimer(timer));
        });
    }

    /**
     * ✕ 破棄（走行中）: 今回の走行を記録せずに閉じる。
     *
     * 開始時に自分が書いた placeholder 行は道連れにする — 記録しないと決めた以上、
     * 開きかけの行だけがノートに残るのは事実ではなくゴミ。判断（本当に自分の行か）
     * は recorder 側。
     */
    async discardTimer(timer: TimerInstance): Promise<void> {
        return this.exclusive(timer, async () => {
            // 先に tick を止める。走行中の行は end の書き足し対象でもあるので、
            // 消している最中の行に書き足しが飛ぶ経路を作らない。
            this.stopTimerTick(timer.id);
            // 走行中の行ごと消えるので、未書き込みの入力は書かずに捨てる。
            this.ctx.discardTimerContent(timer.id);
            await this.ctx.recorder.discardRunningPlaceholder(timer);
            this.closeTimer(timer.id);
        });
    }

    pauseIntervalToPrepare(timer: IntervalTimer): void {
        this.pauseTimer(timer);
        timer.phase = 'prepare';
        timer.startTimeMs = Date.now();
        timer.isRunning = true;
        this.prepareBaseElapsed.set(timer.id, timer.totalElapsedTime);
        this.startTimerTicker(timer.id);
    }

    /**
     * ■ interval の停止: 走行分を記録して閉じる。
     *
     * countup / countdown の 4 出口（{@link suspendTimer} / {@link finishTimer} /
     * {@link discardTimer}）と同じく、遷移を 1 メソッドで持つ。以前は prepare 中と
     * 走行中で別々のハンドラが `TimerRenderer` に書かれていて、2026-08-17 に flush
     * を足したとき片方だけが直った。同じ形を 2 箇所に書ける限り、また割れる。
     */
    async stopIntervalTimer(timer: IntervalTimer): Promise<void> {
        return this.exclusive(timer, async () => {
            AudioUtils.playFinishSound();
            await this.stopAndRecord(timer, 'close', () => this.pauseOrSnapshotIntervalForStop(timer));
        });
    }

    private pauseOrSnapshotIntervalForStop(timer: IntervalTimer): void {
        if (timer.phase === 'prepare' && timer.isRunning) {
            const now = Date.now();
            const prepareElapsed = Math.max(0, Math.floor((now - timer.startTimeMs) / 1000));
            const baseElapsed = this.prepareBaseElapsed.get(timer.id) ?? timer.totalElapsedTime;
            timer.totalElapsedTime = baseElapsed + prepareElapsed;
            timer.isRunning = false;
            this.stopTimerTick(timer.id);
            this.prepareBaseElapsed.delete(timer.id);
            return;
        }

        if (timer.isRunning) {
            this.pauseTimer(timer);
        }
        this.prepareBaseElapsed.delete(timer.id);
    }

    /** interval の一時停止（prepare）から区間に戻る。 */
    resumeTimer(timer: IntervalTimer): void {
        const segment = getCurrentSegment(timer);
        if (segment) {
            timer.phase = segment.type;
        }
        this.prepareBaseElapsed.delete(timer.id);
        this.stopTimerTick(timer.id);
        timer.startTimeMs = Date.now();
        timer.isRunning = true;
        this.startTimerTicker(timer.id);
        AudioUtils.playStartSound();
        this.ctx.render();
        this.ctx.persistTimersToStorage();
    }

    closeTimer(timerId: string): void {
        const timer = this.ctx.timers.get(timerId);
        if (!timer) return;
        const closingIdleTimer = this.isIdleTimer(timerId);

        this.prepareBaseElapsed.delete(timerId);
        this.stopTimerTick(timerId);
        this.ctx.timers.delete(timerId);

        if (!closingIdleTimer) {
            this.startIdleTimerIfNothingRunning();
        }

        this.ctx.render();
        this.ctx.persistTimersToStorage();

        if (!closingIdleTimer) {
            this.ctx.onTimerClosed(timer);
        }
    }

    /** widget を畳むときの後始末。次に組み直したときへ持ち越さない。 */
    clearPrepareState(): void {
        this.prepareBaseElapsed.clear();
    }

    // ─── Idle Timer ───────────────────────────────────────────

    isIdleTimer(timerId: string): boolean {
        return timerId === IDLE_TIMER_ID;
    }

    /**
     * 実際に**走行している**非 idle タイマーがあるか。中断中は非稼働として
     * 数えない — 中断はユーザーが手を止めた合図なので、次タスクの提案（idle
     * タイマー）が出てほしい。
     */
    hasRunningNonIdleTimers(): boolean {
        for (const [timerId, timer] of this.ctx.timers) {
            if (this.isIdleTimer(timerId)) continue;
            if (timer.runState === 'running') return true;
        }
        return false;
    }

    /** 走行中が 1 本も無ければ idle を起こす。close と中断の共通後始末。 */
    startIdleTimerIfNothingRunning(): void {
        if (this.hasRunningNonIdleTimers()) return;
        this.startIdleTimer();
    }

    /**
     * Whether some timer is already tracking `taskId`. The map is keyed by
     * timer id, so this scans by task — which also keeps working after a file
     * rename rewrites `timer.taskId` (the old code asked `timers.has(taskId)`,
     * which silently allowed a second timer on the renamed task).
     */
    hasActiveTimerForTask(taskId: string, timerTargetId?: string): boolean {
        if (this.isIdleTimer(taskId)) {
            return this.ctx.timers.has(IDLE_TIMER_ID);
        }

        for (const timer of this.ctx.timers.values()) {
            if (timer.taskId === taskId) {
                return true;
            }
            if (timerTargetId && timer.timerTargetId === timerTargetId) {
                return true;
            }
        }

        return false;
    }

    startIdleTimer(): void {
        if (this.ctx.timers.has(IDLE_TIMER_ID)) {
            return;
        }

        const idleTimer: IdleTimer = {
            id: IDLE_TIMER_ID,
            taskId: IDLE_TIMER_ID,
            taskName: 'Idle',
            taskOriginalText: '',
            taskFile: '',
            timerTargetId: undefined,
            ownedAnchors: [],
            startTimeMs: Date.now(),
            pausedElapsedTime: 0,
            phase: 'idle',
            isRunning: true,
            runState: 'running',
            sessionCount: 0,
            recordedElapsedTime: 0,
            pendingRecord: null,
            opening: null,
            isExpanded: true,
            intervalId: null,
            timerType: 'idle',
            elapsedTime: 0,
            recordMode: 'child',
            parserId: 'tv-inline',
            taskColor: '',
        };

        this.ctx.timers.set(IDLE_TIMER_ID, idleTimer);
        this.startTimerTicker(IDLE_TIMER_ID);
        this.ctx.render();
    }

    stopIdleTimer(): void {
        const idleTimer = this.ctx.timers.get(IDLE_TIMER_ID);
        if (!idleTimer) {
            return;
        }

        this.stopTimerTick(IDLE_TIMER_ID);
        this.ctx.timers.delete(IDLE_TIMER_ID);
    }
}
