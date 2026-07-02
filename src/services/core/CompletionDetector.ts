import type { StatusDefinition, Task } from '../../types';
import { flowSource } from '../flow/FlowSegments';
import { canTriggerFlow } from '../flow/FlowTrigger';

export interface DetectOptions {
    /** True when the change came from a local edit (sync changes never fire). */
    isLocalChange: boolean;
    /** True while the initial vault scan is running. */
    isInitializing: boolean;
    statusDefinitions: StatusDefinition[];
}

/**
 * Completion-event detection across rescans — owns the signature memory
 * (`processedCompletions`) and the first-scan tracking that decide whether
 * a completed flow task is a NEW completion (→ fire) or one we've already
 * seen.
 *
 * Signatures include the joined flow source, so fire-consumes (which
 * rewrites the command lines) structurally changes the signature and the
 * same completion can never double-fire.
 */
export class CompletionDetector {
    private processedCompletions = new Map<string, number>(); // "file|date|content|flow" -> count
    private visitedFiles = new Set<string>();

    /**
     * Compare the fresh scan of `filePath` against the remembered state and
     * return the tasks whose completion should fire flow commands (possibly
     * the same task multiple times for multi-instance signatures). Always
     * updates the memory, even when firing is suppressed.
     */
    detect(filePath: string, tasks: Task[], opts: DetectOptions): Task[] {
        const currentCounts = new Map<string, number>();
        const doneTasks: Task[] = [];

        for (const task of tasks) {
            if (canTriggerFlow(task, opts.statusDefinitions)) {
                const sig = this.getTaskSignature(task);
                currentCounts.set(sig, (currentCounts.get(sig) || 0) + 1);
                doneTasks.push(task);
            }
        }

        const isFirstScan = !this.visitedFiles.has(filePath);
        this.visitedFiles.add(filePath);

        const tasksToTrigger: Task[] = [];
        const checkedSignatures = new Set<string>();

        for (const task of doneTasks) {
            const sig = this.getTaskSignature(task);
            if (checkedSignatures.has(sig)) continue;
            checkedSignatures.add(sig);

            const currentCount = currentCounts.get(sig) || 0;
            const previousCount = this.processedCompletions.get(sig) || 0;

            if (currentCount > previousCount) {
                // トリガー条件: 初期化中でない、初回スキャンでない、ローカル変更である
                if (!opts.isInitializing && !isFirstScan && opts.isLocalChange) {
                    for (let k = 0; k < currentCount - previousCount; k++) {
                        tasksToTrigger.push(task);
                    }
                }
            }
        }

        // メモリを更新（ファイル単位で総入れ替え）
        this.clearForFile(filePath);
        for (const [sig, count] of currentCounts) {
            this.processedCompletions.set(sig, count);
        }

        return tasksToTrigger;
    }

    /** Forget everything about a path (rename/delete cleanup). */
    forgetFile(filePath: string): void {
        this.clearForFile(filePath);
        this.visitedFiles.delete(filePath);
    }

    /** Drop the signature memory of a path (tasks removed, visit kept). */
    clearForFile(filePath: string): void {
        const prefix = `${filePath}|`;
        for (const key of this.processedCompletions.keys()) {
            if (key.startsWith(prefix)) {
                this.processedCompletions.delete(key);
            }
        }
    }

    /**
     * タスクシグネチャ生成（重複検出用）。フローの joined ソース（タスク行
     * segment + `- ==>` 子行 segment 群）を含むため、発火＝消費でいずれかの
     * 行が書き換わると署名も変わり、同一完了の二重検出が構造的に起きない。
     */
    private getTaskSignature(task: Task): string {
        return `${task.file}|${task.startDate || 'no-date'}|${task.content}|${task.flow ? flowSource(task.flow) : ''}`;
    }
}
