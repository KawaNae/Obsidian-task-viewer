/**
 * Timer Recorder
 *
 * Handles saving timer records to tasks or daily notes.
 */

import { type App, Notice } from 'obsidian';
import { t } from '../i18n';
import type TaskViewerPlugin from '../main';
import { type TimerInstance, dailyDateOf, getTimerElapsedSeconds, isDailyTimer } from './TimerInstance';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { TaskParser } from '../services/parsing/TaskParser';
import { type Task, isTvFile } from '../types';
import { createTempTask } from '../services/data/createTempTask';
import { TimeFormatter } from '../utils/TimeFormatter';
import { TimerTaskResolver } from './TimerTaskResolver';
import { isTimerTargetId } from '../utils/TimerTargetIdUtils';
import { type TimerIcon, getTimerIcon, splitTimerIcon, withTimerIcon } from '../utils/TimerIcons';
import { decideLazyEnd } from './TimerLazyEnd';
import type { TimerStorageUtils } from './TimerStorageUtils';
import { logWarn } from '../log/log';

export class TimerRecorder {
    private resolver: TimerTaskResolver;
    private storageUtils: TimerStorageUtils;

    constructor(
        private app: App,
        private plugin: TaskViewerPlugin,
        storageUtils: TimerStorageUtils
    ) {
        this.resolver = new TimerTaskResolver(plugin);
        this.storageUtils = storageUtils;
    }

    /**
     * Record a completed Countup timer session.
     */
    async addCountupRecord(timer: TimerInstance): Promise<void> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = new Date();
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

        await this.insertChildRecord(timer, formattedLine);
        new Notice(t('notice.timerRecorded', { icon, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
    }

    /**
     * Record a completed Countdown timer session.
     */
    async addCountdownRecord(timer: TimerInstance): Promise<void> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = new Date();
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

        await this.insertChildRecord(timer, formattedLine);
        new Notice(t('notice.countdownRecorded', { icon, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
    }

    /**
     * Record a completed Interval timer session.
     * Pomodoro-origin intervals are recorded with 🍅 label.
     */
    async addIntervalRecord(timer: TimerInstance): Promise<void> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = new Date();
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

        await this.insertChildRecord(timer, formattedLine);
        const kind = isPomodoroSource ? 'Pomodoro' : 'Interval';
        new Notice(t('notice.kindRecorded', { icon, kind, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
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
     */
    async recordSessionEnd(timer: TimerInstance): Promise<void> {
        if (!timer.recordedChildTaskId && timer.recordMode === 'self' && timer.sessionCount === 0) {
            await this.updateTaskDirectly(timer);
            return;
        }
        await this.addSessionRecord(timer);
    }

    /**
     * Record for stopwatch-style modes; idle is intentionally ignored.
     * If a child task was created at start (recordedChildTaskId), update it instead.
     */
    async addSessionRecord(timer: TimerInstance): Promise<void> {
        if (timer.recordedChildTaskId) {
            await this.updateChildAtEnd(timer);
            return;
        }
        switch (timer.timerType) {
            case 'countup':
                await this.addCountupRecord(timer);
                break;
            case 'countdown':
                await this.addCountdownRecord(timer);
                break;
            case 'interval':
                await this.addIntervalRecord(timer);
                break;
            case 'idle':
                // No record for idle yet.
                break;
            default:
                break;
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
        const task = isTvFile(timer)
            ? this.resolver.resolveTvFile(timer)
            : this.resolver.resolveTvInline(timer);

        if (!task) {
            // 開始時の書き込みが落ちるとセッションを丸ごと失う。黙って戻ると
            // ユーザーは計測を終えるまで気づけないので、書き込めない形式だと
            // 分かっている場合はその場で伝える。行を見失っただけの場合は
            // 再スキャンで直ることがあるのでログに留める。
            const reason = this.resolver.explainFailure(timer);
            if (reason === 'read-only') {
                new Notice(t('notice.timerTargetReadOnly'));
            } else {
                logWarn('[TimerRecorder] start-time write skipped: timer target not resolved');
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
        if (isDailyTimer(timer)) return this.createDailyLineAtStart(timer);

        const { line, blockId } = this.buildSessionPlaceholder(timer);
        await this.insertChildRecord(timer, line);

        const parentTask = isTvFile(timer)
            ? this.resolver.resolveTvFile(timer)
            : this.resolver.resolveTvInline(timer);
        if (!parentTask) return undefined;

        return this.adoptWrittenSession(timer, parentTask.file, blockId);
    }

    /**
     * デイリーノート起点の 1 本目。
     *
     * 器になるタスクが無いので、設定の見出しの下へ行を直接置く。書いた後にノートの
     * パスを `taskFile` へ引き取るのが要点で、これで尻尾の解決（ファイルで絞る）と
     * 2 本目以降の兄弟挿入が通常タスクと同じ経路に乗る。
     */
    private async createDailyLineAtStart(timer: TimerInstance): Promise<string | undefined> {
        const { line, blockId } = this.buildSessionPlaceholder(timer);
        const filePath = await this.addTimerRecordToDailyNote(dailyDateOf(timer), line);
        if (!filePath) return undefined;

        timer.taskFile = filePath;
        return this.adoptWrittenSession(timer, filePath, blockId);
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
        if (inserted < 0) return undefined;

        return this.adoptWrittenSession(timer, anchor.file, blockId);
    }

    /**
     * 書き込んだセッション行を尻尾として引き受ける。
     *
     * 引き直せたときだけ尻尾アンカーを進めるのが要点。書き込みが不発だった場合に
     * 更新してしまうと、実在しない id を指したまま次の再開が迷子になる。
     */
    private async adoptWrittenSession(
        timer: TimerInstance,
        filePath: string,
        blockId: string,
    ): Promise<string | undefined> {
        const sessionTaskId = await this.findSessionTaskId(filePath, blockId);
        if (!sessionTaskId) return undefined;

        timer.tailRecordBlockId = blockId;
        timer.recordedChildTaskId = sessionTaskId;
        // 新しい行に走り始めたので、end 書き足しの門は引き直す。
        timer.lazyEndFloorMs = undefined;
        return sessionTaskId;
    }

    /**
     * Update the child task created at timer start with end time and completion.
     */
    private async updateChildAtEnd(timer: TimerInstance): Promise<void> {
        const taskIndex = this.plugin.getTaskIndex();
        const child = taskIndex.getTask(timer.recordedChildTaskId!);

        if (!child) {
            // Fallback: child was deleted, create a new record
            new Notice(t('notice.childTaskNotFound'));
            timer.recordedChildTaskId = undefined;
            switch (timer.timerType) {
                case 'countup': await this.addCountupRecord(timer); break;
                case 'countdown': await this.addCountdownRecord(timer); break;
                case 'interval': await this.addIntervalRecord(timer); break;
                default: break;
            }
            return;
        }

        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = new Date();

        const icon = this.getTimerIcon(timer);
        // 名前は対象タスクから継ぐので、既にアイコン付きの行（完了済みレコードの
        // 「続き」など）を起点にすると二重に付く。付け直しの規則は
        // {@link withTimerIcon} が持つ。
        const content = withTimerIcon(icon, child.content.trim());

        await taskIndex.updateTask(child.id, {
            content,
            endDate: this.formatDate(endTime),
            endTime: this.formatTime(endTime),
            statusChar: 'x',
            // `^id` は**残す**。記録を書き終えてもこの行は尻尾のままで、次の再開は
            // ここを起点に兄弟を挿す。外すのは尻尾でなくなるとき（再開）と
            // widget を閉じるときだけ。
            blockId: child.blockId,
        });

        const kind = this.getTimerKind(timer);
        new Notice(t('notice.kindRecorded', { icon, kind, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
    }

    /**
     * 対象を引けなかったことを、原因に応じた文言で伝える。
     *
     * 読み取り専用の形式（day-planner / tasks-plugin）は最初から書き込めない。
     * 「削除、移動、またはリネームされた可能性」と言うと、実際には在る行を
     * 探しに行かせることになる。
     */
    private noticeResolveFailure(timer: TimerInstance): void {
        const reason = this.resolver.explainFailure(timer);
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
        return isTvFile(timer)
            ? this.resolver.resolveTvFile(timer)
            : this.resolver.resolveTvInline(timer);
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
     */
    resolveTailRecord(timer: TimerInstance): Task | undefined {
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

        return timer.recordMode === 'self' ? this.resolveAnchorTask(timer) : undefined;
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
    async startNextSession(timer: TimerInstance): Promise<string | undefined> {
        const tail = this.resolveTailRecord(timer);
        // 新しい行を取れるまでは「走行中の行は無い」。書き込みが不発に終わったとき、
        // 前のセッションの行を走行中と誤認して上書きさせないため。
        timer.recordedChildTaskId = undefined;

        if (!tail || isTvFile(tail)) return this.createChildAtStart(timer);

        const previousBlockId = tail.blockId;
        const { line, blockId } = this.buildSessionPlaceholder(timer);
        const inserted = await this.plugin.getTaskWriteService()
            .insertSiblingAfterTask(tail.id, line);
        if (inserted < 0) return this.createChildAtStart(timer);

        const sessionTaskId = await this.adoptWrittenSession(timer, tail.file, blockId);
        if (sessionTaskId) {
            // 尻尾は 1 個。新しい行が尻尾になった時点で前の行から id を外す。
            await this.releaseTailId(timer, tail.file, previousBlockId);
        }
        return sessionTaskId;
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
        if (!taskId) return;

        await this.plugin.getTaskIndex().updateTask(taskId, { blockId: undefined });

        if (timer.timerTargetId === blockId) {
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
    async updateTaskDirectly(timer: TimerInstance): Promise<void> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const startDateStr = this.formatDate(startTime);
        const startTimeStr = this.formatTime(startTime);
        const endDateStr = this.formatDate(endTime);
        const endTimeStr = this.formatTime(endTime);

        if (timer.taskId) {
            const taskIndex = this.plugin.getTaskIndex();
            const task = isTvFile(timer)
                ? this.resolver.resolveTvFile(timer)
                : this.resolver.resolveTvInline(timer);

            if (!task) {
                this.noticeResolveFailure(timer);
                return;
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

            await taskIndex.updateTask(task.id, updates);

            // この行が最初のレコード＝尻尾。次の再開はここの隣に並ぶ。
            timer.tailRecordBlockId = task.blockId;
            timer.recordedChildTaskId = task.id;
        }

        const icon = this.getTimerIcon(timer);
        new Notice(t('notice.taskUpdated', { icon, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
    }

    /**
     * Insert a child record line for the given timer.
     * Frontmatter/inline both resolve target with timerTargetId first.
     */
    private async insertChildRecord(timer: TimerInstance, formattedLine: string): Promise<void> {
        // デイリーノートには器になるタスクが無いので見出しの下へ直接置く。開始時の
        // 1 本目は {@link createDailyLineAtStart} が通り、ここへ来るのは尻尾を
        // 見失ったときのフォールバック（1 行だけ足して記録を落とさない）。
        if (isDailyTimer(timer)) {
            await this.addTimerRecordToDailyNote(dailyDateOf(timer), formattedLine);
            return;
        }

        const resolvedTask = isTvFile(timer)
            ? this.resolver.resolveTvFile(timer)
            : this.resolver.resolveTvInline(timer);

        if (!resolvedTask) {
            this.noticeResolveFailure(timer);
            return;
        }

        await this.plugin.getTaskWriteService().insertChildTask(resolvedTask.id, formattedLine);
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
            this.plugin.settings.dailyNoteHeaderLevel
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
        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private formatTime(d: Date): string {
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }

}
