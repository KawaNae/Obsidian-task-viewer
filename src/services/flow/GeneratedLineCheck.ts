import { type Diagnostic, error, warning } from '../lang/Diagnostic';
import { TaskLineClassifier } from '../parsing/utils/TaskLineClassifier';
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

    if (classified.statusChar === ' ') {
        return { ok: true, line, warnings: [] };
    }

    // Normalized rather than refused: the shape is recoverable, and the line
    // is worth writing. Any status other than a space is dropped, not just
    // the completed ones — which statuses count as complete is a user
    // setting, and a pure check that reads settings would answer differently
    // in two vaults for the same block.
    return {
        ok: true,
        line: classified.prefix + ' ' + classified.suffix,
        warnings: [
            warning('gen.generated-status',
                `A generated task starts unchecked; the '${classified.statusChar}' written here is dropped`,
                whole, { status: classified.statusChar }),
        ],
    };
}
