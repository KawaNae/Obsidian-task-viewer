import { error, warning } from '../../lang/Diagnostic';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';
import type { LocatedDiagnostic } from './GenBlockCollector';

/** One literal line of a block body, with its indentation read as a depth. */
export interface GenLine {
    /** Levels of indentation: 0 is the parent line, 1 and up are children. */
    depth: number;
    /** The line without its indentation. Interpolations are left as written. */
    text: string;
    /** Absolute line index in the file. */
    line: number;
}

export interface GenBody {
    /** The depth-0 task line, or null for a children-only block. */
    parent: GenLine | null;
    children: GenLine[];
    diagnostics: LocatedDiagnostic[];
}

/** Spaces that make up one level of depth (Obsidian accepts 1 tab or 4 spaces). */
const SPACES_PER_LEVEL = 4;

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
 */
export function parseGenBody(body: string[], firstLine: number): GenBody {
    const diagnostics: LocatedDiagnostic[] = [];
    const lines: GenLine[] = [];

    for (let i = 0; i < body.length; i++) {
        const raw = body[i];
        const line = firstLine + i;
        if (raw.trim() === '') continue;

        // The js section is read by a later stage. Until then, say so and
        // skip it: emitting its lines as markdown would print the tag and
        // then generate whatever the logic was meant to decide.
        if (JS_OPEN_RE.test(raw)) {
            diagnostics.push({
                ...error('gen.js-section-unsupported',
                    'A js section is not supported yet — this block generates its body only',
                    { start: 0, end: raw.length }),
                line,
            });
            if (!raw.includes('/js>')) {
                while (i < body.length && !JS_CLOSE_RE.test(body[i])) i++;
            }
            continue;
        }

        const indent = raw.slice(0, raw.length - raw.trimStart().length);
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

        lines.push({
            depth: tabs + Math.ceil(spaces / SPACES_PER_LEVEL),
            text: raw.trimStart(),
            line,
        });
    }

    return classify(lines, diagnostics);
}

function classify(lines: GenLine[], diagnostics: LocatedDiagnostic[]): GenBody {
    const roots = lines.filter(l => l.depth === 0);
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
        children: lines.filter(l => l !== parent && l.depth > 0),
        diagnostics,
    };
}
