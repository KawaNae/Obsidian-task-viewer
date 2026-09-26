import { warning } from '../../lang/Diagnostic';
import type { LocatedDiagnostic } from '../gen/GenBlockCollector';
import type { OutlineReading } from './Outline';

/**
 * The editor's warnings on the note's reading (`Outline.read`): the two
 * shapes where Obsidian's views show another subtree than the one the
 * plugin reads, so a delete, a move or a copy carries lines the note does
 * not show under the task, or leaves lines it does.
 *
 * - a quote straight after an item, with no blank line between: the plugin
 *   and Live Preview end the item at the `>`, the reading view draws the
 *   quote and the lines below it inside the item
 * - a fence that is never closed: Live Preview draws everything after it as
 *   code, to the end of the note, where the plugin ends it with the item it
 *   stands in; at the top, the tasks after it are code to every reader, and
 *   a `tv-gen` block is not collected
 *
 * Read off the same reading every other question of the note is asked of,
 * never a second walk of the lines. The other shapes where one view alone
 * parts from CommonMark are not warned on: the plugin reads them as
 * CommonMark does (2026-09-24).
 */
export function outlineDiagnostics(outline: OutlineReading): LocatedDiagnostic[] {
    const diagnostics: LocatedDiagnostic[] = [];
    for (const line of outline.quotesClosingItems) {
        const text = outline.lines[line];
        diagnostics.push({
            ...warning('outline.quote-ends-item',
                'This quote ends the list item above it. The reading view draws it, and the lines below, inside the item. '
                + 'To keep it in the item, indent the `>` to the item\'s text; to leave it out, put a blank line above it',
                { start: text.indexOf('>'), end: text.length }),
            line,
        });
    }
    for (const fence of outline.fences) {
        if (fence.close !== null) continue;
        diagnostics.push({
            ...warning('outline.unclosed-fence',
                'This code block is never closed, so the lines below it can be read as code and the tasks written there may not appear. '
                + `Live Preview may show everything to the end of the note as code. Add a closing ${fence.delimiter} line`,
                { start: fence.from, end: outline.lines[fence.line].length }, { fence: fence.delimiter }),
            line: fence.line,
        });
    }
    return diagnostics;
}
