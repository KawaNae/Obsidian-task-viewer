/**
 * Timer Recorder
 *
 * Handles saving timer records to tasks or daily notes.
 */

import { type App, Notice } from 'obsidian';
import { t } from '../i18n';
import type TaskViewerPlugin from '../main';
import { type TimerInstance, getTimerElapsedSeconds } from './TimerInstance';
import { DailyNoteUtils } from '../utils/DailyNoteUtils';
import { TaskParser } from '../services/parsing/TaskParser';
import { type Task, isTvFile } from '../types';
import { createTempTask } from '../services/data/createTempTask';
import { TimeFormatter } from '../utils/TimeFormatter';
import { TimerTaskResolver } from './TimerTaskResolver';
import { looksLikeSessionGroup, resolveSessionGroup } from './TimerSessionGroup';
import type { TimerStorageUtils } from './TimerStorageUtils';

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

        const taskObj = this.createTaskObject(
            timer.customLabel.trim() ? `⏱️ ${timer.customLabel.trim()}` : '⏱️',
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        const formattedLine = TaskParser.format(taskObj);

        await this.insertChildRecord(timer, formattedLine);
        new Notice(t('notice.timerRecorded', { icon: '⏱️', duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
    }

    /**
     * Record a completed Countdown timer session.
     */
    async addCountdownRecord(timer: TimerInstance): Promise<void> {
        const elapsedSeconds = getTimerElapsedSeconds(timer);
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - elapsedSeconds * 1000);

        const taskObj = this.createTaskObject(
            timer.customLabel.trim() ? `⏲️ ${timer.customLabel.trim()}` : '⏲️',
            this.formatDate(startTime),
            this.formatTime(startTime),
            this.formatDate(endTime),
            this.formatTime(endTime)
        );
        const formattedLine = TaskParser.format(taskObj);

        await this.insertChildRecord(timer, formattedLine);
        new Notice(t('notice.countdownRecorded', { icon: '⏲️', duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
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
        const icon = isPomodoroSource ? '🍅' : '🔁';
        const custom = timer.customLabel.trim();
        const label = custom ? `${icon} ${custom}` : icon;

        const taskObj = this.createTaskObject(
            label,
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
     * ストップ時の記録の **唯一の入口**。recordMode に応じてタスク自身の更新か
     * セッションレコードかを選ぶ。
     *
     * ここを通さずに `addCountdownRecord` / `addIntervalRecord` を直接呼ぶと、
     * child モードで開始時に作った placeholder（{@link createChildAtStart}）が
     * 更新されず、1 セッションが 2 行になる。停止経路は必ずこれを呼ぶこと。
     */
    async recordSessionEnd(timer: TimerInstance): Promise<void> {
        if (timer.recordMode === 'self') {
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

        if (!task) return;

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
     * 走行中セッションの行（placeholder）を組み立てる。
     *
     * 開始時刻だけを持つ未完了行で、`blockId` は書き込んだ後に「どの行が今の
     * セッションか」を引き直すための目印。セッション行の形はここが唯一の持ち主で、
     * 子として挿す経路（{@link createChildAtStart}）とグループ変形に同梱する
     * 経路（フェーズ 3 の wrapTaskInGroup）が同じ行を使う。
     */
    buildSessionPlaceholder(timer: TimerInstance): { line: string; blockId: string } {
        const now = new Date();
        const blockId = this.storageUtils.generateTimerTargetId();

        const taskObj = this.createTaskObject(
            timer.customLabel.trim(),
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
        if (timer.taskId.startsWith('daily-')) return undefined;

        const { line, blockId } = this.buildSessionPlaceholder(timer);
        await this.insertChildRecord(timer, line);

        const parentTask = isTvFile(timer)
            ? this.resolver.resolveTvFile(timer)
            : this.resolver.resolveTvInline(timer);
        if (!parentTask) return undefined;

        return this.findSessionTaskId(parentTask.file, blockId);
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
        const existingContent = child.content.trim();
        const content = existingContent ? `${icon} ${existingContent}` : icon;

        await taskIndex.updateTask(child.id, {
            content,
            endDate: this.formatDate(endTime),
            endTime: this.formatTime(endTime),
            statusChar: 'x',
            blockId: undefined,
        });

        const kind = this.getTimerKind(timer);
        new Notice(t('notice.kindRecorded', { icon, kind, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
    }

    /**
     * Get the emoji icon for a timer type.
     */
    private getTimerIcon(timer: TimerInstance): string {
        if (timer.timerType === 'interval') {
            return timer.intervalSource === 'pomodoro' ? '🍅' : '🔁';
        }
        if (timer.timerType === 'countdown') return '⏳';
        return '⏱️';
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
     * 形成済みのセッショングループ。未形成 / tvFile / daily なら null。
     * tvFile は最初から恒久的な器を持つので変形の対象外。
     *
     * アンカー自身が既にグループの場合（＝ セッションレコードの子を持つタスクに
     * 新しくタイマーを掛けた append モード）と、アンカーが 1 回目のレコードで
     * その親がグループの場合の両方を引く。
     */
    resolveGroup(timer: TimerInstance): Task | null {
        if (!timer.taskId || timer.taskId.startsWith('daily-')) return null;
        if (isTvFile(timer)) return null;

        const taskIndex = this.plugin.getTaskIndex();
        const getTask = (id: string) => taskIndex.getTask(id);
        const anchor = this.resolveAnchorTask(timer);

        if (looksLikeSessionGroup(anchor, getTask)) return anchor ?? null;
        return resolveSessionGroup(anchor, getTask);
    }

    /**
     * セッション行を親の **末尾** に追記して走行を開始する。
     *
     * グループ配下のセッションは時系列のログなので、先頭挿入
     * （{@link createChildAtStart} が使う insertChildTask）だと新しい順に並んで
     * 読みにくい。
     */
    async appendSessionAtStart(timer: TimerInstance, parent: Task): Promise<string | undefined> {
        const { line, blockId } = this.buildSessionPlaceholder(timer);
        await this.plugin.getTaskWriteService().appendChildTask(parent.id, line);
        return this.findSessionTaskId(parent.file, blockId);
    }

    /**
     * グループ行の日付を作業実績に合わせて伸ばす。
     *
     * グループは**日付のみ**（時刻なし）の allday で、初回作業日から最終作業日
     * までの帯。日を跨いで作業したらそのぶん `@初回>最終` に伸ばす。後退はさせ
     * ない（過去日のセッションを足しても縮めない）。
     */
    async syncGroupDateSpan(timer: TimerInstance): Promise<void> {
        const group = this.resolveGroup(timer);
        if (!group?.startDate) return;

        const today = this.formatDate(new Date());
        if (today <= group.startDate) return;
        if (group.endDate && today <= group.endDate) return;

        await this.plugin.getTaskIndex().updateTask(group.id, { endDate: today });
    }

    /**
     * ✓ 完了: 状態を持つ行を完了にする。
     *
     * グループが形成済みならグループ行が状態の持ち主（レコードは事実であって
     * 状態ではないので常に `[x]` のまま触らない）。未形成なら対象タスク自身。
     * child モードでセッションを子に積んでいる場合も、完了するのはレコードでは
     * なく親。self モードは記録の時点で既に `[x]` なので何もしない。
     *
     * flow 付きタスクは self が安全でないため child モードに退避されているが、
     * ここで `[x]` にすると flow が発火する。完了は本物の完了意図なので、これは
     * 意図した挙動（tv-lead 承認済み）。
     */
    async completeTargetTask(timer: TimerInstance): Promise<void> {
        if (!timer.taskId || timer.taskId.startsWith('daily-')) return;

        const target = this.resolveGroup(timer) ?? this.resolveAnchorTask(timer);

        if (!target) {
            new Notice(t('notice.timerTargetNotFound'));
            return;
        }
        if (target.statusChar === 'x') return;

        await this.plugin.getTaskIndex().updateTask(target.id, { statusChar: 'x' });
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
                new Notice(t('notice.timerTargetNotFound'));
                return;
            }

            const icon = this.getTimerIcon(timer);
            const existingContent = task.content.trim();

            const updates: Partial<Task> = {
                startDate: startDateStr,
                startTime: startTimeStr,
                endDate: endDateStr,
                endTime: endTimeStr,
                statusChar: 'x',
                // blockId は**残す**。この行は self モードのレコードであると同時に
                // タイマーのアンカーで、中断→再開の次セッションはこの id でしか
                // 対象を引き直せない（記録で content も日時も変わるため、
                // originalText / 内容一致では解決できなくなる）。
                // 自動生成 id はタイマーが閉じるときに cleanupGeneratedTargetId
                // が片付ける。ユーザーの手動 blockId はもとより保持。
                blockId: task.blockId,
                content: existingContent.startsWith(icon)
                    ? existingContent
                    : existingContent
                        ? `${icon} ${existingContent}`
                        : icon,
            };

            await taskIndex.updateTask(task.id, updates);
        }

        const icon = this.getTimerIcon(timer);
        new Notice(t('notice.taskUpdated', { icon, duration: TimeFormatter.formatSeconds(elapsedSeconds) }));
    }

    /**
     * Insert a child record line for the given timer.
     * Frontmatter/inline both resolve target with timerTargetId first.
     */
    private async insertChildRecord(timer: TimerInstance, formattedLine: string): Promise<void> {
        if (timer.taskId.startsWith('daily-')) {
            const dailyDate = timer.taskId.replace('daily-', '');
            await this.addTimerRecordToDailyNote(dailyDate, formattedLine);
            return;
        }

        const resolvedTask = isTvFile(timer)
            ? this.resolver.resolveTvFile(timer)
            : this.resolver.resolveTvInline(timer);

        if (!resolvedTask) {
            new Notice(t('notice.timerTargetNotFound'));
            return;
        }

        await this.plugin.getTaskWriteService().insertChildTask(resolvedTask.id, formattedLine);
    }

    /**
     * Add timer record directly to daily note (completed task format).
     */
    private async addTimerRecordToDailyNote(dateStr: string, taskLine: string): Promise<void> {
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date();
        date.setFullYear(y, m - 1, d);
        date.setHours(0, 0, 0, 0);

        await DailyNoteUtils.appendLineToDailyNote(
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
