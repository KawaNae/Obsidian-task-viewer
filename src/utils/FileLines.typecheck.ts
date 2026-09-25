import type { App, TFile } from 'obsidian';
import { processLines, type WriteChannel } from './FileLines';
import type { WriteObserver } from '../services/persistence/WriteObserver';
import type { TaskRepository } from '../services/persistence/TaskRepository';
import type { PlannedTarget } from '../services/persistence/TaskRefs';
import type { Task } from '../types';

/**
 * Compile-time checks on how a write reaches the file. Nothing imports this
 * file, so it is never bundled; `tsc` reads it with the rest of `src` (the
 * build runs `tsc -noEmit` first), and a check that stops holding fails the
 * build.
 *
 * Each `@ts-expect-error` is the check: it is itself an error when the line
 * under it compiles. Together they say that a write cannot change the file
 * without the change being reported: the lines can only be changed through
 * the draft, which reports every change as it makes it.
 */
export function writeSignatureChecks(app: App, file: TFile, channel: WriteChannel | undefined, writes: WriteObserver): void {
    // A line assigned past the draft would be an edit nobody heard of.
    void processLines(app, file, channel, (draft) => {
        // @ts-expect-error the lines are read-only to the write
        draft.lines[0] = 'changed';
        return true;
    });

    // Nor can a write hand back lines of its own making: it says whether to
    // write, and what is written is what the draft holds.
    // @ts-expect-error the callback answers yes or no, not with lines
    void processLines(app, file, channel, (draft) => [...draft.lines]);

    // Leaving the channel out would leave out the report with it, so every
    // write names one, even when there is none to name.
    // @ts-expect-error the channel is not optional
    void processLines(app, file, () => true);

    // A write says whom it was made for — the user or a flow — so the claim
    // it files can say so too.
    // @ts-expect-error the origin is not optional
    void writes.for('note.md');
}

/**
 * Compile-time checks on how a write takes its line: only through
 * `WriteSession.row`, and only with what it was planned from. A write that
 * could take a line without checking the plan would write the plan over an
 * edit the plan never saw.
 */
export function rowSignatureChecks(
    app: App, file: TFile, channel: WriteChannel | undefined, task: Task, repository: TaskRepository,
): void {
    void processLines(app, file, channel, (_draft, _eol, session) => {
        // A coordinate alone is not a row to write on: the basis goes with it.
        // @ts-expect-error a row is named with its basis
        session.row({ line: task.line, subject: 'x' });
        // Nor is there a way round the check to the bare coordinate.
        // @ts-expect-error the session answers rows, not locations
        session.locate(task.line);
        return false;
    });

    // A target without what it was planned from does not exist.
    // @ts-expect-error the basis is not optional
    const unplanned: PlannedTarget = { file: task.file, line: task.line, subject: 'x' };
    void unplanned;

    // The index's copy is not a target: an update, a delete and a duplicate are
    // named with their plan.
    // @ts-expect-error an update names its row with a plan
    void repository.updateTaskInFile(task, task);
    // @ts-expect-error a delete names its row with a plan
    void repository.deleteTaskFromFile(task);
    // @ts-expect-error a duplicate names its row with a plan
    void repository.duplicateInlineTaskInPlace(task, { kind: 'verbatim', count: 1 });
}
