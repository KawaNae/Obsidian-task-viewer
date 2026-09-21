import { type Diagnostic, warning } from '../../lang/Diagnostic';
import { FLOW_MARKER } from '../../flow/FlowLineScanner';
import type { TaskLineMatch } from '../utils/TaskLineClassifier';

/**
 * The gen.generated-status warning for an already-classified line, or null
 * when the status is blank.
 *
 * Shared by two callers asking the identical question of two different
 * texts: GeneratedLineCheck's checkGeneratedParentLine, which reads a
 * block's rendered instance at fire time, and GenBodyParser's classify,
 * which reads the block's own literal source — so the same warning reaches
 * the editor's underline and the Live Preview block widget before anything
 * ever fires (see GenBlockPreview for why the widget matters: in Live
 * Preview, Obsidian replaces a closed fence with its rendered widget, and
 * the editor's underlines are hidden along with the raw text they sit on).
 *
 * Kept to this one question — not the block-id or command checks that sit
 * around it in checkGeneratedParentLine — so a static reading only ever
 * says "this status is dropped", never the errors that need the rendered
 * text to judge.
 */
export function parentStatusWarning(classified: TaskLineMatch, whole: { start: number; end: number }): Diagnostic | null {
    if (classified.statusChar === ' ') return null;
    return warning('gen.generated-status',
        `A generated task starts unchecked; the '${classified.statusChar}' written here is dropped`,
        whole, { status: classified.statusChar });
}

/**
 * The gen.generated-child-status warning — see parentStatusWarning above
 * for why this is shared rather than duplicated.
 *
 * `classified` may be null (the line is not a checkbox at all), and `line`
 * carries its own FLOW_MARKER check rather than reading it off `classified`.
 * Both arrive here as a quiet null rather than a special case for the shape
 * a static reading cannot evaluate: a status written as `${x}` fails
 * TaskLineClassifier's one-character pattern and classifies as nothing, and
 * a `==>` produced by evaluating an interpolation's result is not literal
 * text on the line a reader — or the editor, which never evaluates one —
 * can see.
 */
export function childStatusWarning(
    classified: TaskLineMatch | null,
    line: string,
    whole: { start: number; end: number },
): Diagnostic | null {
    if (!classified || classified.statusChar === ' ' || !line.includes(FLOW_MARKER)) return null;
    return warning('gen.generated-child-status',
        `A generated child with its own ${FLOW_MARKER} command is written as '${classified.statusChar}', so its command will not fire until it is unchecked and rechecked by hand — this is unlikely to be what was meant`,
        whole, { status: classified.statusChar });
}
