import { collectFlowLineIndices, flowLineTail } from '../parsing/utils/FlowLineScanner';
import { collectGenBlocks } from '../parsing/gen/GenBlockCollector';
import { Outline, type OutlineReading } from '../parsing/utils/Outline';

/**
 * What an operation was planned from: what the plan read of the row, as the
 * index read it. A write that names its row carries this, and the write is
 * made only if the file still reads that way (see {@link readsAsPlanned}).
 *
 * Only what the plan read is here. A card's update makes the row's line from
 * the index's copy of it, and its property lines too when it rewrites them
 * (a tag list is written whole from the copy's); a fire reads the command lines and the generation
 * blocks as well; an operation that takes the row away, or carries it, takes
 * its subtree with it, so it has read the subtree too. What a plan did not
 * read, an edit made since cannot make wrong, and is not checked.
 */
export interface RowBasis {
    /** The row's line, as the index read it, indentation included. */
    text: string;
    /** The text after `==>` on each of the row's own command lines, in order. */
    commands?: readonly string[];
    /**
     * The row and every line of its subtree, verbatim, for an operation that
     * takes them away or carries them (`OutlineReading.subtreeEnd`).
     */
    subtree?: readonly string[];
    /**
     * The `tv-gen` blocks of the row's file the plan read, by name, with their
     * body as it read it. A block is the other half of a generated instance's
     * plan: edited since, it would be written as it no longer reads.
     */
    blocks?: ReadonlyArray<{ name: string; body: readonly string[] }>;
}

/**
 * The basis of a write that stays on the weaker comparison until stage F9:
 * the row's line has to read as the index's copy of it, its indentation
 * aside, rather than verbatim.
 *
 * A timer's record only, as the index asks for it
 * (`TaskIndex.recordChildTask`, `insertSiblingAfterTask`): a child added
 * from a card's menu, the API or the CLI goes through the same writer inserts
 * planned from the copy (`TaskRefs.InsertTarget`), and so is checked against
 * the reading its name was read in. A timer that is
 * stopped writes its record and closes whatever the write answers
 * (`TimerLifecycle.finishTimer`), so a write refused where a row was only
 * moved under another would lose the measurement, not just wait for the
 * scan. Taking the answer is F9's. The record rewrites no row: it puts a new
 * line beside the one it names.
 */
export interface OnRecord {
    kind: typeof ON_RECORD;
    /** The row's line as the index's copy holds it. */
    text: string;
}

export const ON_RECORD = 'on-record' as const;

/** The weaker basis for a row whose copy reads `text` (see {@link OnRecord}). */
export function onRecord(text: string): OnRecord {
    return { kind: ON_RECORD, text };
}

export function isOnRecord(basis: RowBasis | OnRecord): basis is OnRecord {
    return 'kind' in basis && basis.kind === ON_RECORD;
}

/** Whether the row at `line` reads as its copy, its indentation aside (see {@link OnRecord}). */
export function readsAsRecorded(lines: readonly string[], line: number, basis: OnRecord): boolean {
    return Outline.UP_TO_INDENT.holds(lines[line], basis.text);
}

/**
 * Whether the row at `line` still reads as the operation's plan read it.
 *
 * A plan made from a copy the file has moved on from would otherwise be
 * written over what moved it: an update putting the row back to an older
 * text, a fire consuming a command line edited since, a delete taking a child
 * written after the index read the row.
 */
export function readsAsPlanned(lines: readonly string[], line: number, basis: RowBasis): boolean {
    if (!Outline.VERBATIM.holds(lines[line], basis.text)) return false;
    const outline = Outline.read(lines);
    if (basis.commands) {
        const commands = collectFlowLineIndices(outline, line).map(i => flowLineTail(lines[i]));
        if (commands.length !== basis.commands.length) return false;
        if (commands.some((command, i) => command !== basis.commands![i])) return false;
    }
    if (basis.subtree && !sameLines(subtreeAt(outline, line), basis.subtree)) return false;
    if (basis.blocks) {
        const current = collectGenBlocks([...lines]).blocks;
        for (const block of basis.blocks) {
            const body = current.get(block.name)?.body;
            if (!body || !sameLines(body, block.body)) return false;
        }
    }
    return true;
}

/** The row at `line` and every line of its subtree, verbatim. */
export function subtreeAt(outline: OutlineReading, line: number): string[] {
    return outline.lines.slice(line, outline.subtreeEnd(line));
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((text, i) => Outline.VERBATIM.holds(text, b[i]));
}
