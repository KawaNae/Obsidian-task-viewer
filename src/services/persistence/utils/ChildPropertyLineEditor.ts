import { PropertyKey } from '../../parsing/utils/PropertyKey';
import { ITEM_TEXT, PROPERTY_LINE, PropertyLines, type PropertyLine } from '../../parsing/utils/PropertyLines';
import { Outline } from '../../parsing/utils/Outline';
import { Block, Placement } from './Placement';
import type { PropertyEdit, PropertyOp, PropertyWrite } from '../PropertyUpdatePlanner';
import type { LineDraft, RefusalReason } from '../FileLines';

/** Why the property ops of a write were not written (`ChildPropertyLineEditor.applyOps`). */
export type PropertyRefusal = Extract<RefusalReason, { kind: 'property' }>;

/**
 * The writes to a task's own property lines, inside a write
 * (`InlineTaskWriter`, `update`). The lines it writes are the ones the
 * parser reads as the task's (`PropertyLines.ofTask`), and a property is
 * its block: its line, and for a line with no value the items of its list
 * under it.
 *
 * - A line it rewrites keeps its indentation, bullet and key as written,
 *   and so does an item it rewrites: only the value changes
 * - A line it adds goes past the task's last property line's subtree, or
 *   as the task's first child, spelled as the item next to it is; the items
 *   of a list go a level under their line, as a first child does
 *   (`Placement`)
 * - It writes over no block the reading finds anything wrong in
 *   (`PropertyLines.read`: a key written twice, lines under a value, an
 *   item it does not read, a built-in's value it cannot read): what was
 *   meant there is the user's to say in the editor. A key written twice is
 *   not made one line either
 */
export class ChildPropertyLineEditor {
    /**
     * Apply `edit` to the property lines of the task on `taskLine`. Each op
     * reads the lines again, as the ops before it left them.
     *
     * Every line it touches is below the task's, so the caller's rewrite of
     * the task's own line stays where it is. Whether the lines written read
     * as meant and every other line as it did is the write's check
     * (`checkWrite`), which an item of a list is held to as a property is
     * (`ChildLineClassifier.carriesMeaning`).
     *
     * `unit` is Obsidian's one level of indentation (`ObsidianConfig.indentUnit`):
     * the first child of a line with none.
     *
     * @returns null when written; else why not, and nothing of it is to be written.
     */
    static applyOps(draft: LineDraft, taskLine: number, edit: PropertyEdit, unit: string): PropertyRefusal | null {
        for (const op of edit.ops) {
            const own = PropertyLines.ofTask(draft.reading(), taskLine);
            const found = PropertyLines.read(own, edit.keys).findings.find(finding => PropertyKey.same(finding.key, op.key));
            if (found) return { kind: 'property', key: found.key, line: found.line };
            // One at most: a key written twice is a finding.
            const line = own.lines.find(candidate => PropertyKey.same(candidate.key, op.key));
            if (line) this.rewrite(draft, line, op, unit);
            else if (op.op !== 'delete') this.add(draft, taskLine, own.lines, op, unit);
        }
        return null;
    }

    /** The block of the property line `line` written as `op` says. */
    private static rewrite(draft: LineDraft, line: PropertyLine, op: PropertyOp, unit: string): void {
        const items = line.items;
        const pastItems = items.length > 0 ? items[items.length - 1] + 1 : line.line + 1;
        if (op.op === 'delete') {
            draft.splice(line.line, pastItems - line.line);
            return;
        }
        const list = op.op === 'set' ? this.itemsOf(op.value, items.length > 0) : null;
        if (list === null) {
            // One line: the items under it go, and the line says the value or none.
            if (pastItems > line.line + 1) draft.splice(line.line + 1, pastItems - line.line - 1);
            draft.rewrite(line.line, this.withValue(draft.lines[line.line], op.op === 'set' ? this.textOf(op.value) : ''));
            return;
        }
        // A list: its items rewritten one for one, the ones past the new list
        // taken out, and the new ones put past the last.
        for (let i = items.length - 1; i >= list.length; i--) draft.splice(items[i], 1);
        const kept = Math.min(items.length, list.length);
        for (let i = 0; i < kept; i++) draft.rewrite(items[i], this.itemWith(draft.lines[items[i]], list[i]));
        if (line.written !== '') draft.rewrite(line.line, this.withValue(draft.lines[line.line], ''));
        const more = list.slice(kept).map(item => `- ${item}`);
        if (more.length === 0) return;
        const reading = draft.reading();
        const spot = kept > 0
            ? Placement.afterSubtree(reading, items[kept - 1], more[0], unit)
            : Placement.firstChild(reading, line.line, more[0], unit);
        draft.put(spot, Block.read(more));
    }

    /** A new property line, and its list's items under it, past the task's property lines or as its first child. */
    private static add(draft: LineDraft, taskLine: number, own: readonly PropertyLine[], op: Exclude<PropertyOp, { op: 'delete' }>, unit: string): void {
        const list = op.op === 'set' ? this.itemsOf(op.value, false) : null;
        const head = list === null && op.op === 'set' ? `- ${op.key}:: ${this.textOf(op.value)}` : `- ${op.key}::`;
        const reading = draft.reading();
        const spot = own.length > 0
            ? Placement.afterSubtree(reading, own[own.length - 1].line, head, unit)
            : Placement.firstChild(reading, taskLine, head, unit);
        if (list === null) {
            draft.put(spot, Block.line(head));
            return;
        }
        // The items a level under the new line, as the first child of a line
        // with none is (`Placement.childOfPut`), written from the line's own
        // column so that the block reads by itself (`Block.read`).
        const under = Outline.shiftedIndent(Placement.childOfPut(reading, spot, head, unit), spot.indent, '');
        draft.put(spot, Block.read([head, ...list.map(item => `${under}- ${item}`)]));
    }

    /**
     * The items `value` writes, or null for a value on the line itself. Tags
     * are items when the line writes them as a list already (`asList`), and
     * `#a #b` on the line otherwise.
     */
    private static itemsOf(value: PropertyWrite, asList: boolean): readonly string[] | null {
        if ('items' in value) return value.items;
        if ('tags' in value && asList) return value.tags.map(tag => `#${tag}`);
        return null;
    }

    /** The line's value `value` writes when it is no list. */
    private static textOf(value: PropertyWrite): string {
        if ('tags' in value) return value.tags.map(tag => `#${tag}`).join(' ');
        if ('text' in value) return value.text;
        return '';
    }

    /**
     * The property line `text` saying `value` (none for empty): what stands
     * before its value (indentation, bullet, key, `::`) kept as written, a
     * space put after `::` for a value when none is there, and the spaces
     * after `::` dropped for none.
     */
    private static withValue(text: string, value: string): string {
        const prefix = text.slice(0, text.length - text.match(PROPERTY_LINE)![2].length);
        if (value === '') return prefix.replace(/[ \t]+$/, '');
        return prefix + (/\s$/.test(prefix) ? '' : ' ') + value;
    }

    /** The list item `text` saying `value`: its indentation, bullet and the gap after it kept. */
    private static itemWith(text: string, value: string): string {
        const written = text.match(ITEM_TEXT)?.[1] ?? '';
        return text.slice(0, text.length - written.length) + value;
    }
}
