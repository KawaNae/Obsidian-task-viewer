/**
 * Timer Recorder
 *
 * Handles saving timer records to tasks or daily notes.
 */

import { type App, Notice } from 'obsidian';
import { t } from '../i18n';
import type { PluginContext } from '../PluginContext';
import { type Opening, type PendingRecord, type TimerInstance, dailyDateOf, describeTimerAnchor, isDailyTimer } from './TimerInstance';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { DateUtils } from '../utils/DateUtils';
import { TaskParser } from '../services/parsing/TaskParser';
import type { Task } from '../types';
import { createTempTask } from '../services/data/createTempTask';
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
        const taskObj = this.createTaskObject(
            this.recordLabel(timer),
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        if (!(await this.writeRecordLine(timer, taskObj))) return false;
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
        const taskObj = this.createTaskObject(
            this.recordLabel(timer),
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        if (!(await this.writeRecordLine(timer, taskObj))) return false;
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

        const taskObj = this.createTaskObject(
            this.recordLabel(timer),
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        if (!(await this.writeRecordLine(timer, taskObj))) return false;
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
     * 書く前にそのファイルのスキャンを 1 回待つ — 外の書き込みのすぐあとは、読みが
     * 追いつくまで照合が拒否するため（錨で引いた行を読みの鍵まで照合する）。
     *
     * @returns 記録を書けたか（記録するものが無い idle は書けたと答える）。書けな
     * かったときは、その理由を1回だけ通知済みで、成功の通知は出していない。
     * 呼び出し側は記録待ちのまま残す。
     */
    async recordSessionEnd(timer: TimerInstance, record: PendingRecord): Promise<boolean> {
        if (timer.taskFile) await this.plugin.getTaskIndex().waitForScan(timer.taskFile);
        const tail = this.resolveTailRecord(timer);
        if (!tail) return this.addRecord(timer, record);
        if (timer.tailRecordBlockId === timer.timerTargetId) return this.updateTaskDirectly(timer, tail, record);
        return this.updateChildAtEnd(timer, tail, record);
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
        const task = this.plugin.getTaskIndex().getTask(timer.taskId);
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
        if (rowId) updates.blockId = rowId;

        return this.writeOpening(timer, this.opening(timer, target, { target, puts: rowId ? [rowId] : [] }),
            () => this.plugin.getTaskIndex().updateTask(task.id, updates));
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
     *
     * @returns タイマーを変えたか。
     */
    async adoptOpening(timer: TimerInstance): Promise<boolean> {
        const opening = timer.opening;
        if (!opening) return false;
        const taskIndex = this.plugin.getTaskIndex();
        if (timer.taskFile) await taskIndex.waitForScan(timer.taskFile);
        if (taskIndex.getTaskByAnchor(timer.taskFile, opening.tail)) {
            this.apply(timer, opening);
        } else {
            logInfo(`[TimerRecorder] adoptOpening: ${opening.tail} is not in ${timer.taskFile || '-'}, the write did not land (${describeTimerAnchor(timer)})`);
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
        // 書けたかは問わない。書けなければ行の end は古いままで、次の見直しで
        // それを読んでまた書く。拒否の通知は書き込みの層が出す。
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
            this.plugin.getTaskWriteService().insertRecord(start.task.id, line, place, start.rowId));
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
        const target = this.resolveTarget(timer);
        if (!target) {
            this.noticeResolveFailure(timer, 'writeChildLine (not written)');
            return false;
        }
        return this.plugin.getTaskWriteService().insertRecord(target.id, line, 'firstChild');
    }

    /**
     * 走行中の行（尻尾、錨で引いた `child`）を、終わりの時刻と完了で閉じる。
     */
    private async updateChildAtEnd(timer: TimerInstance, child: Task, record: PendingRecord): Promise<boolean> {
        const taskIndex = this.plugin.getTaskIndex();

        const elapsedSeconds = record.seconds;
        const endTime = new Date(record.endMs);

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
     * 対象を引けなかったことを伝える。読み取り専用の形式は開始の前に止めて
     * いるので（TimerWidget.startTimer）、ここに来るのは行を見失ったときだけ。
     */
    private noticeResolveFailure(timer: TimerInstance, site: string): void {
        logWarn(`[TimerRecorder] ${site}: timer target not found (${describeTimerAnchor(timer)})`);
        new Notice(t('notice.timerTargetNotFound'));
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

    /**
     * タイマーの対象の行。対象の錨（`timerTargetId`、開始の書き込みで決まる）で
     * 引く — 錨はファイルで 1 つだけの `^id` なので、読み直しをまたいでも同じ行を
     * 指し、双子も重複も引かない（`TaskIndex.getTaskByAnchor`）。デイリーノート
     * 起点は対象を持たない。
     */
    resolveTarget(timer: TimerInstance): Task | undefined {
        if (!timer.timerTargetId) return undefined;
        return this.plugin.getTaskIndex().getTaskByAnchor(timer.taskFile, timer.timerTargetId);
    }

    /**
     * タイマーが最後に書いたレコード行（＝ 尻尾）。尻尾の錨 `tailRecordBlockId`
     * で引く — 行番号ベースの task id はユーザーの編集やリロードで腐るのに対し、
     * `^id` はファイルに書いてあるものが正になる。
     *
     * self は 1 本目のレコードが対象の行そのものなので、開始の書き込みで尻尾を
     * 対象の錨に置く（{@link startOnTarget}）。2 本目からは自分で書いた行が尻尾。
     */
    resolveTailRecord(timer: TimerInstance): Task | undefined {
        if (!timer.tailRecordBlockId) return undefined;
        return this.plugin.getTaskIndex().getTaskByAnchor(timer.taskFile, timer.tailRecordBlockId);
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
        const tail = this.resolveTailRecord(timer);
        const { line, blockId } = this.buildSessionPlaceholder(timer, startMs);

        // 尻尾は 1 個。前の行の錨は、外してよければ（{@link mayTakeOff}）新しい行と
        // 同じ書き込みで外す。対象の錨は外さない（self の 1 本目の記録は対象の行
        // そのもの）: 対象の行には走っている間ずっと錨があり、閉じるときに片付ける。
        const releases = !!tail && this.mayTakeOff(timer, timer.tailRecordBlockId!, [timer.timerTargetId]);
        const next = this.opening(timer, blockId, { puts: [blockId], takesOff: releases ? timer.tailRecordBlockId : undefined });
        // 書けなければ、理由は書き込みの層が1回だけ通知済みで、尻尾は動かない。
        return this.writeOpening(timer, next, () => tail
            ? this.plugin.getTaskWriteService().insertRecord(tail.id, line, 'afterSubtree', releases ? null : undefined)
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
        const taskIndex = this.plugin.getTaskIndex();
        await taskIndex.waitForScan(timer.taskFile);
        const row = taskIndex.getTaskByAnchor(timer.taskFile, anchor);
        if (!row) {
            logInfo(`[TimerRecorder] takeOff: ${anchor} not found in ${timer.taskFile}, nothing taken off (${describeTimerAnchor(timer)})`);
            return;
        }
        await taskIndex.updateTask(row.id, { blockId: undefined });
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

        const tail = this.resolveTailRecord(timer);
        if (!tail) return;

        const untouchedPlaceholder = tail.statusChar === ' ' && !tail.endTime;
        if (!untouchedPlaceholder) {
            await this.takeOff(timer, blockId);
            return;
        }

        await this.plugin.getTaskIndex().deleteTask(tail.id);
    }

    /**
     * self の 1 本目: 尻尾である対象の行（錨で引いた `task`）を、記録の開始と終わりと
     * 完了に書き換える。This converts the task to SE-Timed type.
     */
    private async updateTaskDirectly(timer: TimerInstance, task: Task, record: PendingRecord): Promise<boolean> {
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
            // 尻尾でもあり、中断→再開の次セッションはこの id でしか隣を
            // 決められない（記録で content も日時も変わるため、originalText /
            // 内容一致では解決できなくなる）。ユーザーの手動 blockId はもとより保持。
            blockId: closes ? undefined : task.blockId,
            content: withTimerIcon(icon, task.content.trim()),
        };

        // 書けなかったときは、書き込みの層が理由を1回だけ通知済み。
        if (!(await this.plugin.getTaskIndex().updateTask(task.id, updates))) return false;

        new Notice(t('notice.taskUpdated', { icon, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
        return true;
    }

    /**
     * 尻尾を引けないときの予備の記録（{@link addCountupRecord} 系）。タイマーが書く
     * ほかの行と同じく、錨を付けて {@link writeOpening} を通し、書けたらそれが尻尾に
     * なる — 次の ▶ はその隣に並ぶ。置き場所は対象の先頭の子（{@link writeChildLine}）。
     *
     * @returns whether the record was written. Not written has been told to the user, once.
     */
    private async writeRecordLine(timer: TimerInstance, record: Task): Promise<boolean> {
        const anchor = this.storageUtils.generateTimerTargetId();
        const line = TaskParser.format({ ...record, blockId: anchor });
        return this.writeOpening(timer, this.opening(timer, anchor, { puts: [anchor] }), () => this.writeChildLine(timer, line));
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
