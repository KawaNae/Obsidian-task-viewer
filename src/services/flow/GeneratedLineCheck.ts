import { type Diagnostic, error, warning } from '../lang/Diagnostic';
import type { LocatedDiagnostic } from '../parsing/gen/GenBlockCollector';
import type { GenBody, GenLine } from '../parsing/gen/GenBodyParser';
import { TaskLineClassifier, type TaskLineMatch } from '../parsing/utils/TaskLineClassifier';
import { FLOW_MARKER } from './FlowLineScanner';

/**
 * The verdict on one generated line: the text to write, or the reason it
 * cannot be written. Warnings travel with a pass — they describe something
 * the engine corrected, not something that stopped it.
 */
export type GeneratedLineCheck =
    | { ok: true; line: string; warnings: Diagnostic[] }
    | { ok: false; error: Diagnostic };

/**
 * Check the parent line a generation block produced, and normalize what the
 * engine owns.
 *
 * A block writes markdown, so the shapes that break the next generation are
 * writable: a command the engine is supposed to add, a block id that would be
 * duplicated on every fire, a status that fires again the moment it lands.
 * The static reading of a block cannot catch any of them once interpolation
 * exists, since the offending text can arrive from a value.
 *
 * This runs in the planning layer, just before the parent line is composed,
 * and it must run before any effect is emitted: a failure means the task does
 * not fire and does not consume its command, which is only true while nothing
 * has been written yet.
 *
 * The spans are relative to the trimmed line, which is what a caller would
 * show. There is no file position to give — this text does not exist in any
 * file at the moment it is checked.
 */
export function checkGeneratedParentLine(raw: string): GeneratedLineCheck {
    const line = raw.trim();
    const whole = { start: 0, end: line.length };

    // A command here would be the second one on the line: the engine
    // regenerates the flow clause from the AST, decrements the telomere and
    // writes the cells back. A block that writes its own would decide the
    // accounting by what it printed.
    if (line.includes(FLOW_MARKER)) {
        return {
            ok: false,
            error: error('gen.generated-command',
                `A generated line cannot carry a ${FLOW_MARKER} command — the engine writes the command for the next instance`,
                whole),
        };
    }

    // Every fire would write the same id, so the vault ends up with several
    // lines claiming one anchor and the index keeps one of them. The
    // recurrence path drops the ids it copies for exactly this reason.
    const { blockId } = TaskLineClassifier.extractBlockId(line);
    if (blockId) {
        return {
            ok: false,
            error: error('gen.generated-block-id',
                `A generated line cannot carry a block id — every fire would write '^${blockId}' again`,
                whole, { blockId }),
        };
    }

    const classified = TaskLineClassifier.classify(line);
    if (!classified) {
        return {
            ok: false,
            error: error('gen.generated-not-a-task',
                'The generated parent must be a checkbox line, or the chain has nothing to fire next time',
                whole),
        };
    }

    // Normalized rather than refused: the shape is recoverable, and the line
    // is worth writing. Any status other than a space is dropped, not just
    // the completed ones — which statuses count as complete is a user
    // setting, and a pure check that reads settings would answer differently
    // in two vaults for the same block.
    const statusWarning = parentStatusWarning(classified, whole);
    if (!statusWarning) {
        return { ok: true, line, warnings: [] };
    }
    return {
        ok: true,
        line: classified.prefix + ' ' + classified.suffix,
        warnings: [statusWarning],
    };
}

/**
 * The `gen.generated-status` warning for an already-classified line, or null
 * when the status is blank.
 *
 * Split out of `checkGeneratedParentLine` so the editor's static diagnostics
 * (`staticGeneratedLineWarnings` below) can ask the identical question of a
 * block's literal source, without also running the block-id and command
 * checks around it — those stay errors reserved for the fire-time check,
 * which this stage does not bring into the editor.
 */
function parentStatusWarning(classified: TaskLineMatch, whole: { start: number; end: number }): Diagnostic | null {
    if (classified.statusChar === ' ') return null;
    return warning('gen.generated-status',
        `A generated task starts unchecked; the '${classified.statusChar}' written here is dropped`,
        whole, { status: classified.statusChar });
}

/**
 * Check one generated child line.
 *
 * Only the block id carries over from the parent's rules. A child may hold
 * its own flow command, which is how a template item that fires on its own
 * is written, and a child need not be a checkbox at all — a note bullet
 * under a task is an ordinary thing to generate. The status is left as
 * written, not normalized: correcting it would edit a block body the engine
 * promises not to touch, and the parent-line reasoning about a runaway does
 * not transfer here as an argument for silence — a checked child is indexed
 * as a task of its own (it is not consumed the way the parent's completion
 * is), and the only reason it does not immediately fire its own command is
 * that the write which created it never marks itself as a local edit, which
 * is what firing reads to decide a completion is new. A child that
 * carries both a completed status and its own `==>` is not a shape anyone
 * means to write, so it earns a warning without being refused or rewritten.
 *
 * The id is the one shape that fails the same way it does on the parent.
 * Every fire writes the same anchor again, and the index keeps one of the
 * lines that claim it. The recurrence path drops the ids it copies; a block
 * writes its lines afresh each time, so there is nothing to drop and the
 * text has to be refused instead.
 */
export function checkGeneratedChildLine(raw: string): GeneratedLineCheck {
    const line = raw.trim();
    const { blockId } = TaskLineClassifier.extractBlockId(line);
    if (blockId) {
        return {
            ok: false,
            error: error('gen.generated-block-id',
                `A generated line cannot carry a block id — every fire would write '^${blockId}' again`,
                { start: 0, end: line.length }, { blockId }),
        };
    }

    // Same rule as the parent's completed-status check, and the same reason
    // it does not read settings: which characters count as complete is a
    // user setting, and a check that answered from it would warn in one
    // vault and stay silent in another for the identical line. Only a
    // checkbox can carry this shape, and only when it also carries a
    // command of its own — a checked child with no command fires nothing,
    // so there is nothing to mistype.
    const classified = TaskLineClassifier.classify(line);
    const statusWarning = childStatusWarning(classified, line, { start: 0, end: line.length });
    if (statusWarning) {
        return { ok: true, line, warnings: [statusWarning] };
    }

    return { ok: true, line, warnings: [] };
}

/**
 * The `gen.generated-child-status` warning for an already-classified child
 * line, or null when it does not apply — see `parentStatusWarning` above for
 * why this is split out rather than shared by calling the whole check.
 */
function childStatusWarning(
    classified: TaskLineMatch | null,
    line: string,
    whole: { start: number; end: number },
): Diagnostic | null {
    if (!classified || classified.statusChar === ' ' || !line.includes(FLOW_MARKER)) return null;
    return warning('gen.generated-child-status',
        `A generated child with its own ${FLOW_MARKER} command is written as '${classified.statusChar}', so its command will not fire until it is unchecked and rechecked by hand — this is unlikely to be what was meant`,
        whole, { status: classified.statusChar });
}

/**
 * The same two warnings, read off a block's literal source instead of a
 * rendered instance.
 *
 * A generation block cannot be evaluated in the editor — there is no fire
 * context to run `${...}` against — so this only ever sees the text as
 * written. That is what keeps it silent on a line whose status or `==>`
 * arrives from a value: `TaskLineClassifier`'s checkbox pattern requires the
 * status to be exactly one character, so `[${x}]` does not classify as a
 * task at all, and an `==>` produced by an interpolation's result is not
 * literal text on the line, so `line.includes(FLOW_MARKER)` is false for it.
 * Neither exclusion is special-cased here — both fall out of asking the same
 * question the fire-time check asks, of the unrendered line.
 *
 * Deliberately narrower than `checkGeneratedParentLine`/`checkGeneratedChildLine`:
 * those also refuse a block id, a stray `==>` on the parent, and a
 * non-checkbox parent. Reusing them wholesale would surface those errors
 * here too, which is a bigger claim than "this status is dropped" or "this
 * command will not fire" — calling the two warning functions directly, and
 * nothing else in either check, keeps the editor to the same two questions.
 */
export function staticGeneratedLineWarnings(body: GenBody): LocatedDiagnostic[] {
    // Same coordinate system as the rest of a block's diagnostics — column 0
    // is the start of the raw line, indentation included (GenBodyParser
    // passes the same offset into its own interpolation spans).
    const wholeOf = (genLine: GenLine, line: string) =>
        ({ start: genLine.indent, end: genLine.indent + line.length });

    const out: LocatedDiagnostic[] = [];

    if (body.parent) {
        const line = body.parent.text.trimEnd();
        const classified = TaskLineClassifier.classify(line);
        const d = classified && parentStatusWarning(classified, wholeOf(body.parent, line));
        if (d) out.push({ ...d, line: body.parent.line });
    }

    for (const child of body.children) {
        const line = child.text.trimEnd();
        const classified = TaskLineClassifier.classify(line);
        const d = childStatusWarning(classified, line, wholeOf(child, line));
        if (d) out.push({ ...d, line: child.line });
    }

    return out;
}
