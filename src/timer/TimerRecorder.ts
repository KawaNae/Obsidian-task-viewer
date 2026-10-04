/**
 * Timer Recorder
 *
 * タイマーの行の書き込み: 開始の書き込み、走行中の行、記録、錨の付け外し。
 * 書いた結果の錨の姿は出来事（`opening`、`landed`）として `TimerBoard` に当て、
 * タイマーの欄を直接は書き換えない。
 */

import { Notice } from 'obsidian';
import { t } from '../i18n';
import type { PluginContext } from '../PluginContext';
import { type Opening, type PendingRecord, type TimerState, describeTimerAnchor, kindName, targetOf } from './TimerState';
import type { TimerEvent } from './TimerTransitions';
import { DateUtils } from '../utils/DateUtils';
import { type TaskLineFields, formatTaskLine } from '../services/parsing/TaskLineFormat';
import type { Task } from '../types';
import type { AnchoredRow } from '../services/operations/Operations';
import type { WriteAnswer } from '../services/operations/WriteAnswer';
import { TimeFormatter } from '../utils/TimeFormatter';
import { type TimerIcon, getTimerIcon, splitTimerIcon, withTimerIcon } from '../utils/TimerIcons';
import { decideLazyEnd } from './TimerLazyEnd';
import { generateTimerTargetId } from './TimerTargetIdUtils';
import { anchorsOf } from './TimerSendCheck';
import { logInfo, logWarn } from '../log/log';

/** recorder が書き込みの結果を当てる先と、錨を外してよいかを決めるときに見る表。 */
export interface RecorderOutlet {
    /** 出来事を当てる（`TimerBoard.dispatch`）。 */
    dispatch(timer: TimerState, event: TimerEvent): void;
    /** 開いているタイマー（{@link TimerRecorder.mayTakeOff}）。 */
    timers(): Iterable<TimerState>;
}

export class TimerRecorder {
    /**
     * @param newAnchor 新しい錨を作る（テストは決まった錨を渡す）。
     */
    constructor(
        private plugin: PluginContext,
        private outlet: RecorderOutlet,
        private newAnchor: () => string = generateTimerTargetId,
    ) {}

    /**
     * ストップ時の記録の **唯一の入口**。書き先は尻尾（最後に書いた行）で選ぶ。
     *
     *   尻尾が対象の行そのもの → 対象の行をレコードに変形する（self の 1 本目）
     *   尻尾が自分で書いた行   → その行を閉じる（開始か再開で書いた走行中の行）
     *   尻尾を引けない         → レコードを 1 行足す（予備の記録。それが尻尾になる）
     *
     * `mode` や回数では選ばない。self でも 2 本目以降は自分で書いた兄弟レコードに
     * 走っており、対象タスク行はもう 1 本目のレコードとして確定している — そこへ
     * 書き戻すと最初のセッションが上書きされて消える。どの行に走っているかを言うのは
     * 尻尾だけである。
     *
     * 時刻と長さは止めたときに固定した `record` のもので、押し直しても変わらない。
     * 尻尾はディスクの内容のとおりの読みで引く（{@link resolveTailRecord}）— 外の
     * 書き込みの通知が届かなくても、錨で引いた行を読みの鍵まで照合して通る。
     * ノートを読めなければ（一時的な EBUSY など）、尻尾が無いとは言えないので
     * レコードを足さず、書けなかったと答える。
     *
     * @returns 記録を書けたか。書けなかったときは、その理由を1回だけ通知済みで、
     * 成功の通知は出していない。呼び出し側は記録待ちのまま残す。
     */
    async recordSessionEnd(timer: TimerState, record: PendingRecord): Promise<boolean> {
        const tail = timer.tail;
        if (!tail) return this.addRecord(timer, record);
        // self の 1 本目は、尻尾が対象の行そのもの。
        const direct = tail === targetOf(timer);
        const closed = await this.plugin.getOperations().updateByAnchor(timer.file, tail,
            (row) => direct ? this.closeTarget(timer, row, record) : this.closeChild(timer, row, record));
        switch (closed.kind) {
            case 'none': return this.addRecord(timer, record);
            case 'unreadable': return this.noticeUnreadable(timer, 'recordSessionEnd (not recorded)');
            // Not written: the write layer has said why, once.
            case 'not-written': return false;
        }
        this.noticeRecorded(timer, record);
        return true;
    }

    /**
     * 尻尾を引けないときの予備の記録。タイマーが書くほかの行と同じく、錨を付けて
     * {@link writeOpening} を通し、書けたらそれが尻尾になる — 次の ▶ はその隣に
     * 並ぶ。置き場所は対象の先頭の子（{@link writeChildLine}）。言うのは記録の
     * 通知の1回だけ — 利用者に要るのは記録できたかで、どの行が受けたかではない。
     */
    private async addRecord(timer: TimerState, record: PendingRecord): Promise<boolean> {
        if (timer.tail) {
            logWarn(`[TimerRecorder] recordSessionEnd: running line not found, adding a record instead (${describeTimerAnchor(timer)})`);
        }
        const endTime = new Date(record.endMs);
        const startTime = new Date(record.endMs - record.seconds * 1000);
        const fields = this.recordFields(
            this.recordLabel(timer),
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        if (!(await this.writeRecordLine(timer, fields))) return false;
        this.noticeRecorded(timer, record);
        return true;
    }

    /** 記録を書けた通知。記録の経路はどれもこの1つを言う。 */
    private noticeRecorded(timer: TimerState, record: PendingRecord): void {
        new Notice(t('notice.timerRecorded', {
            icon: this.iconOf(timer),
            kind: kindName(timer.measure),
            duration: TimeFormatter.formatSeconds(record.seconds),
        }));
    }

    /**
     * 開始の命令が対象にする錨。行の錨（ファイルで 1 つだけの `^id`）があればそれ。
     * 無ければ新しい錨を決め、開始の書き込み（{@link writeStart}）で行に付ける。
     *
     * 行の `^id` をほかの行も持っていれば、その行は錨にならず、行に `^id` は
     * 1 つしか置けないので付け足すこともできない。タイマーは始めない（null）。
     */
    startAnchor(task: Task): string | null {
        if (task.anchor) return task.anchor;
        if (task.blockId) {
            logWarn(`[TimerRecorder] startAnchor: ^${task.blockId} is carried by another line too in ${task.file}, not started`);
            new Notice(t('notice.timerAnchorShared', { id: task.blockId }));
            return null;
        }
        return this.newAnchor();
    }

    /**
     * 開始の書き込み。タイマーは対象の行を錨（`subject.anchor`、開始の命令が決めて
     * ある）で引くので、行に錨が無ければこの書き込みでその錨を付ける。付けるのは
     * 開始そのものと同じ 1 回の書き込みの中で、self は開始時刻の書き換え、child と
     * sibling は 1 本目の行の挿入と一緒に書く。照合は開始を押したときの写し `task`
     * （読みの鍵まで）である。
     *
     * デイリーノート（`task` が null）は対象の行を持たないので、1 本目の行を
     * 見出しの下に書くだけ。
     *
     * @returns 書けたか。書けなければタイマーは始めない。理由は1回だけ通知済み。
     */
    async writeStart(timer: TimerState, task: Task | null): Promise<boolean> {
        const subject = timer.subject;
        if (subject.kind === 'daily' || !task) {
            return this.writeFirstLine(timer, undefined, line => this.writeChildLine(timer, line));
        }
        const rowId = task.anchor ? undefined : subject.anchor;
        switch (timer.mode) {
            case 'self': return this.startOnTarget(timer, task, subject.anchor, rowId);
            case 'sibling': return this.startLine(timer, task, rowId, 'afterCompletedRun');
            default: return this.startLine(timer, task, rowId, 'firstChild');
        }
    }

    /**
     * 行を書く書き込みが、書けたあとのタイマーに残す錨の姿（{@link Opening}）。
     * `puts` はこの書き込みで付ける錨、`takesOff` は外す錨で、書けたら
     * {@link TimerState.owned} になる。
     */
    private opening(
        timer: TimerState,
        tail: string,
        change: { puts?: string[]; takesOff?: string } = {},
    ): Opening {
        return {
            tail,
            owned: [...timer.owned.filter(anchor => anchor !== change.takesOff), ...(change.puts ?? [])],
        };
    }

    /**
     * self の開始: 対象の行に開始時刻を書く（錨 `rowId` を付けるならそれも同じ書き込みで）。
     * - Timeline tasks (has startTime): parallel translation — preserve duration
     * - Allday tasks (no startTime): discard endDate/endTime, convert to S-Timed
     *
     * 対象の行が 1 本目の記録なので、尻尾は対象の錨 `target` そのもの。上書きする前の
     * start は開始の命令が Task から取ってある（`TimerState.priorStartMs`）。
     */
    private startOnTarget(timer: TimerState, task: Task, target: string, rowId: string | undefined): Promise<boolean> {
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

        return this.writeOpening(timer, this.opening(timer, target, { puts: rowId ? [rowId] : [] }),
            () => this.wrote(this.plugin.getOperations().updateTask(task.id, updates), timer.file));
    }

    /**
     * 行を書く。書く前に、書けたあとの錨の姿 `next` を `opening` として当て
     * （`TimerBoard.dispatch` が書き込みの往復より先に保存する）、書けたら
     * `landed` で当てる（尻尾、自分で付けた錨、書いたノート）。書けなければ
     * `opening` を下ろし、何も動かない。書く途中で再読み込みされても、保存の
     * `opening` の行を錨で引けば書けたかが分かる（{@link adoptOpening}）。
     *
     * @param write 書けたら書いたノートを、書けなければ null を答える。
     */
    private async writeOpening(timer: TimerState, next: Opening, write: () => Promise<string | null>): Promise<boolean> {
        this.outlet.dispatch(timer, { type: 'opening', opening: next });
        const file = await write();
        if (file === null) {
            this.outlet.dispatch(timer, { type: 'opening', opening: null });
            return false;
        }
        this.outlet.dispatch(timer, { type: 'landed', opening: next, file });
        return true;
    }

    /** 書き込み `write` が書けたら、書いたノート `file` を答える。 */
    private async wrote(write: Promise<WriteAnswer>, file: string): Promise<string | null> {
        return (await write).written ? file : null;
    }

    /**
     * 再読み込みのあと、保存に残った `opening` に答える。その行を錨で引けたら、
     * その書き込みは届いている — `landed` で当てる。引けなければ届いていない —
     * `opening` を下ろす。推定でなく、ファイルに在る `^id` で答える。ノートを読め
     * なければ答えられないので、`opening` を残して次の再読み込みに任せる。
     *
     * @returns タイマーを変えたか。
     */
    async adoptOpening(timer: TimerState): Promise<boolean> {
        const opening = timer.opening;
        if (!opening) return false;
        const row = await this.rowByAnchor(timer, opening.tail);
        switch (row.kind) {
            case 'row':
                this.outlet.dispatch(timer, { type: 'landed', opening });
                return true;
            case 'none':
                logInfo(`[TimerRecorder] adoptOpening: ${opening.tail} is not in ${timer.file || '-'}, the write did not land (${describeTimerAnchor(timer)})`);
                this.outlet.dispatch(timer, { type: 'opening', opening: null });
                return true;
            case 'unreadable':
                logWarn(`[TimerRecorder] adoptOpening: ${timer.file} could not be read, the opening is kept (${describeTimerAnchor(timer)})`);
                return false;
        }
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
     * 上だけの「次にいつ見直すか」の予定（`TimerRuntime.lazyEndFloorMs`）で、状態
     * ではない。end の真の値は見直すたびにファイル（実効 end）から読み直すので、
     * 書けなかった書き足しは次の見直しで古い end を読んでまた書き、何も失われない。
     * 書けるまで門を開けておくと、拒否が続く間は毎 tick 書き直して毎回通知が出る。
     *
     * @returns 次に見直す時刻（ミリ秒）。行を引けなかったときだけ undefined。
     */
    async extendRunningSession(timer: TimerState): Promise<number | undefined> {
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
     * タイマーの時計は、これが書けてから呼び出し側が動かす（`TimerLifecycle.offsetStart`
     * の `shifted`。end の書き足しの門の引き直しもそちら）。
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
    async moveRunningStart(timer: TimerState, startMs: number): Promise<boolean> {
        if (!timer.tail) return this.noRunningLine(timer);
        const start = new Date(startMs);
        const moved = await this.plugin.getOperations().updateByAnchor(timer.file, timer.tail, (row) => {
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
        return true;
    }

    /** 開始をずらす走行の行が無い: タイマーだけが動く。 */
    private noRunningLine(timer: TimerState): boolean {
        logInfo(`[TimerRecorder] moveRunningStart: no running line, only the timer moves (${describeTimerAnchor(timer)})`);
        return true;
    }

    /**
     * 走行中セッションの行（placeholder）を組み立てる。
     *
     * 開始時刻だけを持つ未完了行で、`blockId` は書き込んだ後に「どの行が今の
     * セッションか」を引き直すための目印（＝ 尻尾の錨）。セッション行の形は
     * ここが唯一の持ち主で、1 本目を挿す経路（{@link writeFirstLine}）と
     * 兄弟に挿す経路（{@link startNextSession}）が同じ行を使う。
     *
     * 名前は {@link sessionName} の規則で決める。
     */
    private buildSessionPlaceholder(timer: TimerState, startMs = Date.now()): { line: string; blockId: string } {
        const now = new Date(startMs);
        const blockId = this.newAnchor();

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
     * 子の先頭、sibling は完了済みの連なりの末尾）。対象の行に錨 `rowId` を付けるなら
     * 同じ書き込みで。
     *
     * sibling は `[x]` のタスクから「続きを開始」したときの 1 本目で、起点の行その
     * ものは触らない（既に完了した事実）。どこまでが「連続する完了済み」かは index
     * のスナップショットではなくファイルの生の行を見ないと決まらないので、位置決めは
     * 書き込み層の `afterCompletedRun` が担う。
     *
     * @returns 書けたか。書けなければ理由は1回だけ通知済み。
     */
    private startLine(timer: TimerState, task: Task, rowId: string | undefined, place: 'firstChild' | 'afterCompletedRun'): Promise<boolean> {
        return this.writeFirstLine(timer, rowId, line =>
            this.wrote(this.plugin.getOperations().insertLine(task.id, line, place, rowId), timer.file));
    }

    /**
     * 1 本目のセッション行を `write` で書き、書けたら尻尾として引き受ける。対象の
     * 行に付ける錨 `rowId` も、自分で付けた錨に数える。
     */
    private writeFirstLine(
        timer: TimerState,
        rowId: string | undefined,
        write: (line: string) => Promise<string | null>,
    ): Promise<boolean> {
        const { line, blockId } = this.buildSessionPlaceholder(timer);
        const puts = rowId ? [blockId, rowId] : [blockId];
        return this.writeOpening(timer, this.opening(timer, blockId, { puts }), () => write(line));
    }

    /**
     * 行を対象タスクの先頭の子として書く（錨で対象を引く）。書けたら書いたノートを
     * 答える。書けなければ理由は1回だけ通知済み。
     *
     * デイリーノートは器になるタスクが無いので、設定の見出しの下へ行を直接置く。
     * 書いたノートのパスを `landed` でタイマーの `file` に当てるのが要点で、これで
     * 尻尾の解決（ファイルで絞る）と 2 本目以降の兄弟挿入が通常タスクと同じ経路に乗る。
     */
    private async writeChildLine(timer: TimerState, line: string): Promise<string | null> {
        if (timer.subject.kind === 'daily') {
            return this.plugin.getOperations().putInDailyNote(timer.subject.date, line).then(answer => answer.path ?? null);
        }
        const target = await this.resolveTarget(timer);
        switch (target.kind) {
            case 'none':
                this.noticeResolveFailure(timer, 'writeChildLine (not written)');
                return null;
            case 'unreadable':
                this.noticeUnreadable(timer, 'writeChildLine (not written)');
                return null;
        }
        return this.wrote(this.plugin.getOperations().insertLine(target.task.id, line, 'firstChild'), timer.file);
    }

    /**
     * 走行中の行（尻尾の `child`）を、終わりの時刻と完了で閉じる書き換え。
     */
    private closeChild(timer: TimerState, child: Task, record: PendingRecord): Partial<Task> {
        const endTime = new Date(record.endMs);
        // 名前は対象タスクから継ぐので、既にアイコン付きの行（完了済みレコードの
        // 「続き」など）を起点にすると二重に付く。付け直しの規則は
        // {@link withTimerIcon} が持つ。
        const content = withTimerIcon(this.iconOf(timer), child.content.trim());
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
     * 対象を引けなかったことを伝える。読み取り専用の記法は開始の前に止めて
     * いるので（`TimerStartRules`）、ここに来るのは行を見失ったときだけ。
     */
    private noticeResolveFailure(timer: TimerState, site: string): void {
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
    noticeUnreadable(timer: TimerState, site: string): false {
        logWarn(`[TimerRecorder] ${site}: ${timer.file} could not be read (${describeTimerAnchor(timer)})`);
        new Notice(t('notice.notReadable', { subject: timer.name }));
        return false;
    }

    /**
     * レコードが名乗る名前の素。**行を新しく作るときだけ**使う。
     *
     * 行が既にあるなら content の正はその行で、widget の入力欄がその行を直接書き
     * 換える（`TimerContentBinding`）。ここへ来るのは書く相手がまだ無い場合だけで、
     * 未書き込みの下書き（`draft`）があればそれ、無ければ**対象タスクの名前を継ぐ**。
     * セッションは同じ作業の分割であって別物ではないので、名前を落とすと後から
     * 読めない。走行中の行（{@link buildSessionPlaceholder}）と予備の記録
     * （{@link addRecord}）が同じ規則に乗る。
     */
    private sessionName(timer: TimerState): string {
        const drafted = timer.draft?.trim();
        if (drafted) return drafted;
        if (timer.subject.kind === 'task') return timer.name.trim();

        // デイリーノートの `name` は日付で、作業名として継ぐと「2026-08-17 を
        // 25 分やった」という読めない記録が残る。1 本目は空で始めて widget で
        // 付けさせ、2 本目以降は直前のレコードから継ぐ（兄弟レコードは同名）。
        const tail = this.tailInIndex(timer);
        return tail ? splitTimerIcon(tail.content).name : '';
    }

    /** レコード行の content（アイコン + 名前）。 */
    private recordLabel(timer: TimerState): string {
        return withTimerIcon(this.iconOf(timer), this.sessionName(timer));
    }

    /**
     * タイマーの測り方のアイコン。
     * 一覧は {@link TimerIcons} が持つ — 剥がす側（フロー発火）と共有する。
     */
    private iconOf(timer: TimerState): TimerIcon {
        const { measure } = timer;
        return getTimerIcon(measure.type, measure.type === 'interval' && measure.source === 'pomodoro' ? 'pomodoro' : undefined);
    }

    /**
     * タイマーの対象の行。対象の錨（`subject.anchor`、開始の命令が決める）で
     * 引く — 錨はファイルで 1 つだけの `^id` なので、読み直しをまたいでも同じ行を
     * 指し、双子も重複も引かない。書くために引くので、ディスクの内容のとおりの
     * 読みで引く（{@link rowByAnchor}）。デイリーノートは対象を持たない。
     */
    async resolveTarget(timer: TimerState): Promise<AnchoredRow> {
        const target = targetOf(timer);
        if (!target) return { kind: 'none' };
        return this.rowByAnchor(timer, target);
    }

    /**
     * タイマーが最後に書いたレコード行（＝ 尻尾）。尻尾の錨 `tail` で引く —
     * 行番号ベースの task id はユーザーの編集やリロードで腐るのに対し、`^id` は
     * ファイルに書いてあるものが正になる。書くために引くので、ディスクの内容の
     * とおりの読みで引く（{@link rowByAnchor}）。
     *
     * self は 1 本目のレコードが対象の行そのものなので、開始の書き込みで尻尾を
     * 対象の錨に置く（{@link startOnTarget}）。2 本目からは自分で書いた行が尻尾。
     */
    async resolveTailRecord(timer: TimerState): Promise<AnchoredRow> {
        if (!timer.tail) return { kind: 'none' };
        return this.rowByAnchor(timer, timer.tail);
    }

    /**
     * `file` で錨 `anchor` を持つ行を、ディスクの内容のとおりの読みで引く。
     * API の `path#^id` と同じ1つの口（`Operations.freshByAnchor`）を通る。
     * 行が無い（`none`）とノートを読めない（`unreadable`）は分けて答える —
     * 読めないだけで行が無いとみなすと、閉じるはずの行の代わりにレコードを足す。
     */
    private rowByAnchor(timer: TimerState, anchor: string): Promise<AnchoredRow> {
        return this.plugin.getOperations().freshByAnchor(timer.file, anchor);
    }

    /**
     * 尻尾の行の、索引の最後の読みでの写し（`TaskIndex.getTaskByAnchor`）。書く
     * ためでなく、名前を見せるための読み。書くときは {@link resolveTailRecord}。
     */
    tailInIndex(timer: TimerState): Task | undefined {
        if (!timer.tail) return undefined;
        return this.plugin.getIndex().getTaskByAnchor(timer.file, timer.tail);
    }

    /**
     * 再開時にセッション行を書いて次の走行を始める。
     *
     *   尻尾を引ける     → **尻尾の兄弟**として追記し、尻尾の錨を進める
     *   引けない         → 対象タスクの子として追記（フォールバック）
     *
     * self 起点か child 起点かで分けない。self は 1 本目がタスク行そのもの、
     * child は 1 本目が子で、どちらも 2 本目以降は「直前のレコードの隣」に並ぶ。
     * デイリーノートも 1 本目を見出しの下に置くだけで、あとは同じ。
     * 最後の枝はフォールバックでもある: レコード行をユーザーが消して尻尾を失って
     * も、記録そのものは落とさない。
     */
    async startNextSession(timer: TimerState, startMs = Date.now()): Promise<boolean> {
        const found = await this.resolveTailRecord(timer);
        // 読めなければ尻尾が無いとは言えない。フォールバックの子を書かずに止める。
        if (found.kind === 'unreadable') return this.noticeUnreadable(timer, 'startNextSession (not started)');
        const row = found.kind === 'row' ? found.task : undefined;
        const tail = timer.tail;
        const { line, blockId } = this.buildSessionPlaceholder(timer, startMs);

        // 尻尾は 1 個。前の行の錨は、外してよければ（{@link mayTakeOff}）新しい行と
        // 同じ書き込みで外す。対象の錨は外さない（self の 1 本目の記録は対象の行
        // そのもの）: 対象の行には走っている間ずっと錨があり、閉じるときに片付ける。
        const takesOff = row && tail && this.mayTakeOff(timer, tail, [targetOf(timer)]) ? tail : undefined;
        const next = this.opening(timer, blockId, { puts: [blockId], takesOff });
        // 書けなければ、理由は書き込みの層が1回だけ通知済みで、尻尾は動かない。
        return this.writeOpening(timer, next, () => row
            ? this.wrote(this.plugin.getOperations().insertLine(row.id, line, 'afterSubtree', takesOff ? null : undefined), timer.file)
            : this.writeChildLine(timer, line));
    }

    /**
     * タイマーが錨 `anchor` を外してよいか。規則はここ1つ: 外してよいのは、自分の
     * 書き込みで付けた錨（{@link TimerState.owned}）だけで、同じノートで開いている
     * ほかのどのタイマーもその錨で行を引かない（{@link anchorsOf}: 対象、尻尾、
     * 書いている途中の行）ときだけ。`timer` 自身がこのあとも持つ錨は `keeps` で言う。
     *
     * ユーザーが手で書いた `^id` や、ほかのタイマーが付けた `^id` は、id の形が
     * 同じでも外さない。ほかのタイマーが引く錨を外すと、そのタイマーは自分の行を
     * 引けなくなる — 書き込みの往復の途中で閉じたタイマーの錨でも同じ。
     */
    private mayTakeOff(timer: TimerState, anchor: string, keeps: readonly (string | null)[]): boolean {
        if (!timer.owned.includes(anchor)) return false;
        if (keeps.includes(anchor)) return false;
        for (const open of this.outlet.timers()) {
            if (open.id === timer.id || open.file !== timer.file) continue;
            if (anchorsOf(open).includes(anchor)) return false;
        }
        return true;
    }

    /** 錨 `anchor` の行からその `^id` を外す。行を引けなければ何もしない。 */
    private async takeOff(timer: TimerState, anchor: string): Promise<void> {
        const row = await this.plugin.getOperations().updateByAnchor(timer.file, anchor, { blockId: undefined });
        if (row.kind === 'none' || row.kind === 'unreadable') {
            logInfo(`[TimerRecorder] takeOff: ${anchor} ${row.kind === 'none' ? 'not found in' : 'not looked up, could not read'} ${timer.file}, nothing taken off (${describeTimerAnchor(timer)})`);
        }
    }

    /**
     * widget を閉じたあと、このタイマーが付けた `^id` を外す（対象の行と尻尾の行）。
     * 記録そのものは残す — 消すのは目印だけ。ほかのタイマーがまだ引く錨は残す
     * （{@link mayTakeOff}）。
     */
    async releaseAnchors(timer: TimerState): Promise<void> {
        for (const anchor of timer.owned) {
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
     * self の 1 本目は対象タスク行そのものなので対象外。開始時に書いた start 時刻も
     * **巻き戻さない** — 破棄は「今回の走行を記録しない」の意であって対象タスクの
     * 日付操作までは含まないし、巻き戻しはユーザー編集との競合を持ち込む。
     *
     * 行を消すのも錨を外すのと同じ規則に乗る（{@link mayTakeOff}）: 自分で付けた
     * 錨の行で、ほかのタイマーが引いていないときだけ。self の 1 本目は対象の錨
     * そのものなので、ここでは触らない（閉じるときに片付く）。
     */
    async discardRunningPlaceholder(timer: TimerState): Promise<void> {
        const blockId = timer.tail;
        if (!blockId || !this.mayTakeOff(timer, blockId, [targetOf(timer)])) return;

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
    private closeTarget(timer: TimerState, task: Task, record: PendingRecord): Partial<Task> {
        const endTime = new Date(record.endMs);
        const startTime = new Date(record.endMs - record.seconds * 1000);
        // ■ で閉じる記録は、自分で付けた錨をこの書き込みで外す（外してよければ。
        // {@link mayTakeOff}）。行を完了させるこの書き込みは同じ書き込みで発火し、
        // move は行を `^id` ごと運ぶので、あとから外すと錨が運ばれた先に残る。
        const closes = record.then === 'close' && !!task.blockId && this.mayTakeOff(timer, task.blockId, []);

        return {
            startDate: this.formatDate(startTime),
            startTime: this.formatTime(startTime),
            endDate: this.formatDate(endTime),
            endTime: this.formatTime(endTime),
            statusChar: 'x',
            // ⏸ では blockId を**残す**。この行は self のレコードであると同時に
            // 尻尾でもあり、中断→再開の次セッションはこの錨で隣を決める
            // （行を時間を越えて追えるのは錨だけである）。ユーザーの手動
            // blockId はもとより保持。
            blockId: closes ? undefined : task.blockId,
            content: withTimerIcon(this.iconOf(timer), task.content.trim()),
        };
    }

    /**
     * 尻尾を引けないときの予備の記録（{@link addRecord}）の行を書く。錨を付けて
     * {@link writeOpening} を通し、書けたらそれが尻尾になる。
     *
     * @returns whether the record was written. Not written has been told to the user, once.
     */
    private writeRecordLine(timer: TimerState, record: TaskLineFields): Promise<boolean> {
        const anchor = this.newAnchor();
        const line = formatTaskLine({ ...record, blockId: anchor });
        return this.writeOpening(timer, this.opening(timer, anchor, { puts: [anchor] }), () => this.writeChildLine(timer, line));
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
