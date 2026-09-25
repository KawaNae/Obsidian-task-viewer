import { type App, Notice } from 'obsidian';
import type { Task, TaskViewerSettings } from '../../types';
import { t } from '../../i18n';
import { DateUtils } from '../../utils/DateUtils';
import { logError, logInfo, logWarn } from '../../log/log';
import type { TaskIndex } from '../core/TaskIndex';
import { TaskParser } from '../parsing/TaskParser';
import type { TaskRepository } from '../persistence/TaskRepository';
import { EvalError } from '../lang/ExprEvaluator';
import type { FlowEffect } from './FlowEffects';
import { type CreatingEffect, type FlowDeleteAssessment, assessFlowDelete, planFlowForDeletion } from './FlowDeletion';
import type { FlowInstanceInsert } from '../persistence/FlowInstanceLines';
import type { TaskOp } from '../persistence/TaskOps';
import { plannedOn } from '../persistence/TaskRefs';
import type { EditorSubtree, Refusal, WriteOutcome } from '../../utils/FileLines';
import type { PlacedLine } from '../persistence/utils/Placement';
import { flowSource } from './FlowSegments';
import { type FlowPlanDeps, GenerationError, planFlow } from './FlowPlanner';
import { canTriggerFlow } from './FlowTrigger';
import { createMomentEvalHost } from './MomentEvalHost';
import { FileParsePipeline } from '../parsing/FileParsePipeline';
import type { GenBlock } from '../parsing/gen/GenBlockCollector';
import { runtimeText } from './runtimeText';

/** The source's write of a move to another file: `ops` applied to the row at `at`. */
export type SourceWrite = (at: EditorSubtree, ops: readonly TaskOp[]) => Promise<WriteOutcome>;

/** How long one failure stays quiet after it has been shown. */
const FAILURE_NOTICE_WINDOW_MS = 5000;

/** The file as it is named in the vault, which is how a user knows it. */
function fileName(path: string): string {
    return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

/**
 * What completing one row fires, planned from the lines the completing write
 * holds (`FlowExecutor.planFire`).
 *
 * - `none`: nothing fires — the row is no task that can fire, or its note is
 *   ignored.
 * - `failed`: the plan failed (an expression, a block). Nothing is written
 *   for the fire, the command stays, and the caller says so once the
 *   completion has landed (`reportDidNotFire`).
 * - `fires`: `ops` are what the fire does to the row in the completing
 *   write. With `away`, the row moves to another file: the completing write
 *   does nothing more (`ops` is empty), the destination is written next,
 *   and `away.ops` are the source's write once it has landed.
 */
export type FirePlan =
    | { kind: 'none' }
    | { kind: 'failed'; task: Task; error: EvalError | GenerationError }
    | { kind: 'fires'; task: Task; ops: TaskOp[]; away: AwayMove | null };

/** A move to another file a fire planned: where to, the row as it goes there, and what the source's write does. */
export interface AwayMove {
    destPath: string;
    /** The row as the destination is to read it. */
    content: string;
    /** The source's write once the destination landed: the next instance, and the original taken away. */
    ops: TaskOp[];
}

/** A `fire` op, and what its plan answered the last time a write ran it. */
export interface FireOp {
    op: Extract<TaskOp, { kind: 'fire' }>;
    /** The plan of the write's last run, or null while no write has run it. */
    planned(): FirePlan | null;
    /** The move to another file the write's last run planned, with where the row stood, or null. */
    away(): PendingAway | null;
}

/**
 * A move to another file a completing write planned, made after it: the
 * archive to append to the destination, and the source's write once it has
 * landed, to the row as the completing write left it (`source`, its line and
 * subtree in the lines written). The source's write is made only if the row
 * still reads so. Where it looks for the row is the caller's (`SourceWrite`):
 * an editor's completion at the line its transactions have carried `source`
 * to, and a write to a line the editor pointed at or a card's completion at
 * `source.line`, the line the completing write left the row on. A line
 * written above it from outside in between refuses the source's write.
 */
export interface PendingAway {
    task: Task;
    destPath: string;
    archive: PlacedLine[];
    source: EditorSubtree;
    ops: TaskOp[];
}

/**
 * Flow-command runtime: plans what completing a row fires (pure), from the
 * lines the completing write holds, and what deleting a row with a command
 * writes first. A completion fires from the operation that completed the row
 * — an editor's transaction, the plugin's own write — and from nothing else:
 * no reading of a file, a scan's or a sync's, has a way to fire.
 */
export class FlowExecutor {
    private readonly host = createMomentEvalHost();
    /** Failures already shown, by task and message, with when they were shown. */
    private readonly recentFailures = new Map<string, number>();

    constructor(
        private repository: TaskRepository,
        private taskIndex: TaskIndex,
        private app: App,
        private getSettings: () => TaskViewerSettings
    ) { }

    /**
     * What completing the row at `line` of `lines` fires: the one place a
     * completion's fire is planned, for the editor's transaction and for the
     * plugin's own write alike. The caller has already answered that the
     * operation completed the row (`completes`); this reads the lines it
     * holds, the ones it is about to write, so there is no older copy of the
     * row for the plan to be made from.
     *
     * Nothing is read unless a `==>` stands on the row or below it: a
     * command is the row's own or its subtree's, and both are at or past the
     * row. A condition for speed only; it never changes the answer.
     */
    planFire(path: string, lines: readonly string[], line: number): FirePlan {
        let commanded = false;
        for (let i = line; i < lines.length && !commanded; i++) commanded = lines[i].includes('==>');
        if (!commanded) return { kind: 'none' };
        const parsed = FileParsePipeline.parse(path, [...lines], this.getSettings());
        if (parsed.ignored) return { kind: 'none' };
        const task = parsed.tasks.find(candidate => candidate.line === line);
        if (!task || !canTriggerFlow(task, this.getSettings().statusDefinitions)) return { kind: 'none' };
        return this.planTask(task, name => parsed.genBlocks.get(name));
    }

    /**
     * The fire of a row read as `task`, its blocks looked up by `blockNamed`:
     * the plan, and what it does to the row, as ops.
     */
    planTask(task: Task, blockNamed: (name: string) => GenBlock | undefined): FirePlan {
        const program = task.flow?.program;
        if (!program) return { kind: 'none' };
        logInfo(`[Flow:completion] taskId=${task.id} flow="${task.flow ? flowSource(task.flow) : ''}"`);
        let effects: FlowEffect[];
        try {
            effects = planFlow(task, program, { ...this.buildDeps(), getBlock: (_file, name) => blockNamed(name) });
        } catch (err) {
            if (err instanceof EvalError || err instanceof GenerationError) {
                // Runtime expression failure (e.g. unset property), or a
                // block that cannot produce the next instance: do not fire
                // and do not consume — the command stays for the user to
                // fix, and the message explains why.
                logWarn(`[FlowExecutor] Flow did not fire for ${task.id}: ${err.message}`);
                return { kind: 'failed', task, error: err };
            }
            throw err;
        }
        const ops = effects.flatMap(effect => {
            logInfo(`[Flow:effect] ${effect.kind} taskId=${task.id}`);
            return this.opsFor(task, effect);
        });
        const away = effects.find(
            (effect): effect is Extract<FlowEffect, { kind: 'archive-to' }> =>
                effect.kind === 'archive-to' && effect.destPath !== task.file);
        if (away) {
            return { kind: 'fires', task, ops: [], away: { destPath: away.destPath, content: TaskParser.format(away.archivedTask), ops } };
        }
        return { kind: 'fires', task, ops, away: null };
    }

    /**
     * A `fire` op for a write to `path` that completes a row, with what its
     * plan answered. `vault.process` may run a write's callback more than once;
     * what counts is the last run, the one that was written.
     */
    fireOp(path: string): FireOp {
        let last: FirePlan | null = null;
        let away: PendingAway | null = null;
        return {
            op: {
                kind: 'fire',
                plan: (lines, line) => {
                    const plan = this.planFire(path, lines, line);
                    last = plan;
                    away = null;
                    if (plan.kind !== 'fires') return [];
                    if (plan.away) {
                        // Nothing else of the fire is in this write, so the row
                        // and its subtree are as it leaves them.
                        const archive = this.repository.archiveOf(lines, line, plan.away.content);
                        away = {
                            task: plan.task,
                            destPath: plan.away.destPath,
                            archive: archive.block,
                            source: { line, text: lines[line], subtree: archive.subtree },
                            ops: plan.away.ops,
                        };
                    }
                    return plan.ops;
                },
            },
            planned: () => last,
            away: () => away,
        };
    }

    /**
     * What a completing write owes once it has landed: the notice of a fire
     * that could not be planned, and the rest of a move to another file.
     * `writeSource` makes the source's write (to the file, or to the editor
     * that completed the row).
     */
    async settleFire(fire: FireOp, writeSource: SourceWrite): Promise<void> {
        const planned = fire.planned();
        if (planned?.kind === 'failed') this.reportDidNotFire(planned.task, planned.error);
        const away = fire.away();
        if (away) await this.finishAway(away, writeSource);
    }

    /**
     * The rest of a move to another file, after the completion landed: the
     * destination first — until it has landed nothing in the source is
     * touched, so a move whose archive cannot be written leaves the row
     * completed with its command, and says so — and then the source's write,
     * the next instance with the original taken away. That write can still be
     * refused, and then the task is in both files, which is told once. Handing
     * a move from one file to the other is F8's.
     */
    async finishAway(away: PendingAway, writeSource: SourceWrite): Promise<void> {
        if (!(await this.repository.appendArchive(away.destPath, away.archive))) {
            // Told to the user by the write layer, which refused it.
            logWarn(`[FlowExecutor] Flow did not fire, nothing written: ${away.task.id}`);
            return;
        }
        const outcome = await writeSource(away.source, away.ops);
        if (outcome.refused) this.reportMoveLeftCopy(away.task, away.destPath, outcome.refused);
    }

    /**
     * What deleting this task would cost, decided before anything is written.
     *
     * The planner is pure, so the dialog can be shown the very line the fire
     * would go on to write. Nothing is queued and nothing is touched.
     */
    assessDeletion(task: Task): FlowDeleteAssessment {
        return assessFlowDelete(task, this.buildDeps(), id => this.taskIndex.getTask(id));
    }

    /**
     * Write the next instance, then remove this one, as one write. The
     * index runs it behind every write already asked of the row
     * (`TaskIndex.onRow`), so it is planned from the copy the last of them
     * left. Awaited, so the caller's own rescan runs after the write has
     * landed.
     *
     * @returns whether the task is gone. False when the fire could not be
     * planned, which stops the delete.
     */
    async fireAndDelete(task: Task): Promise<boolean> {
        logInfo(`[Flow:delete] taskId=${task.id} flow="${task.flow ? flowSource(task.flow) : ''}"`);
        try {
            return await this.executeDeletionFire(task);
        } catch (err) {
            // Answered, not thrown: the menu that asked waits on the answer.
            logError(`[FlowExecutor] Error deleting task ${task.id}: ${(err as Error)?.message ?? err}`);
            return false;
        }
    }

    /**
     * The delete the user asked for, with the series carried past it.
     *
     * A failed plan stops the delete. The command is still on the line and
     * the line is what was about to go, so removing it now would lose exactly
     * what the user asked to keep. Having nothing to generate is a different
     * answer: an expired command has nothing left to lose, and the delete
     * goes ahead.
     *
     * What the fire writes and what the delete takes away are one write (see
     * {@link TaskRepository.applyToTask}). They used to be two, and the second
     * one resolved the original by its text after the first had written a line
     * worded exactly like it — which is how a delete came to take the instance
     * it had just created, leaving the file as it started and the task still
     * on the page. One write also settles the outcome the two of them could
     * not: an instance can no longer be left standing beside an original that
     * would not go.
     *
     * @returns whether the task is gone. A fire that could not be planned
     * answers no and writes nothing. A line that could not be resolved answers
     * no and writes nothing either — nothing is written that the user would
     * then have to clear away by hand.
     */
    private async executeDeletionFire(task: Task): Promise<boolean> {
        const read = this.readingBlocks();
        const outlook = planFlowForDeletion(task, read.deps);

        if (outlook.kind === 'failed') {
            logWarn(`[FlowExecutor] Delete cancelled, flow did not fire for ${task.id}: ${outlook.error.message}`);
            this.reportDidNotFire(task, outlook.error, 'notice.flowDeleteDidNotFire');
            return false;
        }

        const inserts: TaskOp[] = outlook.kind === 'creates'
            ? outlook.effects.map(effect => {
                logInfo(`[Flow:effect] ${effect.kind} taskId=${task.id} (with the delete)`);
                return { kind: 'insert-instance', insert: this.instanceInsertFor(task, effect) };
            })
            : [];

        // The instance goes in first, at the head of the sibling group, and
        // the removal follows at the row's line carried across that insert.
        const { written: removed } = await this.repository.applyToTask(
            plannedOn(task, { commands: true, subtree: true, blocks: read.blocks }), [...inserts, { kind: 'remove' }]);
        if (!removed) {
            // Told to the user by the write layer, which refused it.
            logWarn(`[FlowExecutor] Flow fired but the original could not be deleted: ${task.id}`);
        }
        return removed;
    }

    /**
     * The same next instance {@link applyEffect} would write, handed over as
     * lines-to-be rather than written on the spot.
     *
     * The two paths read one effect the same way — a recurrence is formatted
     * here and a generated instance arrives finished — and they render it with
     * the same function, so a deletion fire and an ordinary one cannot come to
     * write different lines for the same command.
     */
    private instanceInsertFor(task: Task, effect: CreatingEffect): FlowInstanceInsert {
        if (effect.kind === 'create-next') {
            return {
                kind: 'recurrence',
                content: TaskParser.format(effect.newTask),
                flowLines: (effect.newTask.flow?.childSegments ?? []).map(s => s.raw),
            };
        }
        // Reported rather than dropped, on this path as on the other: the
        // written line differs from the one the block describes, and nothing
        // else will say so.
        for (const w of effect.warnings) {
            logWarn(`[Flow:generated] ${task.id}: ${w.message}`);
        }
        return {
            kind: 'generated',
            parentLine: effect.parentLine,
            flowLines: effect.flowLines,
            children: effect.children,
        };
    }

    /**
     * Tell the user that a move reached its destination and left the original
     * where it was: the task is in two places now, and nothing on screen says
     * so. One notice, saying both — the refusal of the source's write would
     * otherwise be a second one, telling half of it.
     */
    reportMoveLeftCopy(task: Task, destPath: string, refused: Refusal): void {
        logWarn(`[FlowExecutor] Moved but the original could not be removed: ${task.id} (${refused.reason.kind})`);
        const reason = refused.reason.kind === 'gone'
            ? t('notice.moveOriginGone')
            : refused.reason.kind === 'unplaceable'
                ? t('notice.moveOriginUnplaceable')
                : refused.reason.kind === 'disturbs'
                    ? t('notice.moveOriginDisturbs')
                    : t('notice.moveOriginChanged');
        new Notice(t('notice.moveOriginKept', { dest: fileName(destPath), reason, subject: refused.subject }));
    }

    /** What one effect does in the row's own file, as the write applies it. */
    private opsFor(task: Task, effect: FlowEffect): TaskOp[] {
        switch (effect.kind) {
            case 'create-next':
            case 'create-generated':
                return [{ kind: 'insert-instance', insert: this.instanceInsertFor(task, effect) }];
            case 'strip-flow':
                // The row without its command. A completion's fire reads the
                // row from the lines its write holds, so this is the row as it
                // is written; a deletion's is checked against the row it was
                // planned from (`plannedOn`).
                return [{ kind: 'strip-flow', text: TaskParser.format({ ...task, flow: undefined }) }];
            case 'archive-to':
                // To another file it is written after the completing write
                // (see finishAway). Within the file it is one op: the row is
                // carried to the end, so the moved row is the row that fired,
                // and taking it from where it stood is part of the carrying.
                return effect.destPath === task.file
                    ? [{ kind: 'move-to-end', text: TaskParser.format(effect.archivedTask) }]
                    : [];
            case 'delete-original':
                // Within the file, done by `move-to-end` above.
                return effect.destPath === task.file ? [] : [{ kind: 'remove' }];
        }
    }

    /**
     * Tell the user that the check they ticked did nothing.
     *
     * Not firing and not consuming is the design — a command whose expression
     * failed has to stay on the line — but from the outside it is a checkbox
     * that answers with nothing at all. The log line was the only trace, and
     * nobody has the console open while ticking a task.
     *
     * The same failure is shown once per window. A task is toggled on and off
     * while its author works out what is wrong, and a notice per toggle would
     * bury the file behind its own complaint. A different failure is a
     * different message, so fixing one and hitting the next is still visible.
     *
     * A delete that stopped for the same reason says so in its own sentence.
     * The task is still on the page and the user is watching for it to go, so
     * "the flow did not fire" would leave them to work out that the delete
     * did not happen either.
     */
    reportDidNotFire(
        task: Task,
        err: EvalError | GenerationError,
        messageKey: 'notice.flowDidNotFire' | 'notice.flowDeleteDidNotFire' = 'notice.flowDidNotFire',
    ): void {
        const now = Date.now();
        // Drop what has aged out on the way past, so a long session does not
        // keep a key for every failure it has ever seen.
        for (const [key, at] of this.recentFailures) {
            if (now - at >= FAILURE_NOTICE_WINDOW_MS) this.recentFailures.delete(key);
        }
        // Which failure this is, said in neither language: the code and the
        // values it was given. Keying on the sentence would make the same
        // failure a different one as soon as the vault changes language.
        const key = `${messageKey}::${task.id}::${err.code}::${JSON.stringify(err.params ?? {})}`;
        if (this.recentFailures.has(key)) return;
        this.recentFailures.set(key, now);
        new Notice(t(messageKey, { reason: runtimeText(err), file: fileName(task.file) }));
    }

    /**
     * Plan dependencies that remember the generation blocks the plan read, so
     * the write can find them still reading that way (see `plannedOn`).
     */
    private readingBlocks(): { deps: FlowPlanDeps; blocks: Array<{ name: string; body: readonly string[] }> } {
        const deps = this.buildDeps();
        const blocks: Array<{ name: string; body: readonly string[] }> = [];
        return {
            blocks,
            deps: {
                ...deps,
                getBlock: (filePath, name) => {
                    const block = deps.getBlock(filePath, name);
                    if (block) blocks.push({ name: block.name, body: [...block.body] });
                    return block;
                },
            },
        };
    }

    private buildDeps(): FlowPlanDeps {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return {
            today: DateUtils.getLocalDateString(now),
            now: {
                date: DateUtils.getLocalDateString(now),
                time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
            },
            weekStartDay: this.getSettings().weekStartDay,
            host: this.host,
            getBlock: (filePath, name) => this.taskIndex.getGenBlock(filePath, name),
        };
    }
}
