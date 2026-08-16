import { CodeFenceTracker } from '../../../utils/CodeFenceTracker';
import { FLOW_MARKER, matchFlowLine } from '../../flow/FlowLineScanner';
import { parseFlowCells } from '../../flow/FlowParser';
import type { StaticType } from '../../lang/functions';
import type { GenCellTypes } from './GenBodyParser';

/**
 * Every state cell a file declares, by the type it starts from.
 *
 * A block is read without knowing which command fires it — the name in
 * `use(...)` is an expression, and several commands may name the same block —
 * so the file's declarations are read as one set. That is wider than any one
 * firing: a block naming a cell that only some other command carries is left
 * alone here, and the planner, which knows exactly which cells it has, is
 * where that becomes an error. Wide in this direction and not the other, since
 * a complaint about a name that is a cell would be the editor calling correct
 * work wrong.
 *
 * Read per line rather than per command: a multi-line command puts its clauses
 * on lines of their own, and a line carrying only `state(...)` is not a program —
 * the declaration on it is true all the same.
 *
 * Shared rather than owned by one caller. A block is read in three places (the
 * editor's underlines, the rendered preview, the fire) and a reader that
 * skipped this would report every cell as a name nobody declared — which is
 * exactly what the preview did until it was given this.
 *
 * `fenced` is the per-line code-fence mask, since a command written inside a
 * fence is an example rather than a command. Callers that already hold one
 * pass it; the rest let it be built here.
 */
export function declaredCells(lines: string[], fenced?: boolean[]): GenCellTypes {
    const mask = fenced ?? fenceMask(lines);
    const types = new Map<string, StaticType>();
    lines.forEach((text, i) => {
        if (mask[i]) return;
        const tail = flowTailOf(text);
        if (tail === null) return;
        for (const cell of parseFlowCells(tail)) {
            // A literal is never a list or a record, and a type this map has no
            // word for would be a claim about the cell that is not true.
            if (cell.value.type === 'array' || cell.value.type === 'record') continue;
            const known = types.get(cell.name);
            // The same name declared with two types in one file: nothing true
            // can be said about it, and 'error' is how this checker says so
            // without a second complaint of its own.
            types.set(cell.name, known === undefined || known === cell.value.type ? cell.value.type : 'error');
        }
    });
    return types;
}

/** Both readings of the fence rule, the way every other caller ORs them. */
function fenceMask(lines: string[]): boolean[] {
    const document = CodeFenceTracker.mask(lines);
    const subtree = CodeFenceTracker.subtreeMask(lines);
    return lines.map((_, i) => document[i] || subtree[i]);
}

/** The command text of a line: a task line's tail, or a flow child line's. */
function flowTailOf(text: string): string | null {
    const child = matchFlowLine(text);
    if (child) return child.tail;
    const marker = text.indexOf(FLOW_MARKER);
    return marker === -1 ? null : text.slice(marker + FLOW_MARKER.length);
}
