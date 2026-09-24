import { Outline, type OutlineReading } from '../utils/Outline';
import { type Diagnostic, error, warning } from '../../lang/Diagnostic';

/** Language tag that marks a generation block. */
export const GEN_LANGUAGE_TAG = 'tv-gen';

/** Prefix of every language tag this plugin owns (typo detection). */
const OWNED_TAG_PREFIX = 'tv-';

/** A named generation block, body kept verbatim. */
export interface GenBlock {
    name: string;
    /** Lines between the delimiters, exactly as written. */
    body: string[];
    /** Absolute index of the opening delimiter line. */
    openLine: number;
    /** Absolute index of the closing delimiter line. */
    closeLine: number;
}

/** A diagnostic anchored to one line, with columns inside that line. */
export interface LocatedDiagnostic extends Diagnostic {
    /** Absolute index of the line the span belongs to. */
    line: number;
    /**
     * Last line the span reaches, when it reaches past its first.
     *
     * A js section is the first source here that is more than one line, so a
     * statement broken across two of them has a span that no single line
     * holds. `span.start` is then a column on `line` and `span.end` a column
     * on `endLine`. Absent means the two are the same, which is every
     * diagnostic that came before the section existed.
     *
     * One diagnostic still means one problem. Cutting it into a mark per line
     * is the decorator's job — doing it here would make the count of
     * diagnostics stop matching the count of things wrong.
     */
    endLine?: number;
}

/**
 * One diagnostic cut into the lines it covers, one piece per line.
 *
 * For whoever draws it: a mark is a range on a line, and a span that begins
 * on one line and ends on another is not one. The cut is here rather than in
 * the parser so that the count of diagnostics stays the count of things
 * wrong — and so that every covered line carries its own piece, which is what
 * keeps a continuation line underlined when the line the span began on has
 * scrolled out of view.
 *
 * `lineLength` answers for the lines in between, whose piece is the whole
 * line. A single-line diagnostic comes back as itself.
 */
export function spreadOverLines(
    d: LocatedDiagnostic,
    lineLength: (line: number) => number
): LocatedDiagnostic[] {
    const last = d.endLine ?? d.line;
    if (last <= d.line) return [d];
    const pieces: LocatedDiagnostic[] = [];
    for (let line = d.line; line <= last; line++) {
        pieces.push({
            ...d,
            line,
            endLine: undefined,
            span: {
                start: line === d.line ? d.span.start : 0,
                end: line === last ? d.span.end : lineLength(line),
            },
        });
    }
    return pieces;
}

export interface GenBlockScan {
    /** Name → block, document order. A duplicate name keeps the first. */
    blocks: Map<string, GenBlock>;
    diagnostics: LocatedDiagnostic[];
}


/**
 * Collect the `tv-gen` blocks of one file.
 *
 * Only fences at the top of the note are collected. A fence that stands in
 * a list item (indented under a task) is that item's content: its body
 * would land in the parent task's child lines and be drawn on the card.
 * Those are reported instead of collected, so a block that does not work
 * says why.
 *
 * The fences come from the note's one reading (`Outline.read`), never from
 * a pattern of our own: only that reading knows a delimiter written inside a
 * wider fence is quoted content. A note explaining the notation wraps its
 * samples in an outer fence, and its examples must not become real blocks.
 *
 * `outline` may be passed in by a caller that already read the same lines.
 */
export function collectGenBlocks(lines: readonly string[], outline: OutlineReading = Outline.read(lines)): GenBlockScan {
    const blocks = new Map<string, GenBlock>();
    const diagnostics: LocatedDiagnostic[] = [];

    const wholeLine = (index: number) => ({ start: 0, end: lines[index].length });

    for (const open of outline.fences) {
        const [tag, ...rest] = open.info.split(/\s+/);

        if (outline.ownerOf(open.line) !== null) {
            if (tag === GEN_LANGUAGE_TAG) {
                diagnostics.push({
                    ...warning('gen.indented-block',
                        'An indented block is not collected — move it to the top level of the file',
                        { start: open.from, end: lines[open.line].length }),
                    line: open.line,
                });
            }
            continue;
        }

        if (tag !== GEN_LANGUAGE_TAG) {
            if (tag.startsWith(OWNED_TAG_PREFIX)) {
                diagnostics.push({
                    ...warning('gen.unknown-tag',
                        `Unknown language tag '${tag}' — a generation block is tagged ${GEN_LANGUAGE_TAG}`,
                        wholeLine(open.line), { tag }),
                    line: open.line,
                });
            }
            continue;
        }

        const name = rest.join(' ').trim();

        if (open.close === null) {
            diagnostics.push({
                ...error('gen.unterminated-block',
                    'This block is never closed, so everything below it is read as its body and the tasks written there stop appearing',
                    wholeLine(open.line)),
                line: open.line,
            });
            continue;
        }

        if (!name) {
            diagnostics.push({
                ...error('gen.missing-name',
                    'A generation block needs a name — reference it with use("name")',
                    wholeLine(open.line)),
                line: open.line,
            });
            continue;
        }

        if (blocks.has(name)) {
            diagnostics.push({
                ...error('gen.duplicate-name',
                    `A block named '${name}' is already defined; the first one is used`,
                    wholeLine(open.line), { name }),
                line: open.line,
            });
            continue;
        }

        blocks.set(name, {
            name,
            body: lines.slice(open.line + 1, open.close),
            openLine: open.line,
            closeLine: open.close,
        });
    }

    diagnostics.sort((a, b) => a.line - b.line);
    return { blocks, diagnostics };
}
