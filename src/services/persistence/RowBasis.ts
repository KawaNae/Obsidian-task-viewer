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
 * the row's line has to read as some text the plugin has on record for it —
 * as the last scan read it, as a write of ours left it, or as a pending claim
 * says — rather than as the index's copy reads it.
 *
 * The timer's three inserts only (`InlineTaskWriter.insertLineAfterTask`,
 * `insertSiblingAfterTask`, `insertLineAsFirstChild`) — the last of which is
 * also how a child is added from a card's menu or the API. A timer that is
 * stopped writes its record and closes whatever the write answers
 * (`TimerLifecycle.finishTimer`), so a write refused in the moment between a
 * write of ours and the scan that reads it would lose the measurement, not
 * just wait for the scan. Taking the answer is F9's. None of the three
 * rewrites the row it names: each puts a new line beside it.
 */
export const ON_RECORD = 'on-record' as const;
export type OnRecord = typeof ON_RECORD;

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
