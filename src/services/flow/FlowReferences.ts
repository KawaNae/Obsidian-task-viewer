import type { Task } from '../../types';
import { collectGenBlocks } from '../parsing/gen/GenBlockCollector';
import { Outline } from '../parsing/utils/Outline';
import { Placement } from '../persistence/utils/Placement';

/**
 * A reference in a row's command that the note it is sent to cannot resolve.
 *
 * - `heading`: `move([[#name]])`, where the note has no heading `name`
 *   (`none`), or more than one (`many`). The move fails there either way.
 * - `block`: `use("name")`, where the note has no generation block `name`.
 *   Blocks are the note's own, never carried with a row.
 */
export type UnresolvedReference =
    | { kind: 'heading'; task: Task; name: string; found: 'none' | 'many' }
    | { kind: 'block'; task: Task; name: string };

/**
 * The references in the commands of `rows` that do not resolve in a note
 * holding `destination`: what a row sent there asks of a note it no longer
 * stands in. Asked of the lines a firing would read, the same way it reads
 * them: a heading as a move looks it up (`Placement.heading`), a block as
 * the note's blocks are collected (`collectGenBlocks`).
 *
 * `rows` are the rows sent, each with its descendants: a command is read
 * off the row that holds it. A name written as anything but a string
 * literal is not judged: what it comes to is known only when it fires. A
 * move that names no heading of any note is not either: it is retired, and
 * the parser says so already.
 */
export function unresolvedAt(rows: readonly Task[], destination: readonly string[]): UnresolvedReference[] {
    const outline = Outline.read(destination);
    let blocks: ReadonlySet<string> | undefined;
    const hasBlock = (name: string) => (blocks ??= new Set(collectGenBlocks(destination, outline).blocks.keys())).has(name);

    const out: UnresolvedReference[] = [];
    for (const task of rows) {
        const program = task.flow?.program;
        if (!program) continue;
        const to = program.move?.to;
        if (to?.kind === 'heading') {
            const found = Placement.heading(outline, to.name);
            if (found.kind !== 'one') out.push({ kind: 'heading', task, name: to.name, found: found.kind });
        }
        const name = program.use?.name;
        if (name?.kind === 'lit' && name.value.type === 'string' && !hasBlock(name.value.value)) {
            out.push({ kind: 'block', task, name: name.value.value });
        }
    }
    return out;
}
