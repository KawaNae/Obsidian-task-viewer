import type { MarkdownPostProcessorContext } from 'obsidian';
import { diagnosticText } from '../services/flow/diagnosticText';
import {
    collectGenBlocks,
    type GenBlockScan,
} from '../services/parsing/gen/GenBlockCollector';
import { type GenCellTypes, parseGenBody } from '../services/parsing/gen/GenBodyParser';
import { declaredCells } from '../services/parsing/gen/GenCellScan';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';

/**
 * Reading-view rendering of a `tv-gen` block.
 *
 * Shows what the block generates: the name it is referenced by, the
 * hierarchy its indentation produces, and whatever is wrong with it.
 *
 * Two things are deliberately NOT done. Interpolations are left as
 * written — evaluating one needs a firing context, which does not exist
 * while reading. And checkbox lines are drawn as inert markers rather
 * than real checkboxes, so a template is never mistaken for the record of
 * work actually done.
 *
 * This is also where the block diagnostics become visible at all. In Live
 * Preview, Obsidian replaces a closed fence with its rendered widget, and
 * the editor's underlines go with it — measured in the Dev vault: of five
 * mistakes in one file, Live Preview showed only the unterminated block,
 * the one Obsidian never renders. Repeating the diagnostics here is what
 * a Live Preview user actually sees.
 *
 * Which is why this reads the file's cells the way the editor's underlines
 * do. A block is checked apart from the command that fires it, so a reader
 * without them calls every cell a name nobody declared — and this reader is
 * the one most people are looking at.
 */
export function createGenBlockPreview() {
    // One-entry memo: every block of a document asks about the same text, and
    // both readings of it — where the blocks are, and what cells the commands
    // declare — answer to that one key.
    let cache: { text: string; scan: GenBlockScan; cells: GenCellTypes } | null = null;
    const readOf = (text: string) => {
        if (cache?.text === text) return cache;
        const lines = text.split('\n');
        cache = { text, scan: collectGenBlocks(lines), cells: declaredCells(lines) };
        return cache;
    };

    return (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
        const info = ctx.getSectionInfo(el);
        // Without the section there is no file text, and therefore no way to
        // learn the cells — the same degradation as the missing name below.
        const read = info ? readOf(info.text) : null;
        const scan = read?.scan ?? null;
        const root = el.createDiv({ cls: 'tv-gen-preview' });

        // The name comes from the collector's own reading of the block, not
        // from re-parsing the delimiter here: a block whose name is missing
        // or duplicated is not collected, and then there is no name to show.
        const block = scan && info
            ? [...scan.blocks.values()].find(b => b.openLine === info.lineStart)
            : undefined;
        if (block) {
            root.createDiv({ cls: 'tv-gen-preview__name', text: block.name });
        }

        const bodyStart = info ? info.lineStart + 1 : 0;
        const body = parseGenBody(source.split('\n'), bodyStart, read?.cells);

        const lines = body.parent ? [body.parent, ...body.children] : body.children;
        if (lines.length === 0) {
            root.createDiv({ cls: 'tv-gen-preview__empty', text: '—' });
        }
        for (const line of lines) {
            const row = root.createDiv({ cls: 'tv-gen-preview__line' });
            row.style.setProperty('--tv-gen-depth', String(line.depth));
            const classified = TaskLineClassifier.classify(line.text);
            if (classified) {
                row.createSpan({ cls: 'tv-gen-preview__marker' });
                row.createSpan({ cls: 'tv-gen-preview__text', text: classified.rawContent });
            } else {
                row.createSpan({ cls: 'tv-gen-preview__text', text: line.text });
            }
        }

        const own = scan && info
            ? scan.diagnostics.filter(d => d.line >= info.lineStart && d.line <= info.lineEnd)
            : [];
        for (const d of [...own, ...body.diagnostics]) {
            root.createDiv({
                cls: `tv-gen-preview__diag tv-gen-preview__diag--${d.severity}`,
                text: diagnosticText(d),
            });
        }
    };
}
