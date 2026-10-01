import type {
    DraftEdit, EditTrials, EditedLines, LineDraft, Refusal, RowTarget, WriteMade, WriteRefused, WriteSession,
} from './FileLines';
import type { TaskOp } from './TaskOps';

/**
 * The one loop that applies ops to a row inside a write
 * (`InlineTaskWriter.applyOps`), as a function: what {@link firingTrials}
 * applies each fire with, the writer's own or the one the editor's host
 * hands in.
 */
export type ApplyOps = (draft: LineDraft, session: WriteSession, target: RowTarget, ops: readonly TaskOp[]) => boolean;

/**
 * The fire of a write that completes a row, handed in with the op by the flow
 * layer (`FlowExecutor.fireOp`).
 *
 * The completion is the user's and the fire follows from it, so a fire that
 * writes lines never takes the completion down with it: a write refused with
 * the fire in it, whatever it was refused for, is tried without it. Where one
 * write completes several rows, each row's fire stands or is set aside on its
 * own ({@link firingTrials}): for a card's write, a send and the editor's
 * transaction alike.
 */
export interface CompletionFire {
    op: Extract<TaskOp, { kind: 'fire' }>;
}

/**
 * What came of a write that may complete rows: refused whole, and nothing
 * written; or made, with each fire of a row it completed, in the order the
 * rows stand, and the refusal the write met with that fire in it when it was
 * set aside (`setAside`: the completion is written without it, and the user
 * is owed a word of it, `FlowNotices`), else null.
 */
export type FiringOutcome<F extends CompletionFire = CompletionFire> =
    | WriteRefused
    | (WriteMade & { fires: ReadonlyArray<{ fire: F; setAside: Refusal | null }> });

/** The fires {@link firingTrials} settled on, each with the refusal it was set aside with, else null. */
export type SettledFires<F extends CompletionFire> = ReadonlyArray<{ fire: F; setAside: Refusal | null }>;

/**
 * The edits one write of `base` and its fires tries, to settle on the one it
 * writes (`EditTrials`): the one rule of which fires of a completion are
 * written. What `InlineTaskWriter.writeFiring` writes to its note, what a send
 * tries first on the lines of a note to learn what the write will leave of
 * its rows (`SendWriter`), and what the editor writes into the transaction
 * that completed rows (`FlowFireExtension`). `settled` answers what the last
 * settle chose: each fire and the refusal it was set aside with, and what
 * `after` answered in the edit chosen.
 *
 * `base` does the write's own edit and answers the rows it completed, where
 * its session finds them (the row the write names, a line it marked), in the
 * order they stand; false when it gave the write up. Each row's fire is
 * `fire()`, asked once per row in each settle, and applied with `applyOps`
 * after `base`, row by row, the ones above first, each planned from the lines
 * the fires before it left. A fire that carries a row below it (a parent's
 * move) carries it through the write's own report, and the row fires where it
 * went, once.
 *
 * `after`, when given, is the rest of the write, done once the fires are: an
 * edit of rows the fires may have changed or moved, which it finds through
 * the session where they left them — a send carries the rows its draft
 * completed once they fired where they stood (`SendWriter`). It is part of
 * every try, the one without fires too; false gives the write up, as from
 * `base`, and anything else is what it answers of the edit.
 *
 * The write is tried with every fire first, which is the one try when
 * nothing is refused. Refused with a fire in it, it is tried with none:
 * refused so too, the refusal is the write's own, and nothing is written.
 * Otherwise the fires are put back one at a time, from the top, each kept if
 * the write with it and the ones kept before it is made, and set aside, with
 * the refusal it met, if not: the completion stands without it, its command
 * stays on the row, and the user is owed a word of it (`FiringOutcome`). All
 * of it is tried on the lines of one run of the write's callback
 * (`EditTrials`).
 */
export function firingTrials<F extends CompletionFire, A = true>(
    applyOps: ApplyOps,
    base: (draft: LineDraft, session: WriteSession) => readonly RowTarget[] | false,
    fire: () => F,
    after?: (draft: LineDraft, session: WriteSession) => A | false,
): { trials: EditTrials; settled(): { fires: SettledFires<F>; after: A | undefined } } {
    // The last settle's fires, what came of them, and what `after` answered
    // in the edit it chose.
    let fires: F[] = [];
    let setAside = new Map<number, Refusal>();
    let chosen: A | undefined;
    const settle = (tryEdit: (edit: DraftEdit) => EditedLines): EditedLines => {
        fires = [];
        setAside = new Map();
        chosen = undefined;
        const fireAt = (k: number): F => fires[k] ??= fire();
        // How many rows `base` completed, as its last try answered.
        let rows = 0;
        // What `after` answered in each edit made.
        const answers = new Map<EditedLines, A | undefined>();
        // The write with the fires of the rows `kept` names (all of them for
        // null), each after the ones above it.
        const tryWith = (kept: readonly number[] | null): EditedLines => {
            let answered: A | undefined;
            const edited = tryEdit((draft, _eol, session) => {
                answered = undefined;
                const completed = base(draft, session);
                if (completed === false) return false;
                rows = completed.length;
                for (const k of kept ?? completed.keys()) {
                    if (!applyOps(draft, session, completed[k], [fireAt(k).op])) return false;
                }
                if (!after) return true;
                const answer = after(draft, session);
                if (answer === false) return false;
                answered = answer;
                return true;
            });
            if (edited.written) answers.set(edited, answered);
            return edited;
        };
        const choose = (edited: EditedLines): EditedLines => {
            chosen = answers.get(edited);
            return edited;
        };
        const all = tryWith(null);
        if (all.written || rows === 0) return choose(all);
        let made = tryWith([]);
        if (!made.written) return made;
        const kept: number[] = [];
        for (let k = 0; k < rows; k++) {
            // With every fire above it kept, the last is the first try again.
            const withIt = kept.length === k && k === rows - 1 ? all : tryWith([...kept, k]);
            if (withIt.written) {
                kept.push(k);
                made = withIt;
            } else {
                setAside.set(k, withIt.refused);
            }
        }
        return choose(made);
    };
    return {
        trials: { settle },
        settled: () => ({ fires: fires.map((one, k) => ({ fire: one, setAside: setAside.get(k) ?? null })), after: chosen }),
    };
}
