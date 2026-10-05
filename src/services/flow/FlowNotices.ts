import { Notice } from 'obsidian';
import type { Task } from '../../types';
import { t } from '../../i18n';
import { logWarn } from '../../log/log';
import type { EvalError } from '../lang/ExprEvaluator';
import type { Refusal } from '../persistence/FileLines';
import type { FiringOutcome } from '../persistence/FiringTrials';
import { subjectOf } from '../persistence/TaskRefs';
import { refusalClause } from '../core/RefusalClause';
import type { FireOp, FirePlan } from './FlowExecutor';
import type { GenerationError } from './FlowPlanner';
import { runtimeText } from './runtimeText';

/** How long one failure stays quiet after it has been shown. */
const FAILURE_NOTICE_WINDOW_MS = 5000;

/** The file as it is named in the vault, which is how a user knows it. */
function fileName(path: string): string {
    return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

/**
 * Why a completion's flow was not run ({@link notRunsOf}): the fire's plan
 * failed, or the fire was set aside, for the reason the write with it in it
 * was refused.
 */
export type NotRun =
    | Extract<FirePlan, { kind: 'failed' }>
    | { kind: 'refused'; refusal: Refusal };

/**
 * What the user is owed of one fire of a write that landed: set aside, the
 * refusal it met; else its plan, if it failed; else nothing.
 */
function notRunOf({ fire, setAside }: { fire: FireOp; setAside: Refusal | null }): NotRun | null {
    if (setAside) return { kind: 'refused', refusal: setAside };
    const plan = fire.planned();
    return plan?.kind === 'failed' ? plan : null;
}

/**
 * What the user is owed of a write that may have completed rows
 * (`FiringOutcome`): for each row whose flow was not run, one word, in the
 * order the rows stand. Nothing for a write that was refused, which was told
 * as a refusal is. The one rule of it, for a card's write, a send and the
 * editor's transaction alike.
 */
export function notRunsOf(outcome: FiringOutcome<FireOp>): NotRun[] {
    if (!outcome.written) return [];
    const notRuns: NotRun[] = [];
    for (const fired of outcome.fires) {
        const notRun = notRunOf(fired);
        if (notRun) notRuns.push(notRun);
    }
    return notRuns;
}

/**
 * The notices of the flow: what the user is told when a completion's flow
 * was not run, and when a delete stopped because its fire could not be
 * planned.
 *
 * Not firing and not consuming is the design — a command whose expression
 * failed has to stay on the line — but from the outside it is a checkbox
 * that answers with nothing at all. The log line was the only trace, and
 * nobody has the console open while ticking a task.
 */
export class FlowNotices {
    /** Failures already shown, by notice, task and failure, with when they were shown. */
    private readonly recentFailures = new Map<string, number>();

    /**
     * Tell the user of each row a write completed whose flow was not run, and
     * why, once the write landed ({@link notRunsOf}). A fire set aside is
     * told every time: the write was refused for something the note says
     * now. The same failure of a plan is shown once per window
     * ({@link shownLately}).
     */
    firing(outcome: FiringOutcome<FireOp>): void {
        for (const why of notRunsOf(outcome)) {
            if (why.kind === 'refused') {
                const { reason, subject, file } = why.refusal;
                logWarn(`[FlowNotices] fire refused, completion written: file=${file} reason=${reason.kind} subject=${subject}`);
                new Notice(t('notice.flowNotRun', { reason: refusalClause(reason), subject }));
                continue;
            }
            if (this.shownLately('notice.flowNotRun', why.task, why.error)) continue;
            new Notice(t('notice.flowNotRun', { reason: runtimeText(why.error), subject: subjectOf(why.task) }));
        }
    }

    /**
     * Tell the user a delete stopped because its fire could not be planned,
     * in a sentence of its own: the task is still on the page and the user is
     * watching for it to go, so "the flow was not run" would leave them to
     * work out that the delete did not happen either. Once per window, as a
     * failed plan of a completion is.
     */
    deletionStopped(task: Task, error: EvalError | GenerationError): void {
        if (this.shownLately('notice.flowDeleteDidNotFire', task, error)) return;
        new Notice(t('notice.flowDeleteDidNotFire', { reason: runtimeText(error), file: fileName(task.file) }));
    }

    /**
     * Whether the notice `notice` of this failure of the task's plan was shown
     * within the window; if not, it counts as shown now. A task is toggled on
     * and off while its author works out what is wrong, and a notice per
     * toggle would bury the file behind its own complaint. A different
     * failure is a different message, so fixing one and hitting the next is
     * still visible.
     */
    private shownLately(notice: string, task: Task, err: EvalError | GenerationError): boolean {
        const now = Date.now();
        // Drop what has aged out on the way past, so a long session does not
        // keep a key for every failure it has ever seen.
        for (const [key, at] of this.recentFailures) {
            if (now - at >= FAILURE_NOTICE_WINDOW_MS) this.recentFailures.delete(key);
        }
        // Which failure this is, said in neither language: the code and the
        // values it was given. Keying on the sentence would make the same
        // failure a different one as soon as the vault changes language.
        const key = `${notice}::${task.id}::${err.code}::${JSON.stringify(err.params ?? {})}`;
        if (this.recentFailures.has(key)) return true;
        this.recentFailures.set(key, now);
        return false;
    }
}
