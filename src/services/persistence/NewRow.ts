import { Outline } from '../parsing/utils/Outline';
import { draftOver } from './FileLines';
import type { PropertyEdit } from './PropertyUpdatePlanner';
import { ChildPropertyLineEditor, type PropertyRefusal } from './utils/ChildPropertyLineEditor';
import { Block, type PlacedLine } from './utils/Placement';

/**
 * A row a write puts in a note: its line, and the property lines that go
 * under it as its first children. What every write that adds a row is
 * handed (`Operations.putInNote`, `insertLine`, `putInDailyNote`, the
 * `insert` op); a row with no `properties` is its line alone.
 */
export interface NewRow {
    line: string;
    properties?: PropertyEdit;
}

/**
 * The lines `row` puts in, as one block: its line, and under it the property
 * lines its `properties` write, spelled and indented as a write to a row
 * already there spells and indents them (`ChildPropertyLineEditor.applyOps`,
 * over a draft holding the row's line alone). Put as one block, the row and
 * its property lines are written together, and each property line reads as
 * the row's child: a property line put by itself below a row put in the
 * same write would be one the row takes in from past its block, which the
 * write's check refuses (`checkWrite`).
 *
 * The row's line is read with no indentation; the put writes the block at
 * the spot's (`Block.at`), and `unit` is the one level the property lines go
 * under it (`ObsidianConfig.indentUnit`).
 *
 * @returns the block; or why the properties could not be written, its
 * `line` that of the block (0 is the row's), and nothing is to be written.
 */
export function rowBlock(row: NewRow, unit: string): PlacedLine[] | PropertyRefusal {
    const { draft } = draftOver([Outline.dedent(row.line)]);
    if (row.properties) {
        const refused = ChildPropertyLineEditor.applyOps(draft, 0, row.properties, unit);
        if (refused) return refused;
    }
    return Block.read(draft.lines);
}
