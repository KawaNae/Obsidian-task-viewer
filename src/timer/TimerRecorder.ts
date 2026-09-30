/**
 * Timer Recorder
 *
 * Handles saving timer records to tasks or daily notes.
 */

import { type App, Notice } from 'obsidian';
import { t } from '../i18n';
import type { PluginContext } from '../PluginContext';
import { type Opening, type PendingRecord, type TimerInstance, dailyDateOf, describeTimerAnchor, isDailyTimer } from './TimerInstance';
import { putInPeriodicNote } from '../services/persistence/Notes';
import { dailyNotes } from '../utils/PeriodicNotes';
import { Destination } from '../services/persistence/Destination';
import { DateUtils } from '../utils/DateUtils';
import { type TaskLineFields, formatTaskLine } from '../services/parsing/TaskLineFormat';
import type { Task } from '../types';
import type { AnchoredRow } from '../services/operations/Operations';
import { TimeFormatter } from '../utils/TimeFormatter';
import { type TimerIcon, getTimerIcon, splitTimerIcon, withTimerIcon } from '../utils/TimerIcons';
import { decideLazyEnd } from './TimerLazyEnd';
import type { TimerStorageUtils } from './TimerStorageUtils';
import { logInfo, logWarn } from '../log/log';

/**
 * 開始を押したときの対象の写しと、書けたらタイマーの対象になる錨。行に錨が
 * 無ければ、開始の書き込みでその行に `rowId` を付ける。
 */
interface StartTarget {
    task: Task;
    target: string;
    rowId?: string;
}

export class TimerRecorder {
    private storageUtils: TimerStorageUtils;

    /**
     * @param persist タイマーを保存する。行を書く前に、書こうとしている行と書けた
     * あとの錨の姿（`opening`）を残すために呼ぶ。
     * @param openTimers 開いているタイマー。錨を外してよいかを決めるときに見る
     * （{@link mayTakeOff}）。
     */
    constructor(
        private app: App,
        private plugin: PluginContext,
        storageUtils: TimerStorageUtils,
        private persist: () => void,
        private openTimers: () => Iterable<TimerInstance>,
    ) {
        this.storageUtils = storageUtils;
    }

    /**
     * Record a completed Countup timer session.
     */
    async addCountupRecord(timer: TimerInstance, record: PendingRecord): Promise<boolean> {
        const elapsedSeconds = record.seconds;
        const endTime = new Date(record.endMs);
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const icon = this.getTimerIcon(timer);
        const fields = this.recordFields(
            this.recordLabel(timer),
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        if (!(await this.writeRecordLine(timer, fields))) return false;
        new Notice(t('notice.timerRecorded', { icon, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
        return true;
    }

    /**
     * Record a completed Countdown timer session.
     */
    async addCountdownRecord(timer: TimerInstance, record: PendingRecord): Promise<boolean> {
        const elapsedSeconds = record.seconds;
        const endTime = new Date(record.endMs);
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const icon = this.getTimerIcon(timer);
        const fields = this.recordFields(
            this.recordLabel(timer),
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        if (!(await this.writeRecordLine(timer, fields))) return false;
        new Notice(t('notice.countdownRecorded', { icon, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
        return true;
    }

    /**
     * Record a completed Interval timer session.
     * Pomodoro-origin intervals are recorded with 🍅 label.
     */
    async addIntervalRecord(timer: TimerInstance, record: PendingRecord): Promise<boolean> {
        const elapsedSeconds = record.seconds;
        const endTime = new Date(record.endMs);
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const isPomodoroSource = timer.timerType === 'interval' && timer.intervalSource === 'pomodoro';
        const icon = this.getTimerIcon(timer);

        const fields = this.recordFields(
            this.recordLabel(timer),
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        if (!(await this.writeRecordLine(timer, fields))) return false;
        const kind = isPomodoroSource ? 'Pomodoro' : 'Interval';
        new Notice(t('notice.kindRecorded', { icon, kind, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
        return true;
    }

    /**
     * ストップ時の記録の **唯一の入口**。書き先は尻尾（最後に書いた行）で選ぶ。
     *
     *   尻尾が対象の行そのもの → 対象の行をレコードに変形する（self の 1 本目）
     *   尻尾が自分で書いた行   → その行を閉じる（開始か再開で書いた走行中の行）
     *   尻尾を引けない         → レコードを 1 行足す（予備の記録。それが尻尾になる）
     *
     * `recordMode` や回数では選ばない。self モードでも 2 本目以降は自分で書いた
     * 兄弟レコードに走っており、対象タスク行はもう 1 本目のレコードとして確定して
     * いる — そこへ書き戻すと最初のセッションが上書きされて消える。どの行に走って
     * いるかを言うのは尻尾だけである。
     *
     * ここを通さずに `addCountdownRecord` / `addIntervalRecord` を直接呼ぶと、
     * 開始時に作った placeholder が更新されず 1 セッションが 2 行になる。停止経路は
     * 必ずこれを呼ぶこと。
     *
     * 時刻と長さは止めたときに固定した `record` のもので、押し直しても変わらない。
     * 尻尾はディスクの内容のとおりの読みで引く（{@link resolveTailRecord}）— 外の
     * 書き込みの通知が届かなくても、錨で引いた行を読みの鍵まで照合して通る。
     * ノートを読めなければ（一時的な EBUSY など）、尻尾が無いとは言えないので
     * レコードを足さず、書けなかったと答える。
     *
     * @returns 記録を書けたか（記録するものが無い idle は書けたと答える）。書けな
     * かったときは、その理由を1回だけ通知済みで、成功の通知は出していない。
     * 呼び出し側は記録待ちのまま残す。
     */
    async recordSessionEnd(timer: TimerInstance, record: PendingRecord): Promise<boolean> {
        if (!timer.tailRecordBlockId) return this.addRecord(timer, record);
        // self の 1 本目は、尻尾が対象の行そのもの。
        const direct = timer.tailRecordBlockId === timer.timerTargetId;
        const closed = await this.plugin.getOperations().updateByAnchor(timer.taskFile, timer.tailRecordBlockId,
            (tail) => direct ? this.closeTarget(timer, tail, record) : this.closeChild(timer, tail, record));
        switch (closed.kind) {
            case 'none': return this.addRecord(timer, record);
            case 'unreadable': return this.noticeUnreadable(timer, 'recordSessionEnd (not recorded)');
            // Not written: the write layer has said why, once.
            case 'not-written': return false;
        }
        const icon = this.getTimerIcon(timer);
        const duration = TimeFormatter.formatSeconds(record.seconds);
        new Notice(direct
            ? t('notice.taskUpdated', { icon, duration })
            : t('notice.kindRecorded', { icon, kind: this.getTimerKind(timer), duration }));
        return true;
    }

    /**
     * 尻尾を引けないときの予備の記録。idle は記録しない（書くものも失うものも無い）。
     * 言うのは記録の通知の1回だけ — 利用者に要るのは記録できたかで、どの行が受けたかではない。
     */
    private async addRecord(timer: TimerInstance, record: PendingRecord): Promise<boolean> {
        if (timer.tailRecordBlockId) {
            logWarn(`[TimerRecorder] recordSessionEnd: running line not found, adding a record instead (${describeTimerAnchor(timer)})`);
        }
        switch (timer.timerType) {
            case 'countup':
                return this.addCountupRecord(timer, record);
            case 'countdown':
                return this.addCountdownRecord(timer, record);
            case 'interval':
                return this.addIntervalRecord(timer, record);
            case 'idle':
                // No record for idle yet: nothing to write, nothing lost.
                return true;
            default:
                return true;
        }
    }

    /**
     * 開始の書き込み。タイマーは対象の行の錨（ファイルで 1 つだけの `^id`）で
     * 対象を引くので、行に錨が無ければこの書き込みで `^tv-t-` を付ける。付けるのは
     * 開始そのものと同じ 1 回の書き込みの中で、self は開始時刻の書き換え、child と
     * sibling は 1 本目の行の挿入と一緒に書く。照合は開始を押したときの写し
     * （`taskId` の名前、読みの鍵まで）である。
     *
     * デイリーノート起点は対象の行を持たないので、1 本目の行を見出しの下に書くだけ。
     *
     * @returns 書けたか。書けなければタイマーは始めない。理由は1回だけ通知済み。
     */
    async writeStart(timer: TimerInstance): Promise<boolean> {
        if (isDailyTimer(timer)) return this.writeFirstLine(timer, undefined, line => this.writeChildLine(timer, line));
        const start = this.startTarget(timer);
        if (!start) return false;
        switch (timer.recordMode) {
            case 'self': return this.startOnTarget(timer, start);
            case 'sibling': return this.startLine(timer, start, 'afterCompletedRun');
            default: return this.startLine(timer, start, 'firstChild');
        }
    }

    /**
     * 開始を押したときの対象の写しと、その行の錨（行に錨が無ければ、開始の書き込みで
     * 付ける `rowId`）。決めるだけで、タイマーには書けてから移す。
     *
     * 行の `^id` をほかの行も持っていれば、その行は錨にならず、行に `^id` は
     * 1 つしか置けないので付け足すこともできない。タイマーは始めない。
     */
    private startTarget(timer: TimerInstance): StartTarget | null {
        const task = this.plugin.getIndex().getTask(timer.taskId);
        if (!task) {
            this.noticeResolveFailure(timer, 'start (not started)');
            return null;
        }
        timer.taskFile = task.file;
        if (task.anchor) return { task, target: task.anchor };
        if (task.blockId) {
            logWarn(`[TimerRecorder] start: ^${task.blockId} is carried by another line too, not started (${describeTimerAnchor(timer)})`);
            new Notice(t('notice.timerTargetIdShared', { id: task.blockId }));
            return null;
        }
        const rowId = this.storageUtils.generateTimerTargetId();
        return { task, target: rowId, rowId };
    }

    /**
     * 行を書く書き込みが、書けたあとのタイマーに残す錨の姿（{@link Opening}）。
     * `puts` はこの書き込みで付ける錨、`takesOff` は外す錨で、書けたら
     * {@link TimerInstance.ownedAnchors} に記録する。
     */
    private opening(
        timer: TimerInstance,
        tail: string,
        change: { target?: string; puts?: string[]; takesOff?: string } = {},
    ): Opening {
        return {
            tail,
            target: change.target ?? timer.timerTargetId ?? null,
            owned: [...timer.ownedAnchors.filter(anchor => anchor !== change.takesOff), ...(change.puts ?? [])],
        };
    }

    /**
     * self の開始: 対象の行に開始時刻を書く（錨を付けるならそれも同じ書き込みで）。
     * - Timeline tasks (has startTime): parallel translation — preserve duration
     * - Allday tasks (no startTime): discard endDate/endTime, convert to S-Timed
     *
     * 対象の行が 1 本目の記録なので、尻尾は対象の錨そのもの。
     */
    private async startOnTarget(timer: TimerInstance, { task, target, rowId }: StartTarget): Promise<boolean> {
        const now = new Date();
        const updates: Partial<Task> = {
            startDate: this.formatDate(now),
            startTime: this.formatTime(now),
        };

        if (task.startTime) {
            // Timeline task (has time): parallel translation — preserve duration
            // Resolve implicit endDate for same-day notation (e.g., @dateThh:mm>hh:mm)
            const effectiveEndDate = task.endDate ?? (task.endTime ? task.startDate : undefined);

            if (task.startDate && effectiveEndDate && task.endTime) {
                const oldStart = DateUtils.toDateTime(task.startDate, task.startTime);
                const oldEnd = DateUtils.toDateTime(effectiveEndDate, task.endTime);
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
        if (rowId) updates.blockId = rowId;

        // 上書きする前の start を覚える（開始をずらすメニューの候補）。`opening` と
        // 一緒に書き込みの前に保存されるので、書けなければタイマーごと消える。
        timer.priorStartMs = this.startMsOf(task);

        return this.writeOpening(timer, this.opening(timer, target, { target, puts: rowId ? [rowId] : [] }),
            () => this.plugin.getOperations().updateTask(task.id, updates));
    }

    /**
     * 行を書く。書く前に、書けたあとの錨の姿 `next` を `opening` として保存し、
     * 書けたらタイマーに当てる（尻尾、対象、自分で付けた錨）。書けなければ何も
     * 動かない。書く途中で再読み込みされても、保存の `opening` の行を錨で引けば
     * 書けたかが分かる（{@link adoptOpening}）。書けたあとの保存は呼び出し側が持つ。
     */
    private async writeOpening(timer: TimerInstance, next: Opening, write: () => Promise<boolean>): Promise<boolean> {
        timer.opening = next;
        this.persist();
        const written = await write();
        timer.opening = null;
        if (written) this.apply(timer, next);
        return written;
    }

    /**
     * 書けた書き込みの錨の姿をタイマーに当てる。新しい行に走り始めたので、end の
     * 書き足しの門（`lazyEndFloorMs`）も引き直す。
     */
    private apply(timer: TimerInstance, next: Opening): void {
        timer.tailRecordBlockId = next.tail;
        timer.timerTargetId = next.target ?? undefined;
        timer.ownedAnchors = next.owned;
        timer.lazyEndFloorMs = undefined;
    }

    /**
     * 再読み込みのあと、保存に残った `opening` に答える。その行を錨で引けたら、
     * その書き込みは届いている — タイマーに当てる。引けなければ届いていない。
     * どちらでも `opening` は消す。推定でなく、ファイルに在る `^id` で答える。
     * ノートを読めなければ答えられないので、`opening` を残して次の再読み込みに
     * 任せる。
     *
     * @returns タイマーを変えたか。
     */
    async adoptOpening(timer: TimerInstance): Promise<boolean> {
        const opening = timer.opening;
        if (!opening) return false;
        const row = await this.rowByAnchor(timer, opening.tail);
        switch (row.kind) {
            case 'row':
                this.apply(timer, opening);
                break;
            case 'none':
                logInfo(`[TimerRecorder] adoptOpening: ${opening.tail} is not in ${timer.taskFile || '-'}, the write did not land (${describeTimerAnchor(timer)})`);
                break;
            case 'unreadable':
                logWarn(`[TimerRecorder] adoptOpening: ${timer.taskFile} could not be read, the opening is kept (${describeTimerAnchor(timer)})`);
                return false;
        }
        timer.opening = null;
        return true;
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
     * 書き足しが書けなかったときも、決めた次の見直しの時刻を返す。それはメモリの
     * 上だけの「次にいつ見直すか」の予定で、状態ではない。end の真の値は見直す
     * たびにファイル（実効 end）から読み直すので、書けなかった書き足しは次の
     * 見直しで古い end を読んでまた書き、何も失われない。書けるまで門を開けて
     * おくと、拒否が続く間は毎 tick 書き直して毎回通知が出る。
     *
     * @returns 次に見直す時刻（ミリ秒）。行を引けなかったときだけ undefined。
     */
    async extendRunningSession(timer: TimerInstance): Promise<number | undefined> {
        const tail = await this.resolveTailRecord(timer);
        if (tail.kind !== 'row') return undefined;
        const target = tail.task;

        const display = this.plugin.getTaskReadService().getDisplayTask(target.id);
        if (!display?.effectiveEndDate || !display.effectiveEndTime) return undefined;

        const effectiveEndMs = DateUtils.toDateTime(display.effectiveEndDate, display.effectiveEndTime).getTime();
        if (Number.isNaN(effectiveEndMs)) return undefined;

        const decision = decideLazyEnd(Date.now(), effectiveEndMs);
        if (decision.kind === 'hold') return decision.floorMs;

        const end = new Date(decision.endMs);
        // 書けたかは問わない。書けなければ行の end は古いままで、次の見直しで
        // それを読んでまた書く。拒否の通知は書き込みの層が出す。
        await this.plugin.getOperations().updateTask(target.id, {
            endDate: this.formatDate(end),
            endTime: this.formatTime(end),
        });
        return decision.endMs;
    }

    /**
     * 走っている区間の開始をずらす: 走行の行（尻尾）の start を `startMs` に書き直す。
     * タイマーの `startTimeMs` は、これが書けてから呼び出し側が動かす
     * （`TimerLifecycle.offsetStart`）。
     *
     * 規則は「走行の行の start を、ずらした時刻にする」の1つで、mode で分けない。
     * self の 1 本目は止めたときに start を `end − 経過` で書き直すので、ここで
     * 書かなくても記録は合うが、走っている間の行とタイムラインが実際の開始を示す
     * よう同じく書く。child、sibling、▶ のあとの行は止めたときに start を書かない
     * ので、ここで書かなければ記録の start と経過が食い違う。
     *
     * 尻尾を引けなければ書く行が無い。止めたときの予備の記録（{@link addRecord}）は
     * start を経過から逆算するので、タイマーだけが動けば記録は合う。
     *
     * @returns 書けたか（書く行が無いときは書けたと答える）。書けなかったときは、
     * 理由を1回だけ通知済み。
     */
    async moveRunningStart(timer: TimerInstance, startMs: number): Promise<boolean> {
        if (!timer.tailRecordBlockId) return this.noRunningLine(timer);
        const start = new Date(startMs);
        const moved = await this.plugin.getOperations().updateByAnchor(timer.taskFile, timer.tailRecordBlockId, (row) => {
            const updates: Partial<Task> = {
                startDate: this.formatDate(start),
                startTime: this.formatTime(start),
            };
            // 日付の無い end（`@…T10:20>11:20`）は start の日付で読まれる。start を前日へ
            // ずらしても end が動かないよう、今の日付を書き出しておく。
            if (row.endTime && !row.endDate && row.startDate) updates.endDate = row.startDate;
            return updates;
        });
        switch (moved.kind) {
            case 'unreadable': return this.noticeUnreadable(timer, 'moveRunningStart (not moved)');
            case 'none': return this.noRunningLine(timer);
            // 書けなかったときは、書き込みの層が理由を1回だけ通知済み。
            case 'not-written': return false;
        }
        // end の無い行の実効 end は start から決まる。書き足しの門を引き直す。
        timer.lazyEndFloorMs = undefined;
        return true;
    }

    /** 開始をずらす走行の行が無い: タイマーだけが動く。 */
    private noRunningLine(timer: TimerInstance): boolean {
        logInfo(`[TimerRecorder] moveRunningStart: no running line, only the timer moves (${describeTimerAnchor(timer)})`);
        return true;
    }

    /**
     * 行の start（日付と時刻）のミリ秒。時刻の無い start は null（覚える時刻が無い）。
     */
    private startMsOf(task: Task): number | null {
        if (!task.startDate || !task.startTime) return null;
        const ms = DateUtils.toDateTime(task.startDate, task.startTime).getTime();
        return Number.isNaN(ms) ? null : ms;
    }

    /**
     * 走行中セッションの行（placeholder）を組み立てる。
     *
     * 開始時刻だけを持つ未完了行で、`blockId` は書き込んだ後に「どの行が今の
     * セッションか」を引き直すための目印（＝ 尻尾アンカー）。セッション行の形は
     * ここが唯一の持ち主で、1 本目を挿す経路（{@link startLine}）と
     * 兄弟に挿す経路（{@link startNextSession}）が同じ行を使う。
     *
     * 名前は**対象タスクの名前を継ぐ**。セッションは同じ作業の分割であって別物
     * ではないので、レコードが無名（アイコンだけ）になると後から読めない。
     * デイリーノート起点だけは継ぐ相手が無く、空名で始めて widget で付けさせる。
     */
    buildSessionPlaceholder(timer: TimerInstance, startMs = Date.now()): { line: string; blockId: string } {
        const now = new Date(startMs);
        const blockId = this.storageUtils.generateTimerTargetId();

        const fields = this.recordFields(
            this.sessionName(timer),
            this.formatDate(now),
            this.formatTime(now),
            '', ''
        );

        return { line: formatTaskLine({ ...fields, statusChar: ' ', blockId }), blockId };
    }

    /**
     * child と sibling の開始: 1 本目のセッション行を `place` に書く（child は対象の
     * 子の先頭、sibling は完了済みの連なりの末尾）。対象の行に錨を付けるなら同じ
     * 書き込みで。
     *
     * sibling は `[x]` のタスクから「続きを開始」したときの 1 本目で、起点の行その
     * ものは触らない（既に完了した事実）。どこまでが「連続する完了済み」かは index
     * のスナップショットではなくファイルの生の行を見ないと決まらないので、位置決めは
     * 書き込み層の `afterCompletedRun` が担う。
     *
     * @returns 書けたか。書けなければ理由は1回だけ通知済み。
     */
    private startLine(timer: TimerInstance, start: StartTarget, place: 'firstChild' | 'afterCompletedRun'): Promise<boolean> {
        return this.writeFirstLine(timer, start, line =>
            this.plugin.getOperations().insertLine(start.task.id, line, place, start.rowId));
    }

    /**
     * 1 本目のセッション行を `write` で書き、書けたら尻尾として引き受ける。対象の
     * 錨（`start`）も書けたときにタイマーへ移す。書いたファイルは `taskFile`
     * （開始で対象の行のファイル、デイリーノートは書いたノート）。
     */
    private async writeFirstLine(
        timer: TimerInstance,
        start: StartTarget | undefined,
        write: (line: string) => Promise<boolean>,
    ): Promise<boolean> {
        const { line, blockId } = this.buildSessionPlaceholder(timer);
        const puts = start?.rowId ? [blockId, start.rowId] : [blockId];
        return this.writeOpening(timer, this.opening(timer, blockId, { target: start?.target, puts }), () => write(line));
    }

    /**
     * 行を対象タスクの先頭の子として書く（錨で対象を引く）。書けなければ理由は
     * 1回だけ通知済み。
     *
     * デイリーノート起点は器になるタスクが無いので、設定の見出しの下へ行を直接置く。
     * 書いた後にノートのパスを `taskFile` へ引き取るのが要点で、これで尻尾の解決
     * （ファイルで絞る）と 2 本目以降の兄弟挿入が通常タスクと同じ経路に乗る。
     */
    private async writeChildLine(timer: TimerInstance, line: string): Promise<boolean> {
        if (isDailyTimer(timer)) {
            const filePath = await this.addTimerRecordToDailyNote(dailyDateOf(timer), line);
            if (filePath) timer.taskFile = filePath;
            return filePath !== null;
        }
        const target = await this.resolveTarget(timer);
        switch (target.kind) {
            case 'none':
                this.noticeResolveFailure(timer, 'writeChildLine (not written)');
                return false;
            case 'unreadable':
                return this.noticeUnreadable(timer, 'writeChildLine (not written)');
        }
        return this.plugin.getOperations().insertLine(target.task.id, line, 'firstChild');
    }

    /**
     * 走行中の行（尻尾の `child`）を、終わりの時刻と完了で閉じる書き換え。
     */
    private closeChild(timer: TimerInstance, child: Task, record: PendingRecord): Partial<Task> {
        const endTime = new Date(record.endMs);
        // 名前は対象タスクから継ぐので、既にアイコン付きの行（完了済みレコードの
        // 「続き」など）を起点にすると二重に付く。付け直しの規則は
        // {@link withTimerIcon} が持つ。
        const content = withTimerIcon(this.getTimerIcon(timer), child.content.trim());
        return {
            content,
            endDate: this.formatDate(endTime),
            endTime: this.formatTime(endTime),
            statusChar: 'x',
            // `^id` は**残す**。記録を書き終えてもこの行は尻尾のままで、次の再開は
            // ここを起点に兄弟を挿す。外すのは尻尾でなくなるとき（再開）と
            // widget を閉じるときだけ。
            blockId: child.blockId,
        };
    }

    /**
     * 対象を引けなかったことを伝える。読み取り専用の形式は開始の前に止めて
     * いるので（TimerWidget.startTimer）、ここに来るのは行を見失ったときだけ。
     */
    private noticeResolveFailure(timer: TimerInstance, site: string): void {
        logWarn(`[TimerRecorder] ${site}: timer target not found (${describeTimerAnchor(timer)})`);
        new Notice(t('notice.timerTargetNotFound'));
    }

    /**
     * 行を引くノートを読めなかったことを伝える（`AnchoredRow` の `unreadable`）。
     * 行が無いとは言えないので、書かずに止める。書けなかったと答える呼び手の
     * 通知の1回（名前の書き出し `TimerContentBinding` も使う）。
     *
     * @returns 書けなかった（false）。
     */
    noticeUnreadable(timer: TimerInstance, site: string): false {
        logWarn(`[TimerRecorder] ${site}: ${timer.taskFile} could not be read (${describeTimerAnchor(timer)})`);
        new Notice(t('notice.notReadable', { subject: timer.taskName }));
        return false;
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
        const tail = this.tailInIndex(timer);
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

    /**
     * タイマーの対象の行。対象の錨（`timerTargetId`、開始の書き込みで決まる）で
     * 引く — 錨はファイルで 1 つだけの `^id` なので、読み直しをまたいでも同じ行を
     * 指し、双子も重複も引かない。書くために引くので、ディスクの内容のとおりの
     * 読みで引く（{@link rowByAnchor}）。デイリーノート起点は対象を持たない。
     */
    async resolveTarget(timer: TimerInstance): Promise<AnchoredRow> {
        if (!timer.timerTargetId) return { kind: 'none' };
        return this.rowByAnchor(timer, timer.timerTargetId);
    }

    /**
     * タイマーが最後に書いたレコード行（＝ 尻尾）。尻尾の錨 `tailRecordBlockId`
     * で引く — 行番号ベースの task id はユーザーの編集やリロードで腐るのに対し、
     * `^id` はファイルに書いてあるものが正になる。書くために引くので、ディスクの
     * 内容のとおりの読みで引く（{@link rowByAnchor}）。
     *
     * self は 1 本目のレコードが対象の行そのものなので、開始の書き込みで尻尾を
     * 対象の錨に置く（{@link startOnTarget}）。2 本目からは自分で書いた行が尻尾。
     */
    async resolveTailRecord(timer: TimerInstance): Promise<AnchoredRow> {
        if (!timer.tailRecordBlockId) return { kind: 'none' };
        return this.rowByAnchor(timer, timer.tailRecordBlockId);
    }

    /**
     * `taskFile` で錨 `anchor` を持つ行を、ディスクの内容のとおりの読みで引く。
     * API の `path#^id` と同じ1つの口（`Operations.freshByAnchor`）を通る。
     * 行が無い（`none`）とノートを読めない（`unreadable`）は分けて答える —
     * 読めないだけで行が無いとみなすと、閉じるはずの行の代わりにレコードを足す。
     */
    private rowByAnchor(timer: TimerInstance, anchor: string): Promise<AnchoredRow> {
        return this.plugin.getOperations().freshByAnchor(timer.taskFile, anchor);
    }

    /**
     * 尻尾の行の、索引の最後の読みでの写し（`TaskIndex.getTaskByAnchor`）。書く
     * ためでなく、名前を見せるための読み。書くときは {@link resolveTailRecord}。
     */
    tailInIndex(timer: TimerInstance): Task | undefined {
        if (!timer.tailRecordBlockId) return undefined;
        return this.plugin.getIndex().getTaskByAnchor(timer.taskFile, timer.tailRecordBlockId);
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
    async startNextSession(timer: TimerInstance, startMs = Date.now()): Promise<boolean> {
        const found = await this.resolveTailRecord(timer);
        // 読めなければ尻尾が無いとは言えない。フォールバックの子を書かずに止める。
        if (found.kind === 'unreadable') return this.noticeUnreadable(timer, 'startNextSession (not started)');
        const tail = found.kind === 'row' ? found.task : undefined;
        const { line, blockId } = this.buildSessionPlaceholder(timer, startMs);

        // 尻尾は 1 個。前の行の錨は、外してよければ（{@link mayTakeOff}）新しい行と
        // 同じ書き込みで外す。対象の錨は外さない（self の 1 本目の記録は対象の行
        // そのもの）: 対象の行には走っている間ずっと錨があり、閉じるときに片付ける。
        const releases = !!tail && this.mayTakeOff(timer, timer.tailRecordBlockId!, [timer.timerTargetId]);
        const next = this.opening(timer, blockId, { puts: [blockId], takesOff: releases ? timer.tailRecordBlockId : undefined });
        // 書けなければ、理由は書き込みの層が1回だけ通知済みで、尻尾は動かない。
        return this.writeOpening(timer, next, () => tail
            ? this.plugin.getOperations().insertLine(tail.id, line, 'afterSubtree', releases ? null : undefined)
            : this.writeChildLine(timer, line));
    }

    /**
     * タイマーが錨 `anchor` を外してよいか。規則はここ1つ: 外してよいのは、自分の
     * 書き込みで付けた錨（{@link TimerInstance.ownedAnchors}）だけで、開いている
     * どのタイマーもその錨を対象にも尻尾にも持っていないときだけ。`timer` 自身が
     * このあとも持つ錨は `keeps` で言う。
     *
     * ユーザーが手で書いた `^id` や、ほかのタイマーが付けた `^id` は、id の形が
     * 同じでも外さない。ほかのタイマーが対象か尻尾にしている錨を外すと、そのタイマーは
     * 自分の行を引けなくなる。
     */
    private mayTakeOff(timer: TimerInstance, anchor: string, keeps: readonly (string | undefined)[]): boolean {
        if (!timer.ownedAnchors.includes(anchor)) return false;
        if (keeps.includes(anchor)) return false;
        for (const open of this.openTimers()) {
            if (open.id === timer.id || open.taskFile !== timer.taskFile) continue;
            if (open.timerTargetId === anchor || open.tailRecordBlockId === anchor) return false;
        }
        return true;
    }

    /** 錨 `anchor` の行からその `^id` を外す。行を引けなければ何もしない。 */
    private async takeOff(timer: TimerInstance, anchor: string): Promise<void> {
        const row = await this.plugin.getOperations().updateByAnchor(timer.taskFile, anchor, { blockId: undefined });
        if (row.kind === 'none' || row.kind === 'unreadable') {
            logInfo(`[TimerRecorder] takeOff: ${anchor} ${row.kind === 'none' ? 'not found in' : 'not looked up, could not read'} ${timer.taskFile}, nothing taken off (${describeTimerAnchor(timer)})`);
        }
    }

    /**
     * widget を閉じたあと、このタイマーが付けた `^id` を外す（対象の行と尻尾の行）。
     * 記録そのものは残す — 消すのは目印だけ。ほかのタイマーがまだ持つ錨は残す
     * （{@link mayTakeOff}）。
     */
    async releaseAnchors(timer: TimerInstance): Promise<void> {
        for (const anchor of timer.ownedAnchors) {
            if (this.mayTakeOff(timer, anchor, [])) await this.takeOff(timer, anchor);
        }
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
     *
     * 行を消すのも錨を外すのと同じ規則に乗る（{@link mayTakeOff}）: 自分で付けた
     * 錨の行で、ほかのタイマーが持っていないときだけ。self の 1 本目は対象の錨
     * そのものなので、ここでは触らない（閉じるときに片付く）。
     */
    async discardRunningPlaceholder(timer: TimerInstance): Promise<void> {
        const blockId = timer.tailRecordBlockId;
        if (!blockId || !this.mayTakeOff(timer, blockId, [timer.timerTargetId])) return;

        const found = await this.resolveTailRecord(timer);
        if (found.kind !== 'row') return;
        const tail = found.task;

        const untouchedPlaceholder = tail.statusChar === ' ' && !tail.endTime;
        if (!untouchedPlaceholder) {
            await this.takeOff(timer, blockId);
            return;
        }

        await this.plugin.getOperations().deleteTask(tail.id);
    }

    /**
     * self の 1 本目: 尻尾である対象の行（`task`）を、記録の開始と終わりと完了に
     * 書き換える書き換え。This converts the task to SE-Timed type.
     */
    private closeTarget(timer: TimerInstance, task: Task, record: PendingRecord): Partial<Task> {
        const elapsedSeconds = record.seconds;
        const endTime = new Date(record.endMs);
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);
        const icon = this.getTimerIcon(timer);
        // ■ で閉じる記録は、自分で付けた錨をこの書き込みで外す（外してよければ。
        // {@link mayTakeOff}）。行を完了させるこの書き込みは同じ書き込みで発火し、
        // move は行を `^id` ごと運ぶので、あとから外すと錨が運ばれた先に残る。
        const closes = record.then === 'close' && !!task.blockId && this.mayTakeOff(timer, task.blockId, []);

        const updates: Partial<Task> = {
            startDate: this.formatDate(startTime),
            startTime: this.formatTime(startTime),
            endDate: this.formatDate(endTime),
            endTime: this.formatTime(endTime),
            statusChar: 'x',
            // ⏸ では blockId を**残す**。この行は self モードのレコードであると同時に
            // 尻尾でもあり、中断→再開の次セッションはこの錨で隣を決める
            // （行を時間を越えて追えるのは錨だけである）。ユーザーの手動
            // blockId はもとより保持。
            blockId: closes ? undefined : task.blockId,
            content: withTimerIcon(icon, task.content.trim()),
        };

        return updates;
    }

    /**
     * 尻尾を引けないときの予備の記録（{@link addCountupRecord} 系）。タイマーが書く
     * ほかの行と同じく、錨を付けて {@link writeOpening} を通し、書けたらそれが尻尾に
     * なる — 次の ▶ はその隣に並ぶ。置き場所は対象の先頭の子（{@link writeChildLine}）。
     *
     * @returns whether the record was written. Not written has been told to the user, once.
     */
    private async writeRecordLine(timer: TimerInstance, record: TaskLineFields): Promise<boolean> {
        const anchor = this.storageUtils.generateTimerTargetId();
        const line = formatTaskLine({ ...record, blockId: anchor });
        return this.writeOpening(timer, this.opening(timer, anchor, { puts: [anchor] }), () => this.writeChildLine(timer, line));
    }

    /**
     * デイリーノートの見出しの下へ 1 行置き、書き込んだノートのパスを返す。
     */
    private async addTimerRecordToDailyNote(dateStr: string, taskLine: string): Promise<string | null> {
        return putInPeriodicNote(
            this.app,
            dailyNotes(this.app),
            dateStr,
            taskLine,
            Destination.taskSection(this.plugin.settings),
            this.plugin.getOperations().writeChannel,
        );
    }

    /**
     * The fields of a record line the timer writes: done, with its span.
     */
    private recordFields(
        label: string,
        startDate: string,
        startTime: string,
        endDate: string,
        endTime: string
    ): TaskLineFields {
        return {
            content: label,
            statusChar: 'x',
            startDate,
            startTime,
            endDate: endDate || undefined,
            endTime: endTime || undefined,
        };
    }

    private formatDate(d: Date): string {
        return DateUtils.getLocalDateString(d);
    }

    private formatTime(d: Date): string {
        return DateUtils.formatHHMM(d.getHours(), d.getMinutes());
    }

}
