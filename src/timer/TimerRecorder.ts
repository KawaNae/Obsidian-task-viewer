/**
 * Timer Recorder
 *
 * Handles saving timer records to tasks or daily notes.
 */

import { type App, Notice } from 'obsidian';
import { t } from '../i18n';
import type { PluginContext } from '../PluginContext';
import { type TimerInstance, dailyDateOf, describeTimerAnchor, getTimerElapsedSeconds, isDailyTimer } from './TimerInstance';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { DateUtils } from '../utils/DateUtils';
import { TaskParser } from '../services/parsing/TaskParser';
import type { Task } from '../types';
import { createTempTask } from '../services/data/createTempTask';
import { TimeFormatter } from '../utils/TimeFormatter';
import { TimerTaskResolver } from './TimerTaskResolver';
import { isTimerTargetId } from '../utils/TimerTargetIdUtils';
import { type TimerIcon, getTimerIcon, splitTimerIcon, withTimerIcon } from '../utils/TimerIcons';
import { decideLazyEnd } from './TimerLazyEnd';
import type { TimerStorageUtils } from './TimerStorageUtils';
import { logInfo, logWarn } from '../log/log';

/**
 * What became of the line a resumed session runs on. Not written has been
 * told to the user, once. Written, its id is there once a scan has read it.
 */
export type SessionLine =
    | { written: false }
    | { written: true; sessionTaskId?: string };

export class TimerRecorder {
    private resolver: TimerTaskResolver;
    private storageUtils: TimerStorageUtils;

    constructor(
        private app: App,
        private plugin: PluginContext,
        storageUtils: TimerStorageUtils
    ) {
        this.resolver = new TimerTaskResolver(plugin);
        this.storageUtils = storageUtils;
    }

    /** When the session ended: the first press of the exit that records it, or now. */
    private stoppedAt(timer: TimerInstance): Date {
        return new Date(timer.stoppedAtMs ?? Date.now());
    }

    /**
     * Record a completed Countup timer session.
     */
    async addCountupRecord(timer: TimerInstance): Promise<boolean> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = this.stoppedAt(timer);
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const icon = this.getTimerIcon(timer);
        const taskObj = this.createTaskObject(
            this.recordLabel(timer),
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        const formattedLine = TaskParser.format(taskObj);

        if (!(await this.insertChildRecord(timer, formattedLine))) return false;
        new Notice(t('notice.timerRecorded', { icon, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
        return true;
    }

    /**
     * Record a completed Countdown timer session.
     */
    async addCountdownRecord(timer: TimerInstance): Promise<boolean> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = this.stoppedAt(timer);
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const icon = this.getTimerIcon(timer);
        const taskObj = this.createTaskObject(
            this.recordLabel(timer),
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        const formattedLine = TaskParser.format(taskObj);

        if (!(await this.insertChildRecord(timer, formattedLine))) return false;
        new Notice(t('notice.countdownRecorded', { icon, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
        return true;
    }

    /**
     * Record a completed Interval timer session.
     * Pomodoro-origin intervals are recorded with 🍅 label.
     */
    async addIntervalRecord(timer: TimerInstance): Promise<boolean> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = this.stoppedAt(timer);
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const isPomodoroSource = timer.timerType === 'interval' && timer.intervalSource === 'pomodoro';
        const icon = this.getTimerIcon(timer);

        const taskObj = this.createTaskObject(
            this.recordLabel(timer),
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        const formattedLine = TaskParser.format(taskObj);

        if (!(await this.insertChildRecord(timer, formattedLine))) return false;
        const kind = isPomodoroSource ? 'Pomodoro' : 'Interval';
        new Notice(t('notice.kindRecorded', { icon, kind, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
        return true;
    }

    /**
     * ストップ時の記録の **唯一の入口**。「今どの行に走っているか」で書き先を選ぶ。
     *
     *   走行中の行がある     → その行を閉じる（開始時に書いた placeholder）
     *   self の 1 本目       → 対象タスク行そのものをレコードに変形する
     *   それ以外             → レコードを 1 行足す（フォールバック）
     *
     * `recordMode` を先に見てはいけない。self モードでも 2 本目以降は自分で書いた
     * 兄弟レコードに走っており、対象タスク行はもう 1 本目のレコードとして確定して
     * いる — そこへ書き戻すと最初のセッションが上書きされて消える。
     *
     * ここを通さずに `addCountdownRecord` / `addIntervalRecord` を直接呼ぶと、
     * 開始時に作った placeholder が更新されず 1 セッションが 2 行になる。停止経路は
     * 必ずこれを呼ぶこと。
     *
     * @returns 記録を書けたか（記録するものが無い idle は書けたと答える）。書けな
     * かったときは、その理由を1回だけ通知済みで、成功の通知は出していない。
     * 呼び出し側は widget を閉じず、計測を残す。
     */
    async recordSessionEnd(timer: TimerInstance): Promise<boolean> {
        if (!timer.recordedChildTaskId && timer.recordMode === 'self' && timer.sessionCount === 0) {
            return this.updateTaskDirectly(timer);
        }
        return this.addSessionRecord(timer);
    }

    /**
     * Record for stopwatch-style modes; idle is intentionally ignored.
     * If a child task was created at start (recordedChildTaskId), update it instead.
     */
    async addSessionRecord(timer: TimerInstance): Promise<boolean> {
        if (timer.recordedChildTaskId) {
            return this.updateChildAtEnd(timer);
        }
        switch (timer.timerType) {
            case 'countup':
                return this.addCountupRecord(timer);
            case 'countdown':
                return this.addCountdownRecord(timer);
            case 'interval':
                return this.addIntervalRecord(timer);
            case 'idle':
                // No record for idle yet: nothing to write, nothing lost.
                return true;
            default:
                return true;
        }
    }

    /**
     * Write startDate/startTime to the task at timer start (for 'self' recordMode).
     * - Timeline tasks (has startTime): parallel translation — preserve duration
     * - Allday tasks (no startTime): discard endDate/endTime, convert to S-Timed
     */
    async updateTaskStartTime(timer: TimerInstance): Promise<void> {
        const now = new Date();
        const taskIndex = this.plugin.getTaskIndex();
        const task = this.resolver.resolveTvInline(timer);

        if (!task) {
            // 開始時の書き込みが落ちるとセッションを丸ごと失う。黙って戻ると
            // ユーザーは計測を終えるまで気づけないので、書き込めない形式だと
            // 分かっている場合はその場で伝える。行を見失っただけの場合は
            // 再スキャンで直ることがあるのでログに留める。
            const reason = this.resolver.explainFailure(timer);
            if (reason === 'read-only') {
                new Notice(t('notice.timerTargetReadOnly'));
            } else {
                logWarn(`[TimerRecorder] start-time write skipped: timer target not resolved (${describeTimerAnchor(timer)})`);
            }
            return;
        }

        const updates: Record<string, string | undefined> = {
            startDate: this.formatDate(now),
            startTime: this.formatTime(now),
        };

        if (task.startTime) {
            // Timeline task (has time): parallel translation — preserve duration
            // Resolve implicit endDate for same-day notation (e.g., @dateThh:mm>hh:mm)
            const effectiveEndDate = task.endDate ?? (task.endTime ? task.startDate : undefined);

            if (task.startDate && effectiveEndDate && task.endTime) {
                const oldStart = new Date(`${task.startDate}T${task.startTime}`);
                const oldEnd = new Date(`${effectiveEndDate}T${task.endTime}`);
                const durationMs = oldEnd.getTime() - oldStart.getTime();
                const newEnd = new Date(now.getTime() + durationMs);
                updates.endDate = this.formatDate(newEnd);
                updates.endTime = this.formatTime(newEnd);
            }
        } else {
            // Allday task (no time): discard endDate, convert to S-Timed
            if (task.endDate) {
                updates.endDate = undefined;
            }
            if (task.endTime) {
                updates.endTime = undefined;
            }
        }

        await taskIndex.updateTask(task.id, updates);
    }

    /**
     * 走行中の行の end を、実効 end を過ぎていたら先へ書き足す。
     *
     * 書き先は「今どの行に走っているか」＝ {@link resolveTailRecord} が返す行で、
     * 停止時の記録と同じ判断に乗る（self の 1 本目は対象タスク行、それ以外は
     * 自分が書いたセッション行）。行を引けなければ何も書かない — 次の見直しで
     * また試す。
     *
     * 実効 end は `DisplayTask` から取る。end の無い時刻付きタスクが既定の 1 時間
     * で終わる規則はそちらが持っており、ここで再現すると二重管理になる。明示 end
     * を持つ行も同じ経路で扱えるのはその副産物である。
     *
     * @returns 次に見直す時刻（ミリ秒）。行を引けなかったときは undefined。
     */
    async extendRunningSession(timer: TimerInstance): Promise<number | undefined> {
        const target = this.resolveTailRecord(timer);
        if (!target) return undefined;

        const display = this.plugin.getTaskReadService().getDisplayTask(target.id);
        if (!display?.effectiveEndDate || !display.effectiveEndTime) return undefined;

        const effectiveEndMs = new Date(
            `${display.effectiveEndDate}T${display.effectiveEndTime}`
        ).getTime();
        if (Number.isNaN(effectiveEndMs)) return undefined;

        const decision = decideLazyEnd(Date.now(), effectiveEndMs);
        if (decision.kind === 'hold') return decision.floorMs;

        const end = new Date(decision.endMs);
        await this.plugin.getTaskIndex().updateTask(target.id, {
            endDate: this.formatDate(end),
            endTime: this.formatTime(end),
        });
        return decision.endMs;
    }

    /**
     * 走行中セッションの行（placeholder）を組み立てる。
     *
     * 開始時刻だけを持つ未完了行で、`blockId` は書き込んだ後に「どの行が今の
     * セッションか」を引き直すための目印（＝ 尻尾アンカー）。セッション行の形は
     * ここが唯一の持ち主で、子として挿す経路（{@link createChildAtStart}）と
     * 兄弟に挿す経路（{@link startNextSession}）が同じ行を使う。
     *
     * 名前は**対象タスクの名前を継ぐ**。セッションは同じ作業の分割であって別物
     * ではないので、レコードが無名（アイコンだけ）になると後から読めない。
     * デイリーノート起点だけは継ぐ相手が無く、空名で始めて widget で付けさせる。
     */
    buildSessionPlaceholder(timer: TimerInstance): { line: string; blockId: string } {
        const now = new Date();
        const blockId = this.storageUtils.generateTimerTargetId();

        const taskObj = this.createTaskObject(
            this.sessionName(timer),
            this.formatDate(now),
            this.formatTime(now),
            '', ''
        );
        taskObj.statusChar = ' ';
        taskObj.blockId = blockId;

        return { line: TaskParser.format(taskObj), blockId };
    }

    /**
     * 書き込んだセッション行を blockId で引き直す。スキャンの完了を待ってから
     * 探すので、呼び出し側は書き込み直後にそのまま呼んでよい。
     */
    async findSessionTaskId(filePath: string, blockId: string): Promise<string | undefined> {
        const taskIndex = this.plugin.getTaskIndex();
        await taskIndex.waitForScan(filePath);
        return taskIndex.getTasks().find(t => t.file === filePath && t.blockId === blockId)?.id;
    }

    /**
     * Create a child task at timer start (for 'child' recordMode).
     * Inserts a placeholder child with startDate/startTime and a blockId for tracking.
     * Returns the child task ID, or undefined if insertion failed.
     */
    async createChildAtStart(timer: TimerInstance): Promise<string | undefined> {
        const { line, blockId } = this.buildSessionPlaceholder(timer);
        const file = await this.writeChildLine(timer, line);
        if (file === null) return undefined;

        timer.tailRecordBlockId = blockId;
        return this.adoptWrittenSession(timer, file, blockId);
    }

    /**
     * セッション行を対象タスクの子として書き、書いたファイルを返す。書けなければ
     * null で、理由は1回だけ通知済み。
     *
     * デイリーノート起点は器になるタスクが無いので、設定の見出しの下へ行を直接置く。
     * 書いた後にノートのパスを `taskFile` へ引き取るのが要点で、これで尻尾の解決
     * （ファイルで絞る）と 2 本目以降の兄弟挿入が通常タスクと同じ経路に乗る。
     */
    private async writeChildLine(timer: TimerInstance, line: string): Promise<string | null> {
        if (isDailyTimer(timer)) {
            const filePath = await this.addTimerRecordToDailyNote(dailyDateOf(timer), line);
            if (filePath) timer.taskFile = filePath;
            return filePath;
        }
        if (!(await this.insertChildRecord(timer, line))) return null;
        return this.resolver.resolveTvInline(timer)?.file ?? timer.taskFile;
    }

    /**
     * `[x]` のタスクから「続きを開始」したときの 1 本目。
     *
     * 起点の行そのものは触らず（既に完了した事実）、**その行から連続する完了済み
     * 兄弟の末尾**に新しいセッション行を置く。位置決めは書き込み層の
     * `afterCompletedRun` が担う — どこまでが「連続する完了済み」かは index の
     * スナップショットではなくファイルの生の行を見ないと決まらないため。
     */
    async startContinuationSession(timer: TimerInstance): Promise<string | undefined> {
        const anchor = this.resolveAnchorTask(timer);
        if (!anchor) return this.createChildAtStart(timer);

        const { line, blockId } = this.buildSessionPlaceholder(timer);
        const inserted = await this.plugin.getTaskWriteService()
            .insertSiblingAfterTask(anchor.id, line, { afterCompletedRun: true });
        if (!inserted) return undefined;

        timer.tailRecordBlockId = blockId;
        return this.adoptWrittenSession(timer, anchor.file, blockId);
    }

    /**
     * 書けたセッション行の task id を引き、走行中の行として引き受ける。
     *
     * 尻尾アンカーは書けた時点で呼び出し側が移している。行は書けているので、
     * スキャンがまだ引けなくても、引けた時点で `^id` がその行を指す。
     */
    private async adoptWrittenSession(
        timer: TimerInstance,
        filePath: string,
        blockId: string,
    ): Promise<string | undefined> {
        const sessionTaskId = await this.findSessionTaskId(filePath, blockId);
        if (!sessionTaskId) {
            logWarn(`[TimerRecorder] session line ${blockId} written but not found by the scan yet (${describeTimerAnchor(timer)})`);
            return undefined;
        }

        timer.recordedChildTaskId = sessionTaskId;
        // 新しい行に走り始めたので、end 書き足しの門は引き直す。
        timer.lazyEndFloorMs = undefined;
        return sessionTaskId;
    }

    /**
     * Update the child task created at timer start with end time and completion.
     */
    private async updateChildAtEnd(timer: TimerInstance): Promise<boolean> {
        const taskIndex = this.plugin.getTaskIndex();
        // id の直引きではなく尻尾アンカーで引く。task id はセッション限りなので、
        // リロードを挟むと永続化された recordedChildTaskId は何も指さない。
        const child = this.resolveRecordedSession(timer);
        if (child) timer.recordedChildTaskId = child.id;

        if (!child) {
            // Fallback: child was deleted, create a new record. Said once, by
            // the record's own notice: what the user needs to hear is whether
            // the session was recorded, not which line took it.
            logWarn(`[TimerRecorder] updateChildAtEnd: running line not found, adding a record instead (${describeTimerAnchor(timer)})`);
            timer.recordedChildTaskId = undefined;
            switch (timer.timerType) {
                case 'countup': return this.addCountupRecord(timer);
                case 'countdown': return this.addCountdownRecord(timer);
                case 'interval': return this.addIntervalRecord(timer);
                default: return true;
            }
        }

        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = this.stoppedAt(timer);

        const icon = this.getTimerIcon(timer);
        // 名前は対象タスクから継ぐので、既にアイコン付きの行（完了済みレコードの
        // 「続き」など）を起点にすると二重に付く。付け直しの規則は
        // {@link withTimerIcon} が持つ。
        const content = withTimerIcon(icon, child.content.trim());

        const written = await taskIndex.updateTask(child.id, {
            content,
            endDate: this.formatDate(endTime),
            endTime: this.formatTime(endTime),
            statusChar: 'x',
            // `^id` は**残す**。記録を書き終えてもこの行は尻尾のままで、次の再開は
            // ここを起点に兄弟を挿す。外すのは尻尾でなくなるとき（再開）と
            // widget を閉じるときだけ。
            blockId: child.blockId,
        });

        // Not written: the write layer has said why, once.
        if (!written) return false;

        const kind = this.getTimerKind(timer);
        new Notice(t('notice.kindRecorded', { icon, kind, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
        return true;
    }

    /**
     * 対象を引けなかったことを、原因に応じた文言で伝える。
     *
     * 読み取り専用の形式（day-planner / tasks-plugin）は最初から書き込めない。
     * 「削除、移動、またはリネームされた可能性」と言うと、実際には在る行を
     * 探しに行かせることになる。
     *
     * 開始時の {@link updateTaskStartTime} は not-found を黙って見送るが、ここは
     * 原因を問わず伝える。失うものが違うためで、非対称は意図したもの — 開始時の
     * 書き込みが落ちても計測は続き、停止時の記録で回収できる。停止時に落ちると
     * 計測そのものが消える。
     */
    private noticeResolveFailure(timer: TimerInstance, site: string): void {
        const reason = this.resolver.explainFailure(timer);
        logWarn(`[TimerRecorder] ${site}: timer target ${reason} (${describeTimerAnchor(timer)})`);
        new Notice(t(reason === 'read-only'
            ? 'notice.timerTargetReadOnly'
            : 'notice.timerTargetNotFound'));
    }

    /**
     * レコードが名乗る名前の素。**行を新しく作るときだけ**使う。
     *
     * 行が既にあるなら content の正はその行で、widget の入力欄がその行を直接書き
     * 換える（`TimerContentBinding`）。ここへ来るのは書く相手がまだ無い場合だけで、
     * 未書き込みの下書きがあればそれ、無ければ**対象タスクの名前を継ぐ**。セッションは
     * 同じ作業の分割であって別物ではないので、名前を落とすと後から読めない。
     * 走行中の行を書く {@link buildSessionPlaceholder} と、行を引けずに 1 行
     * 足すフォールバック（{@link addCountupRecord} 系）で規則が割れていて、
     * 後者だけが名前を失っていた。
     */
    private sessionName(timer: TimerInstance): string {
        const drafted = timer.pendingContent?.trim();
        if (drafted) return drafted;
        if (!isDailyTimer(timer)) return timer.taskName.trim();

        // デイリーノート起点の `taskName` は日付で、作業名として継ぐと
        // 「2026-08-17 を 25 分やった」という読めない記録が残る。1 本目は空で
        // 始めて widget で付けさせ、2 本目以降は直前のレコードから継ぐ
        // （兄弟レコードは同名、が v2 の規則）。
        const tail = this.resolveTailRecord(timer);
        return tail ? splitTimerIcon(tail.content).name : '';
    }

    /** レコード行の content（アイコン + 名前）。 */
    private recordLabel(timer: TimerInstance): string {
        return withTimerIcon(this.getTimerIcon(timer), this.sessionName(timer));
    }

    /**
     * Get the emoji icon for a timer type.
     * 一覧は {@link TimerIcons} が持つ — 剥がす側（フロー発火）と共有する。
     */
    private getTimerIcon(timer: TimerInstance): TimerIcon {
        return getTimerIcon(
            timer.timerType,
            timer.timerType === 'interval' ? timer.intervalSource : undefined
        );
    }

    /**
     * Get the display kind name for a timer type.
     */
    private getTimerKind(timer: TimerInstance): string {
        if (timer.timerType === 'interval') {
            return timer.intervalSource === 'pomodoro' ? 'Pomodoro' : 'Interval';
        }
        if (timer.timerType === 'countdown') return 'Countdown';
        return 'Timer';
    }

    /** タイマーのアンカーが指す行（1 回目のレコード / 対象タスク）を引く。 */
    private resolveAnchorTask(timer: TimerInstance): Task | undefined {
        return this.resolver.resolveTvInline(timer);
    }

    /**
     * タイマーが最後に書いたレコード行（＝ 尻尾）。
     *
     * 正は尻尾アンカー `tailRecordBlockId` — 行番号ベースの task id はユーザーの
     * 編集やリロードで腐るのに対し、`^id` はファイルに書いてあるものが正になる。
     * 引けなければ task id のキャッシュへ落ちる。
     *
     * 最後の砦は self モードに限る。self は 1 本目のレコードが対象タスク行その
     * ものなので対象アンカーが尻尾を兼ねるが、child / sibling の対象は**器**で
     * あってレコードではない。器を尻尾と見なすと、その隣（＝ ユーザーのタスクと
     * 同じ深さ）にレコードを置いてしまう。
     *
     * self でも砦になるのは 1 本目のセッションの間だけ（走行中の 1 本目と、それを
     * 記録して中断している間）。2 本目が走っている間、対象タスク行は書き終えた
     * 1 本目の記録で、走行中の行ではない。そこへ落ちると、2 本目の end と名前が
     * 1 本目の記録を書き換える。
     */
    resolveTailRecord(timer: TimerInstance): Task | undefined {
        const anchorIsTail = timer.recordMode === 'self'
            && (timer.sessionCount === 0 || (timer.sessionCount === 1 && timer.runState === 'suspended'));
        return this.resolveRecordedSession(timer)
            ?? (anchorIsTail ? this.resolveAnchorTask(timer) : undefined);
    }

    /**
     * 尻尾のうち、タイマーが自分で書いたレコード行だけを引く（対象アンカーへは
     * 落ちない）。
     *
     * 停止時の書き込み先はこれで決める。self の 2 本目以降で対象アンカーに
     * 落ちると、1 本目のレコードの終了時刻を上書きしてしまう。
     */
    private resolveRecordedSession(timer: TimerInstance): Task | undefined {
        const taskIndex = this.plugin.getTaskIndex();

        if (timer.tailRecordBlockId) {
            const byBlockId = taskIndex.getTasks().find(task =>
                task.blockId === timer.tailRecordBlockId
                && (!timer.taskFile || task.file === timer.taskFile)
            );
            if (byBlockId) return byBlockId;
        }

        if (timer.recordedChildTaskId) {
            const byId = taskIndex.getTask(timer.recordedChildTaskId);
            if (byId) return byId;
        }

        return undefined;
    }

    /**
     * 再開時にセッション行を書いて次の走行を始める。
     *
     *   尻尾を引ける     → **尻尾の兄弟**として追記し、尻尾アンカーを進める
     *   引けない         → 対象タスクの子として追記（フォールバック）
     *
     * self 起点か child 起点かで分けない。self は 1 本目がタスク行そのもの、
     * child は 1 本目が子で、どちらも 2 本目以降は「直前のレコードの隣」に並ぶ。
     * デイリーノート起点も 1 本目を見出しの下に置くだけで、あとは同じ。
     * 最後の枝はフォールバックでもある: レコード行をユーザーが消して尻尾を失って
     * も、記録そのものは落とさない。
     */
    async startNextSession(timer: TimerInstance): Promise<SessionLine> {
        const tail = this.resolveTailRecord(timer);
        const previous = { tailRecordBlockId: timer.tailRecordBlockId, recordedChildTaskId: timer.recordedChildTaskId };

        const { line, blockId } = this.buildSessionPlaceholder(timer);
        // 書く前に尻尾を新しい行へ移す。走行中の尻尾は今のセッションの行で、
        // 前のセッションの記録ではない。行がスキャンに見えるまでは何も引けず、
        // end の書き足しも名前の書き込みも待つ — 書き終えた記録へ走行中の
        // end や名前を書かせないため。
        timer.tailRecordBlockId = blockId;
        timer.recordedChildTaskId = undefined;

        const written = tail
            ? await this.plugin.getTaskWriteService().insertSiblingAfterTask(tail.id, line)
            : await this.writeChildLine(timer, line);
        if (!written) {
            // 書けなかった。理由は書き込みの層が1回だけ通知済み。再開そのものを
            // 取り消すので（TimerLifecycle.resumeSession）、尻尾も戻す。
            timer.tailRecordBlockId = previous.tailRecordBlockId;
            timer.recordedChildTaskId = previous.recordedChildTaskId;
            return { written: false };
        }
        timer.lazyEndFloorMs = undefined;

        const file = tail?.file ?? timer.taskFile;
        const sessionTaskId = await this.adoptWrittenSession(timer, file, blockId);
        // 尻尾は 1 個。新しい行を書けた時点で前の行から id を外す。
        if (tail) await this.releaseTailId(timer, tail.file, tail.blockId);
        return { written: true, sessionTaskId };
    }

    /**
     * 尻尾でなくなった行から自動生成 `^id` を外す。
     *
     * 外すのは自分で付けたものだけ。ユーザーが手で書いた blockId は別用途の参照で、
     * タイマーが片付けてよいものではない。対象アンカーが同じ id を指していたなら
     * それも手放す — 行から消えた id を後で引きに行っても迷子になるだけ。
     */
    private async releaseTailId(
        timer: TimerInstance,
        filePath: string,
        blockId: string | undefined,
    ): Promise<void> {
        if (!blockId || !isTimerTargetId(blockId)) return;

        const taskId = await this.findSessionTaskId(filePath, blockId);
        if (!taskId) {
            logInfo(`[TimerRecorder] releaseTailId: tail ${blockId} not found in ${filePath}, nothing released (${describeTimerAnchor(timer)})`);
            return;
        }

        // 外せなかった id は行に残っている。対象アンカーも手放さない。
        if (!(await this.plugin.getTaskIndex().updateTask(taskId, { blockId: undefined }))) return;

        if (timer.timerTargetId === blockId) {
            // 対象アンカーを手放す瞬間。以後この timer は taskId / originalText の
            // 照合だけで対象を引くことになるので、後から追えるよう記録しておく。
            logInfo(`[TimerRecorder] releaseTailId: target anchor ${blockId} released from ${taskId}, timer now anchorless (${describeTimerAnchor(timer)})`);
            timer.timerTargetId = undefined;
            timer.autoGeneratedTargetId = false;
        }
    }

    /**
     * widget を閉じるときに尻尾の `^id` を外す（＝ ノートに残る自動 id を 0 個に
     * する）。記録そのものは残す — 消すのは目印だけ。
     */
    async clearTailRecordId(timer: TimerInstance): Promise<void> {
        const blockId = timer.tailRecordBlockId;
        if (!blockId) return;

        timer.tailRecordBlockId = undefined;
        await this.releaseTailId(timer, timer.taskFile, blockId);
    }

    /**
     * ✕ 破棄: 走行中の記録を捨てるとき、開始時に**自分が書いた**行も片付ける。
     *
     * 消すのは placeholder と断定できるときだけ（未完了・尻尾の id を持つ・終了
     * 時刻なし）。ユーザーが手を入れていたらそれはもう自分の行ではないので、
     * 目印の id だけ外して行は残す。
     *
     * self モードの 1 本目は対象タスク行そのものなので対象外。開始時に書いた
     * start 時刻も**巻き戻さない** — 破棄は「今回の走行を記録しない」の意であって
     * 対象タスクの日付操作までは含まないし、巻き戻しはユーザー編集との競合を
     * 持ち込む（tv-lead 裁定 2026-08-13）。
     */
    async discardRunningPlaceholder(timer: TimerInstance): Promise<void> {
        const blockId = timer.tailRecordBlockId;
        if (!blockId) return;

        const tail = this.resolveTailRecord(timer);
        timer.tailRecordBlockId = undefined;
        timer.recordedChildTaskId = undefined;

        if (!tail || tail.blockId !== blockId) return;

        const untouchedPlaceholder = tail.statusChar === ' ' && !tail.endTime;
        if (!untouchedPlaceholder) {
            await this.releaseTailId(timer, tail.file, blockId);
            return;
        }

        await this.plugin.getTaskIndex().deleteTask(tail.id);
    }

    /**
     * Update the task's start/end times directly (for 'self' recordMode).
     * This converts the task to SE-Timed type.
     */
    async updateTaskDirectly(timer: TimerInstance): Promise<boolean> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = this.stoppedAt(timer);
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const startDateStr = this.formatDate(startTime);
        const startTimeStr = this.formatTime(startTime);
        const endDateStr = this.formatDate(endTime);
        const endTimeStr = this.formatTime(endTime);

        if (timer.taskId) {
            const taskIndex = this.plugin.getTaskIndex();
            const task = this.resolver.resolveTvInline(timer);

            if (!task) {
                this.noticeResolveFailure(timer, 'updateTaskDirectly (self stop, not recorded)');
                return false;
            }

            const icon = this.getTimerIcon(timer);

            const updates: Partial<Task> = {
                startDate: startDateStr,
                startTime: startTimeStr,
                endDate: endDateStr,
                endTime: endTimeStr,
                statusChar: 'x',
                // blockId は**残す**。この行は self モードのレコードであると同時に
                // 尻尾でもあり、中断→再開の次セッションはこの id でしか隣を
                // 決められない（記録で content も日時も変わるため、originalText /
                // 内容一致では解決できなくなる）。自動生成 id は再開時か widget を
                // 閉じるときに外れる。ユーザーの手動 blockId はもとより保持。
                blockId: task.blockId,
                content: withTimerIcon(icon, task.content.trim()),
            };

            // 書けなかったときは、書き込みの層が理由を1回だけ通知済み。
            if (!(await taskIndex.updateTask(task.id, updates))) return false;

            // この行が最初のレコード＝尻尾。次の再開はここの隣に並ぶ。
            timer.tailRecordBlockId = task.blockId;
            timer.recordedChildTaskId = task.id;
        }

        const icon = this.getTimerIcon(timer);
        new Notice(t('notice.taskUpdated', { icon, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
        return true;
    }

    /**
     * Insert a child record line for the given timer.
     * The target is resolved with timerTargetId first.
     */
    /** @returns whether the record was written. Not written has been told to the user, once. */
    private async insertChildRecord(timer: TimerInstance, formattedLine: string): Promise<boolean> {
        // デイリーノートには器になるタスクが無いので見出しの下へ直接置く。開始時の
        // 1 本目は {@link createDailyLineAtStart} が通り、ここへ来るのは尻尾を
        // 見失ったときのフォールバック（1 行だけ足して記録を落とさない）。
        if (isDailyTimer(timer)) {
            return (await this.addTimerRecordToDailyNote(dailyDateOf(timer), formattedLine)) !== null;
        }

        const resolvedTask = this.resolver.resolveTvInline(timer);

        if (!resolvedTask) {
            this.noticeResolveFailure(timer, 'insertChildRecord (not recorded)');
            return false;
        }

        return this.plugin.getTaskWriteService().insertChildTask(resolvedTask.id, formattedLine);
    }

    /**
     * デイリーノートの見出しの下へ 1 行置き、書き込んだノートのパスを返す。
     */
    private async addTimerRecordToDailyNote(dateStr: string, taskLine: string): Promise<string | null> {
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date();
        date.setFullYear(y, m - 1, d);
        date.setHours(0, 0, 0, 0);

        return DailyNoteUtils.appendLineToDailyNote(
            this.app,
            date,
            taskLine,
            this.plugin.settings.dailyNoteHeader,
            this.plugin.settings.dailyNoteHeaderLevel,
            path => this.plugin.getTaskWriteService().writeChannel(path),
        );
    }

    /**
     * Create a minimal Task object for formatting.
     */
    private createTaskObject(
        label: string,
        startDate: string,
        startTime: string,
        endDate: string,
        endTime: string
    ): Task {
        return createTempTask({
            id: 'timer-temp',
            content: label,
            statusChar: 'x',
            startDate,
            startTime,
            endDate: endDate || undefined,
            endTime: endTime || undefined,
        });
    }

    private formatDate(d: Date): string {
        return DateUtils.getLocalDateString(d);
    }

    private formatTime(d: Date): string {
        return DateUtils.formatHHMM(d.getHours(), d.getMinutes());
    }

}
