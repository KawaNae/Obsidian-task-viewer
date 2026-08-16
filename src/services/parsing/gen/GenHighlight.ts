import { FN_NAMES, PROP_NAMES } from '../../lang/ExprAst';
import { UNIT_KEYWORDS } from '../../lang/ExprParser';
import { findInterpolationEnd, tokenize } from '../../lang/Lexer';
import { REFUSED_STMT_KEYWORDS, STMT_KEYWORDS } from '../../lang/StmtParser';
import type { Token } from '../../lang/Token';
import { type GenBody, type GenLine, lineIndex } from './GenBodyParser';

/**
 * What a run of characters is, as far as this language is concerned.
 *
 * Not a palette: which colour each one takes is the editor's business, and
 * the reading view may answer differently. What is decided here is the only
 * thing a reader of the source can decide — what the engine made of the text.
 */
export type TokenRole =
    | 'keyword'
    /** A statement this language names and refuses. Written, and never read. */
    | 'refused'
    | 'value'
    /** A date, a datetime, a time, a duration. */
    | 'temporal'
    | 'string'
    | 'link'
    /** The name in a call: a built-in, a method, or a local arrow. */
    | 'fn'
    /** A property of the task, or a member read through a dot. */
    | 'prop'
    /** A name the flow command's `let(...)` declared. */
    | 'cell'
    | 'comment'
    | 'punct';

/** One run of one line, and what it is. */
export interface HighlightMark {
    /** Absolute line index in the file. */
    line: number;
    /** Columns within that line. */
    from: number;
    to: number;
    role: TokenRole;
}

/** Bare names the parser resolves to a property of the task being generated. */
const BARE_PROPS: ReadonlySet<string> = new Set(
    // `file.name` is written as two tokens, and the `file` half is what a
    // reader sees first; the `name` half arrives through the dot rule.
    PROP_NAMES.map(p => p.split('.')[0])
);

/** Names the parser reads as a value rather than as a binding. */
const VALUE_WORDS: ReadonlySet<string> = new Set([
    'true', 'false', 'none', 'undefined', 'null', ...UNIT_KEYWORDS,
]);

/** Built-ins, by the bare word a reader sees. */
const BUILTIN_FNS: ReadonlySet<string> = new Set(FN_NAMES.map(f => f.split('.')[0]));

/**
 * What each run of a block's source is, for whoever draws it.
 *
 * Driven by the lexer this language actually reads with, and by the words its
 * parsers actually treat as syntax — never by a second grammar written to look
 * like this one. A construct this language does not accept therefore cannot be
 * painted as though it does: an unknown name is a name with no role, which is
 * the same silence the checker's squiggle sits on.
 *
 * The cells are not passed in. They arrive on the parsed body, as the checker
 * left them, so a cell reads as state here for the same reason it resolves
 * there — and no caller can hand the two a different map.
 */
export function highlightGenBody(body: GenBody): HighlightMark[] {
    const marks: HighlightMark[] = [];
    const live = liveCells(body);

    if (body.js) {
        const { starts, lineAt } = lineIndex(body.js.source);
        const firstLine = body.js.firstLine;
        // A section is one string and the page is lines, so a run that crosses
        // a line break becomes one mark per line — a mark is a range on a line
        // and cannot be anything else.
        const emit = (role: TokenRole, from: number, to: number) => {
            let at = from;
            while (at < to) {
                const index = lineAt(at);
                const lineEnd = index + 1 < starts.length ? starts[index + 1] - 1 : body.js!.source.length;
                const stop = Math.min(to, lineEnd);
                if (stop > at) {
                    marks.push({ line: firstLine + index, from: at - starts[index], to: stop - starts[index], role });
                }
                at = stop + 1;
            }
        };
        collect(body.js.source, 0, true, live, emit);
    }

    for (const line of bodyLines(body)) {
        const emit = (role: TokenRole, from: number, to: number) => {
            marks.push({ line: line.line, from, to, role });
        };
        for (const part of line.parts) {
            if (part.kind !== 'expr') continue;
            // The braces belong to nobody's expression, and leaving them plain
            // would make an interpolation hard to find in a line of prose.
            emit('punct', part.span.start, part.span.start + 2);
            emit('punct', part.span.end - 1, part.span.end);
            const from = part.span.start + 2 - line.indent;
            const to = part.span.end - 1 - line.indent;
            collect(line.text.slice(from, to), part.span.start + 2, false, live, emit);
        }
    }

    marks.sort((a, b) => a.line - b.line || a.from - b.from || a.to - b.to);
    return marks;
}

function bodyLines(body: GenBody): GenLine[] {
    return body.parent ? [body.parent, ...body.children] : body.children;
}

/**
 * The cells that still mean what the command says, where the body is read.
 *
 * Read off the bindings the checker left, which is the rule itself: a section
 * declaring the name overwrote the cell there and a declaration inside a block
 * was undone on the way out, so what carries the cell flag at the end is
 * exactly what a body line resolves to a cell. Neither a second walk of the
 * scopes nor the shadowing warning would answer this — the warning says a name
 * was hidden but not where, and a cell hidden only inside an `if` still
 * reaches the body.
 */
function liveCells(body: GenBody): ReadonlySet<string> {
    const live = new Set<string>();
    for (const [name, binding] of body.bindings.vars) {
        if (binding.cell) live.add(name);
    }
    return live;
}

type Emit = (role: TokenRole, from: number, to: number) => void;

/**
 * Read one stretch of source and say what each token is.
 *
 * `base` is where `src` sits in the coordinates the marks are measured in, and
 * the lexer carries it, so a token's own span is already the answer.
 *
 * `statements` is the js section: there `let` is syntax, and in an
 * interpolation the same word is a name, because that is what the two profiles
 * of the parser do with it.
 */
function collect(src: string, base: number, statements: boolean, cells: ReadonlySet<string>, emit: Emit): void {
    const { tokens, comments } = tokenize(src, base);
    for (const span of comments) emit('comment', span.start, span.end);

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const role = roleOf(token, tokens[i - 1], tokens[i + 1], statements, cells);
        if (role) emit(role, token.start, token.end);
        // A template is one token to the lexer and the parser reads its
        // interpolations afterwards, so the same is done here: the whole runs
        // as text, and what is spliced into it runs again inside.
        if (token.kind === 'template') collectTemplate(token, cells, emit);
    }
}

/** The `${...}` of a template literal, read with the template's own rule. */
function collectTemplate(token: Token, cells: ReadonlySet<string>, emit: Emit): void {
    const text = token.text;
    // The token's span covers the backticks; its text is what is between them.
    const base = token.start + 1;
    let i = 0;
    while (i < text.length) {
        if (text[i] !== '$' || text[i + 1] !== '{') { i++; continue; }
        // The one thing a backslash does here, as in the splitter.
        if (i > 0 && text[i - 1] === '\\') { i += 2; continue; }
        const end = findInterpolationEnd(text, i);
        if (end === -1) return;
        emit('punct', base + i, base + i + 2);
        emit('punct', base + end, base + end + 1);
        // Never as statements, whatever encloses the template: the splitter
        // reads a template's interpolations in the block profile, so the
        // statement reader is not there and its words are ordinary names.
        collect(text.slice(i + 2, end), base + i + 2, false, cells, emit);
        i = end + 1;
    }
}

function roleOf(
    token: Token,
    before: Token | undefined,
    after: Token | undefined,
    statements: boolean,
    cells: ReadonlySet<string>
): TokenRole | null {
    switch (token.kind) {
        case 'string': case 'template': return 'string';
        case 'number': return 'value';
        case 'date': case 'datetime': case 'time': case 'duration': return 'temporal';
        case 'wikilink': return 'link';
        case 'newline': case 'eof': return null;
        case 'ident': return identRole(token, before, after, statements, cells);
        default: return 'punct';
    }
}

/**
 * A bare word, which is where the lexer stops being able to answer: `let`, `n`
 * and `format` are one kind of token and three different things.
 *
 * The order below is the parser's own, question for question. It matters that
 * it is: the parser asks about a call twice, once for the built-ins and once,
 * much later, for a name bound in the block — and between the two it resolves
 * the words that are values and the words that are properties. Asking about
 * the bracket once, up front, paints `true(1)` as a call, which is the one
 * thing this design exists to prevent.
 */
function identRole(
    token: Token,
    before: Token | undefined,
    after: Token | undefined,
    statements: boolean,
    cells: ReadonlySet<string>
): TokenRole | null {
    const word = token.text;
    const called = after?.kind === 'lparen';
    if (statements && REFUSED_STMT_KEYWORDS.has(word)) return 'refused';
    if (statements && STMT_KEYWORDS.has(word)) return 'keyword';
    // A built-in, and only where it is called: bare, the parser reads the same
    // word as a binding, and so does this.
    if (BUILTIN_FNS.has(word) && called) return 'fn';
    // Through a dot the postfix reader decides by the bracket too — a method
    // is a call, a member is a read.
    if (before?.kind === 'dot' || before?.kind === 'qdot') return called ? 'fn' : 'prop';
    if (VALUE_WORDS.has(word)) return 'value';
    if (BARE_PROPS.has(word)) return 'prop';
    // Last, as in the parser: a name the block bound, called.
    if (called) return 'fn';
    if (cells.has(word)) return 'cell';
    // A local, an arrow parameter, a namespace, or a name this language does
    // not know. They read alike on purpose: only the last is wrong, and the
    // checker already draws under it. A colour here would either repeat that
    // or, worse, dress an unknown name as something the language recognizes.
    return null;
}
