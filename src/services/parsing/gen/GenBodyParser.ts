import { type Diagnostic, error, warning } from '../../lang/Diagnostic';
import type { InterpolationPart } from '../../lang/ExprAst';
import {
    type Bindings, FLOW_TYPE_ENV, NO_BINDINGS, type VarBinding, checkExpr,
} from '../../lang/ExprChecker';
import { nestingOverflow, splitInterpolations } from '../../lang/ExprParser';
import type { StaticType } from '../../lang/functions';
import type { Program } from '../../lang/StmtAst';
import { checkProgram } from '../../lang/StmtChecker';
import { parseProgram } from '../../lang/StmtParser';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';
import type { LocatedDiagnostic } from './GenBlockCollector';

/** One literal line of a block body, with its indentation read as a depth. */
export interface GenLine {
    /** Levels of indentation: 0 is the parent line, 1 and up are children. */
    depth: number;
    /** The line without its indentation. Interpolations are left as written. */
    text: string;
    /**
     * The same line split into literal text and `${...}` expressions, ready to
     * render. Read here rather than at generation time so a broken expression
     * is reported while it is being written, not when a task is completed.
     */
    parts: InterpolationPart[];
    /**
     * Characters of indentation that were trimmed off `text`.
     *
     * The parts above carry columns measured from the start of the raw line,
     * which is where the editor puts them. Anything reading a part back out of
     * `text` has to know where `text` begins, and the depth cannot answer that
     * — a tab and four spaces are one level and different columns.
     */
    indent: number;
    /** Absolute line index in the file. */
    line: number;
}

/**
 * The `<js ... /js>` section at the head of a block, parsed.
 *
 * The source is kept as one string with its lines joined, because that is
 * what the statement parser reads and what its character offsets measure
 * against; `firstLine` puts those offsets back on the page.
 */
export interface GenJsSection {
    program: Program;
    /** Absolute file line of the first source line inside the tags. */
    firstLine: number;
    source: string;
}

export interface GenBody {
    /** The depth-0 task line, or null for a children-only block. */
    parent: GenLine | null;
    children: GenLine[];
    /** The leading js section, or null when the block is body only. */
    js: GenJsSection | null;
    diagnostics: LocatedDiagnostic[];
}

/** Spaces that make up one level of depth (Obsidian accepts 1 tab or 4 spaces). */
const SPACES_PER_LEVEL = 4;

/**
 * Levels of indentation in a run of leading whitespace.
 *
 * A tab is one level and four spaces are one level, and a remainder rounds
 * UP: rounding down would let a line indented by two spaces come out as a
 * sibling, which is the opposite of what its author meant.
 *
 * Exported because the same conversion applies to the lines a multi-line
 * value brings with it — the rule has one owner, and generation reads it
 * from here rather than counting again.
 */
export function indentDepth(indent: string): number {
    const tabs = (indent.match(/\t/g) ?? []).length;
    const spaces = indent.length - tabs;
    return tabs + Math.ceil(spaces / SPACES_PER_LEVEL);
}

/** Leading whitespace of a line. */
export function leadingIndent(raw: string): string {
    return raw.slice(0, raw.length - raw.trimStart().length);
}

/** Opening and closing tags of the leading js section. */
const JS_OPEN_RE = /^\s*<js\b/;
const JS_CLOSE_RE = /^\s*\/js>\s*$/;

/**
 * Read the literal lines of a block body.
 *
 * Indentation is the generated hierarchy: the depth-0 task line becomes the
 * next instance's parent line and everything deeper becomes its children. A
 * block with no depth-0 line is children-only — the parent then comes from
 * the schedule, as it did before blocks existed.
 *
 * Depth counts levels, not characters: a tab is one level and four spaces
 * are one level, and a remainder rounds UP. Rounding down would let a line
 * indented by two spaces come out as a sibling, which is the opposite of
 * what its author meant; the same rule (and the same reasoning) applies to
 * multi-line values at materialization time.
 *
 * @param body lines between the block delimiters
 * @param firstLine absolute index of `body[0]` in the file
 * @param cells state cells the block may read and write, by the type they hold
 */
export function parseGenBody(body: string[], firstLine: number, cells?: GenCellTypes): GenBody {
    try {
        return readGenBody(body, firstLine, cells);
    } catch (e) {
        // A block is many lines of recursive descent, so it is the likelier
        // of the two places where nesting outruns the host's stack.
        return {
            parent: null,
            children: [],
            js: null,
            diagnostics: [{
                ...nestingOverflow(e, { start: 0, end: (body[0] ?? '').length }),
                line: firstLine,
            }],
        };
    }
}

function readGenBody(body: string[], firstLine: number, cells?: GenCellTypes): GenBody {
    const diagnostics: LocatedDiagnostic[] = [];
    const lines: GenLine[] = [];
    let js: GenJsSection | null = null;
    /** Errors inside the section itself, which make its bindings unknowable. */
    let jsBroken = false;

    for (let i = 0; i < body.length; i++) {
        const raw = body[i];
        const line = firstLine + i;
        if (raw.trim() === '') continue;

        if (JS_OPEN_RE.test(raw)) {
            const section = readJsSection(body, i, firstLine, diagnostics);
            i = section.lastIndex;
            if (js !== null) {
                // The second one is refused rather than merged: a block has
                // one place its logic lives, and running both in order would
                // make that place two.
                diagnostics.push({
                    ...error('gen.js-section-duplicate',
                        'A block has one js section — put the rest of the logic in the first one',
                        { start: 0, end: raw.length }),
                    line,
                });
                continue;
            }
            if (lines.length > 0) {
                diagnostics.push({
                    ...error('gen.js-section-after-body',
                        'The js section runs before the body, so it is written before it',
                        { start: 0, end: raw.length }),
                    line,
                });
                continue;
            }
            js = section.parsed;
            jsBroken = section.broken;
            continue;
        }

        const indent = leadingIndent(raw);
        const tabs = (indent.match(/\t/g) ?? []).length;
        const spaces = indent.length - tabs;
        if (spaces % SPACES_PER_LEVEL !== 0 || (tabs > 0 && spaces > 0)) {
            // Spans the whole line, not just the indentation: an underline
            // under two spaces is not something anyone can hover.
            diagnostics.push({
                ...warning('gen.ragged-indent',
                    'Indent with one tab or four spaces per level; this line rounds up',
                    { start: 0, end: raw.length }),
                line,
            });
        }

        // Spans are measured from the start of the raw line, which is where
        // the editor puts them, so the interpolations carry the indent.
        const text = raw.trimStart();
        const lineDiagnostics: Diagnostic[] = [];
        const parts = splitInterpolations(text, lineDiagnostics, indent.length);
        for (const d of lineDiagnostics) diagnostics.push({ ...d, line });

        lines.push({
            depth: indentDepth(indent),
            text,
            parts,
            indent: indent.length,
            line,
        });
    }

    checkBody(js, jsBroken, lines, diagnostics, cells);
    return classify(lines, js, diagnostics);
}

/**
 * Read one `<js ... /js>` section and parse it.
 *
 * `lastIndex` is where the caller's loop should resume — the closing tag, or
 * the end of the block when there is none. An unclosed section swallows the
 * body, which is why it is said rather than left to fail as markdown.
 */
function readJsSection(
    body: string[],
    open: number,
    firstLine: number,
    diagnostics: LocatedDiagnostic[]
): { parsed: GenJsSection; broken: boolean; lastIndex: number } {
    const openLine = body[open];
    const inline = openLine.match(/^\s*<js\b(.*?)\/js>\s*$/);
    const source: string[] = [];
    let lastIndex = open;
    let sourceFirstLine = firstLine + open;

    if (inline) {
        source.push(inline[1]);
    } else {
        // The rest of the opening line counts: `<js const a = 1` is one
        // statement someone wrote on the tag's line, not nothing.
        const trailing = openLine.replace(/^\s*<js\b/, '');
        source.push(trailing);
        sourceFirstLine = firstLine + open;
        let i = open + 1;
        while (i < body.length && !JS_CLOSE_RE.test(body[i])) {
            source.push(body[i]);
            i++;
        }
        if (i >= body.length) {
            // The other way to get here is a line inside the section that
            // starts with three backticks: it closes the tv-gen fence, the
            // block ends before its own delimiter, and what is left is a
            // section with no `/js>`. Both readings are answered at once,
            // because this is the only symptom either of them shows.
            diagnostics.push({
                ...error('gen.js-section-unclosed',
                    "This js section is never closed with '/js>' — if a line inside it starts with three backticks, that ended the block early, and the block needs four or more backticks around it",
                    { start: 0, end: openLine.length }),
                line: firstLine + open,
            });
        }
        lastIndex = Math.min(i, body.length - 1);
    }

    const text = source.join('\n');
    const { program, diagnostics: parsed } = parseProgram(text);
    const locate = lineLocator(text, sourceFirstLine);
    for (const d of parsed) diagnostics.push(locate(d));

    return {
        parsed: { program, firstLine: sourceFirstLine, source: text },
        broken: parsed.some(d => d.severity === 'error'),
        lastIndex,
    };
}

/**
 * Where each line of a multi-line source begins, and which line an offset is on.
 *
 * The section is measured in characters of one joined string while the page is
 * measured in lines and columns, so everything that reads the section has to
 * cross the same gap. One implementation, so a diagnostic and a colour drawn
 * on the same character land on the same line.
 */
export function lineIndex(text: string): { starts: number[]; lineAt: (offset: number) => number } {
    const starts: number[] = [];
    let at = 0;
    for (const line of text.split('\n')) {
        starts.push(at);
        at += line.length + 1;
    }
    const lineAt = (offset: number): number => {
        let index = 0;
        while (index + 1 < starts.length && starts[index + 1] <= offset) index++;
        return index;
    };
    return { starts, lineAt };
}

/**
 * Put a diagnostic measured in characters of `text` back onto page lines.
 *
 * The section is the first source that is more than one line, so a span can
 * begin on one and end on another. Both ends are carried — `span.start` is a
 * column on `line`, `span.end` a column on `endLine` — and the decorator cuts
 * the run into one mark per line. Keeping both here rather than clamping to
 * the first line is what lets it: a clamp cannot be undone later.
 */
function lineLocator(text: string, firstLine: number): (d: Diagnostic) => LocatedDiagnostic {
    const lines = text.split('\n');
    const { starts, lineAt } = lineIndex(text);
    return (d: Diagnostic): LocatedDiagnostic => {
        const from = lineAt(d.span.start);
        const to = Math.max(from, lineAt(Math.max(d.span.start, d.span.end - 1)));
        return {
            ...d,
            span: {
                start: d.span.start - starts[from],
                end: Math.min(d.span.end - starts[to], lines[to].length),
            },
            line: firstLine + from,
            ...(to > from ? { endLine: firstLine + to } : {}),
        };
    };
}

/**
 * The state cells a block may read, by the type each one holds.
 *
 * The block is written apart from the command that fires it, so the names its
 * cells go by are not knowable from the block alone — they arrive from the
 * flow line. Without them every mention of a cell reads as a typo, which is
 * the same diagnostic a typo gets and would bury it.
 */
export type GenCellTypes = ReadonlyMap<string, StaticType>;

/** The cells as the checker sees them: ordinary locals that may be written. */
function cellBindings(cells: GenCellTypes | undefined): Bindings {
    if (!cells?.size) return NO_BINDINGS;
    const vars = new Map<string, VarBinding>();
    for (const [name, type] of cells) vars.set(name, { type, mutable: true, cell: true });
    return { vars, fns: new Map() };
}

/**
 * Type-check the section and the body's interpolations.
 *
 * The body reads what the section left behind, so the two are one pass in one
 * order — and the block is the first surface where an interpolation is checked
 * at all. Skipped when the section did not parse: without its bindings every
 * name the body borrows would be reported as unknown, burying the one
 * diagnostic that matters.
 */
function checkBody(
    js: GenJsSection | null,
    jsBroken: boolean,
    lines: GenLine[],
    diagnostics: LocatedDiagnostic[],
    cells?: GenCellTypes
): void {
    if (jsBroken) return;
    const sectionDiagnostics: Diagnostic[] = [];
    const outer = cellBindings(cells);
    const bindings = js
        ? checkProgram(js.program, FLOW_TYPE_ENV, sectionDiagnostics, outer)
        : outer;
    if (js) {
        const locate = lineLocator(js.source, js.firstLine);
        for (const d of sectionDiagnostics) diagnostics.push(locate(d));
    }

    for (const line of lines) {
        for (const part of line.parts) {
            if (part.kind !== 'expr') continue;
            const found: Diagnostic[] = [];
            checkExpr(part.expr, FLOW_TYPE_ENV, found, bindings);
            for (const d of found) diagnostics.push({ ...d, line: line.line });
        }
    }
}

/**
 * A line that is nothing but one interpolation.
 *
 * Its depth cannot be read from the page: whatever the value brings decides
 * it. So it is left out of the static classification below and placed when
 * the value is known — the shape people actually write, with the hierarchy
 * inside the string and the interpolation at column 0, which is the shape
 * the verbatim rule exists to accept.
 */
export function isSpliceLine(line: GenLine): boolean {
    return line.parts.length === 1 && line.parts[0].kind === 'expr';
}

function classify(lines: GenLine[], js: GenJsSection | null, diagnostics: LocatedDiagnostic[]): GenBody {
    const roots = lines.filter(l => l.depth === 0 && !isSpliceLine(l));
    const parent = roots[0] ?? null;

    for (const extra of roots.slice(1)) {
        diagnostics.push({
            ...error('gen.multiple-roots',
                'A block generates one task: only the first line may sit at depth 0',
                { start: 0, end: extra.text.length }),
            line: extra.line,
        });
    }

    if (parent && !TaskLineClassifier.isTaskLine(parent.text)) {
        diagnostics.push({
            ...error('gen.root-not-a-task',
                'The depth-0 line becomes the generated task, so it must be a checkbox line',
                { start: 0, end: parent.text.length }),
            line: parent.line,
        });
    }

    if (parent && lines[0] !== parent) {
        diagnostics.push({
            ...error('gen.root-not-first',
                'The generated task must come before the lines nested under it',
                { start: 0, end: parent.text.length }),
            line: parent.line,
        });
    }

    diagnostics.sort((a, b) => a.line - b.line);
    return {
        parent,
        children: lines.filter(l => l !== parent && (l.depth > 0 || isSpliceLine(l))),
        js,
        diagnostics,
    };
}
