import { type Diagnostic, type Span, error } from './Diagnostic';
import type { ArrowBlockBody, Expr } from './ExprAst';
import { parseExpr } from './ExprParser';
import { tokenize } from './Lexer';
import type { BindTarget, Program, Stmt } from './StmtAst';
import { TokenCursor, tokenSpan } from './Token';

/**
 * Statement parser for the js section.
 *
 * A statement ends at a line break (no semicolon insertion — the rule was
 * decided the other way: nothing is inserted, a line break IS the end). An
 * open ( or [ carries a statement across lines at the lexer, and a record
 * literal skips its own newlines at the expression parser; everywhere else a
 * line break in the middle of a statement is said out loud, not bridged.
 *
 * Semicolons are accepted and mean the same boundary. `;;` is an empty
 * statement, dropped.
 */
export function parseProgram(src: string, base = 0): { program: Program; diagnostics: Diagnostic[] } {
    const { tokens, diagnostics } = tokenize(src, base);
    const cursor = new TokenCursor(tokens, 'keep');
    fnDepth = 0;
    const body = parseStmtList(cursor, diagnostics, 'eof');
    return { program: { body }, diagnostics };
}

/**
 * An arrow function's `{ ... }` body. Reached from the expression parser,
 * which is what makes the two grammars one: a statement holds expressions,
 * and an expression may hold statements again.
 */
export function parseArrowBlockBody(cursor: TokenCursor, diagnostics: Diagnostic[]): ArrowBlockBody | null {
    const open = cursor.next(); // '{'
    fnDepth++;
    try {
        const body = parseStmtList(cursor, diagnostics, 'rbrace');
        const close = cursor.tryEat('rbrace');
        if (!close) {
            diagnostics.push(error('stmt.expected-rbrace-fn',
                "Expected '}' to close the function body", tokenSpan(cursor.peek())));
            return null;
        }
        return { kind: 'block-body', body, span: spanBetween(tokenSpan(open), tokenSpan(close)) };
    } finally {
        fnDepth--;
    }
}

/**
 * How many function bodies enclose the parse position. `return` means
 * something inside one and nothing at the top level, where the section has
 * no caller to return to. Module state on the same save/restore pattern as
 * the expression parser's profile.
 */
let fnDepth = 0;

function spanBetween(a: Span, b: Span): Span {
    return { start: a.start, end: b.end };
}

/**
 * Names that begin a statement this language does not have, each with the way
 * out. One code per construct, not one shared code with ten messages: the
 * exclusion list is worth having only because stepping on it names the
 * alternative, and a code carrying several message shapes cannot be
 * translated — every locale but English would lose exactly the sentence that
 * makes the refusal useful.
 */
const REFUSED_STMT: Record<string, { code: string; message: string }> = {
    var: { code: 'stmt.no-var', message: "'var' is not in this language — write 'let'" },
    function: { code: 'stmt.no-function', message: 'A function declaration is not in this language — write an arrow: const f = x => ...' },
    class: { code: 'stmt.no-class', message: "'class' is not in this language — a record holds the fields, and an arrow bound next to it holds the behaviour" },
    try: { code: 'stmt.no-try', message: "'try' is not in this language — a failed evaluation does not fire, and does not consume the command" },
    throw: { code: 'stmt.no-throw', message: "'throw' is not in this language — a failed evaluation is the failure" },
    switch: { code: 'stmt.no-switch', message: "'switch' is not in this language — write if / else if" },
    do: { code: 'stmt.no-do', message: "'do' is not in this language — write 'while'" },
    async: { code: 'stmt.no-async', message: "'async' is not in this language — evaluation is synchronous" },
    import: { code: 'stmt.no-import', message: "'import' is not in this language — the injected API is all there is" },
    export: { code: 'stmt.no-export', message: 'A section is not a module — a block is named on its tv-gen tag and reached with use("name")' },
};

function parseStmtList(cursor: TokenCursor, diagnostics: Diagnostic[], end: 'eof' | 'rbrace'): Stmt[] {
    const body: Stmt[] = [];
    for (;;) {
        skipBoundaries(cursor);
        if (cursor.atEof() || cursor.at('rbrace')) break;
        const stmt = parseStmt(cursor, diagnostics);
        if (!stmt) {
            // Recover at the next line so every broken statement is reported,
            // not only the first.
            skipToBoundary(cursor);
            continue;
        }
        body.push(stmt);
        if (!atBoundary(cursor)) {
            diagnostics.push(error('stmt.expected-end',
                `A statement ends at the line break — there is more after it ('${cursor.peek().text}')`,
                tokenSpan(cursor.peek()), { token: cursor.peek().text }));
            skipToBoundary(cursor);
        }
    }
    if (end === 'eof' && cursor.at('rbrace')) {
        diagnostics.push(error('stmt.unexpected-rbrace', "Unexpected '}'", tokenSpan(cursor.peek())));
        cursor.next();
        return body.concat(parseStmtList(cursor, diagnostics, end));
    }
    return body;
}

/** After a statement: a newline, a semicolon, a closing brace, or the end. */
function atBoundary(cursor: TokenCursor): boolean {
    return cursor.at('newline') || cursor.at('semicolon') || cursor.at('rbrace') || cursor.atEof();
}

function skipBoundaries(cursor: TokenCursor): void {
    while (cursor.at('newline') || cursor.at('semicolon')) cursor.next();
}

function skipToBoundary(cursor: TokenCursor): void {
    while (!atBoundary(cursor)) cursor.next();
}

function parseStmt(cursor: TokenCursor, diagnostics: Diagnostic[]): Stmt | null {
    const t = cursor.peek();

    if (t.kind === 'ident') {
        const refused = REFUSED_STMT[t.text];
        if (refused) {
            diagnostics.push(error(refused.code, refused.message, tokenSpan(t), { name: t.text }));
            return null;
        }
        switch (t.text) {
            case 'let':
            case 'const':
                return parseDecl(cursor, diagnostics);
            case 'if':
                return parseIf(cursor, diagnostics);
            case 'while':
                return parseWhile(cursor, diagnostics);
            case 'for':
                return parseFor(cursor, diagnostics);
            case 'break':
                cursor.next();
                return { kind: 'break', span: tokenSpan(t) };
            case 'continue':
                cursor.next();
                return { kind: 'continue', span: tokenSpan(t) };
            case 'return':
                return parseReturn(cursor, diagnostics);
        }
    }

    // A `{` in statement position is a block, as in JS. A record wanted here
    // is written in parentheses — and since `{a: 1}` is what someone reaching
    // for a record writes, the shape is recognized and answered rather than
    // left to fail as a block whose first statement is `a` followed by a
    // stray colon. It is then read as the record it looks like, so one
    // diagnostic covers it instead of a cascade.
    if (t.kind === 'lbrace') {
        if (!looksLikeRecord(cursor)) return parseBlockStmt(cursor, diagnostics);
        diagnostics.push(error('stmt.record-needs-parens',
            "A '{' at the start of a statement opens a block — write a record in parentheses: ({a: 1})",
            tokenSpan(t)));
        const record = parseExpr(cursor, diagnostics, 'stmt');
        if (!record) return null;
        return { kind: 'expr', expr: record, span: record.span };
    }

    const expr = parseExpr(cursor, diagnostics, 'stmt');
    if (!expr) return null;
    return { kind: 'expr', expr, span: expr.span };
}

/** `let x = 1` / `const [a, b] = xs` / `let x`. Cursor sits on let/const. */
function parseDecl(cursor: TokenCursor, diagnostics: Diagnostic[]): Stmt | null {
    const keyword = cursor.next();
    const mutable = keyword.text === 'let';
    const target = parseBindTarget(cursor, diagnostics);
    if (!target) return null;
    if (!cursor.at('assign')) {
        if (!mutable) {
            diagnostics.push(error('stmt.const-needs-init',
                "A 'const' needs its value right here — write 'const x = ...'", target.span));
            return null;
        }
        if (target.kind !== 'name') {
            diagnostics.push(error('stmt.pattern-needs-init',
                'A destructuring declaration needs a value to take apart', target.span));
            return null;
        }
        return { kind: 'decl', mutable, target, init: null, span: spanBetween(tokenSpan(keyword), target.span) };
    }
    cursor.next();
    const init = parseExpr(cursor, diagnostics, 'stmt');
    if (!init) return null;
    return { kind: 'decl', mutable, target, init, span: spanBetween(tokenSpan(keyword), init.span) };
}

/**
 * A name, `[a, , b]`, or `{a, b: c}`. The basic destructuring forms only —
 * no defaults, no nesting, no rest, which keeps what a declaration can bind
 * readable at a glance.
 */
function parseBindTarget(cursor: TokenCursor, diagnostics: Diagnostic[]): BindTarget | null {
    const t = cursor.peek();

    if (t.kind === 'ident') {
        cursor.next();
        return { kind: 'name', name: t.text, span: tokenSpan(t) };
    }

    if (t.kind === 'lbracket') {
        cursor.next();
        const names: ({ name: string; span: Span } | null)[] = [];
        for (;;) {
            if (cursor.at('comma')) { names.push(null); cursor.next(); continue; }
            if (cursor.at('rbracket')) break;
            const n = cursor.peek();
            if (n.kind !== 'ident') {
                diagnostics.push(error('stmt.expected-binding',
                    'Expected a name to bind', tokenSpan(n)));
                return null;
            }
            cursor.next();
            names.push({ name: n.text, span: tokenSpan(n) });
            if (cursor.tryEat('comma')) continue;
            break;
        }
        const close = cursor.tryEat('rbracket');
        if (!close) {
            diagnostics.push(error('stmt.expected-rbracket-pattern',
                "Expected ']' to close the pattern", tokenSpan(cursor.peek())));
            return null;
        }
        return { kind: 'array-pattern', names, span: spanBetween(tokenSpan(t), tokenSpan(close)) };
    }

    if (t.kind === 'lbrace') {
        cursor.next();
        cursor.skipNewlines();
        const fields: { key: string; name: string; span: Span }[] = [];
        while (!cursor.at('rbrace')) {
            const key = cursor.peek();
            if (key.kind !== 'ident') {
                diagnostics.push(error('stmt.expected-field-binding',
                    'Expected a field name to bind', tokenSpan(key)));
                return null;
            }
            cursor.next();
            let name = key.text;
            let last = tokenSpan(key);
            if (cursor.tryEat('colon')) {
                const renamed = cursor.peek();
                if (renamed.kind !== 'ident') {
                    diagnostics.push(error('stmt.expected-binding',
                        'Expected a name to bind', tokenSpan(renamed)));
                    return null;
                }
                cursor.next();
                name = renamed.text;
                last = tokenSpan(renamed);
            }
            fields.push({ key: key.text, name, span: spanBetween(tokenSpan(key), last) });
            cursor.skipNewlines();
            if (cursor.tryEat('comma')) { cursor.skipNewlines(); continue; }
            break;
        }
        const close = cursor.tryEat('rbrace');
        if (!close) {
            diagnostics.push(error('stmt.expected-rbrace-pattern',
                "Expected '}' to close the pattern", tokenSpan(cursor.peek())));
            return null;
        }
        return { kind: 'record-pattern', fields, span: spanBetween(tokenSpan(t), tokenSpan(close)) };
    }

    diagnostics.push(error('stmt.expected-binding', 'Expected a name to bind', tokenSpan(t)));
    return null;
}

/**
 * `if (cond) { ... } else if (...) { ... } else { ... }`. The body is always
 * braced: a dangling single statement is the one place JS itself trips
 * people, and requiring the braces costs a reader nothing.
 */
function parseIf(cursor: TokenCursor, diagnostics: Diagnostic[]): Stmt | null {
    const keyword = cursor.next();
    const cond = parseParenCond(cursor, diagnostics, 'if');
    if (!cond) return null;
    const then = parseBracedBody(cursor, diagnostics, 'if');
    if (!then) return null;

    let alt: Stmt[] | null = null;
    let last: Span = then.span;
    if (tryEatElse(cursor)) {
        if (cursor.atIdent('if')) {
            const chained = parseIf(cursor, diagnostics);
            if (!chained) return null;
            alt = [chained];
            last = chained.span;
        } else {
            const elseBody = parseBracedBody(cursor, diagnostics, 'else');
            if (!elseBody) return null;
            alt = elseBody.body;
            last = elseBody.span;
        }
    }
    return { kind: 'if', cond, then: then.body, alt, span: spanBetween(tokenSpan(keyword), last) };
}

/**
 * Consume `else`, and the line breaks in front of it, if that is what comes
 * next. Looking first and consuming after is the whole point: an `if` that
 * ends here is followed by a line break that still has to mean the end of the
 * statement, and skipping the break to look would eat that boundary and read
 * the next statement as leftovers of this one.
 */
function tryEatElse(cursor: TokenCursor): boolean {
    let ahead = 0;
    while (cursor.peek(ahead).kind === 'newline') ahead++;
    const t = cursor.peek(ahead);
    if (!(t.kind === 'ident' && t.text === 'else')) return false;
    for (let i = 0; i <= ahead; i++) cursor.next();
    return true;
}

function parseWhile(cursor: TokenCursor, diagnostics: Diagnostic[]): Stmt | null {
    const keyword = cursor.next();
    const cond = parseParenCond(cursor, diagnostics, 'while');
    if (!cond) return null;
    const body = parseBracedBody(cursor, diagnostics, 'while');
    if (!body) return null;
    return { kind: 'while', cond, body: body.body, span: spanBetween(tokenSpan(keyword), body.span) };
}

/**
 * `for (const x of xs) { ... }` or `for (let i = 0; i < n; i += 1) { ... }`.
 * Which one it is shows at the token after the binding: `of`, or `=`/`;`.
 */
function parseFor(cursor: TokenCursor, diagnostics: Diagnostic[]): Stmt | null {
    const keyword = cursor.next();
    if (!cursor.tryEat('lparen')) {
        diagnostics.push(error('stmt.expected-lparen',
            "Expected '(' after 'for'", tokenSpan(cursor.peek()), { what: 'for' }));
        return null;
    }

    // for-of: `for (const x of ...)` / `for (let [a, b] of ...)`
    if (cursor.atIdent('const') || cursor.atIdent('let')) {
        const declKeyword = cursor.next();
        const mutable = declKeyword.text === 'let';
        const target = parseBindTarget(cursor, diagnostics);
        if (!target) return null;

        if (cursor.atIdent('of')) {
            cursor.next();
            const iterable = parseExpr(cursor, diagnostics, 'stmt');
            if (!iterable) return null;
            if (!cursor.tryEat('rparen')) {
                diagnostics.push(error('stmt.expected-rparen-head',
                    "Expected ')' to close the for head", tokenSpan(cursor.peek())));
                return null;
            }
            const body = parseBracedBody(cursor, diagnostics, 'for');
            if (!body) return null;
            return {
                kind: 'for-of', mutable, target, iterable,
                body: body.body, span: spanBetween(tokenSpan(keyword), body.span),
            };
        }

        // Classic head starting with a declaration: `let i = 0`
        let init: Stmt | null = null;
        if (cursor.at('assign')) {
            cursor.next();
            const initValue = parseExpr(cursor, diagnostics, 'stmt');
            if (!initValue) return null;
            init = {
                kind: 'decl', mutable, target, init: initValue,
                span: spanBetween(tokenSpan(declKeyword), initValue.span),
            };
        } else {
            init = { kind: 'decl', mutable, target, init: null, span: spanBetween(tokenSpan(declKeyword), target.span) };
        }
        return parseClassicForTail(cursor, diagnostics, tokenSpan(keyword), init);
    }

    // Classic head starting with an expression or nothing: `for (; i < n; ...)`
    let init: Stmt | null = null;
    if (!cursor.at('semicolon')) {
        const expr = parseExpr(cursor, diagnostics, 'stmt');
        if (!expr) return null;
        init = { kind: 'expr', expr, span: expr.span };
    }
    return parseClassicForTail(cursor, diagnostics, tokenSpan(keyword), init);
}

/** From the first `;` of a classic for head. `for (;;)` runs on fuel alone. */
function parseClassicForTail(
    cursor: TokenCursor, diagnostics: Diagnostic[], start: Span, init: Stmt | null
): Stmt | null {
    if (!cursor.tryEat('semicolon')) {
        diagnostics.push(error('stmt.expected-semicolon',
            "Expected ';' in the for head (for-of is written 'for (const x of xs)')",
            tokenSpan(cursor.peek())));
        return null;
    }
    let cond: Expr | null = null;
    if (!cursor.at('semicolon')) {
        cond = parseExpr(cursor, diagnostics, 'stmt');
        if (!cond) return null;
    }
    if (!cursor.tryEat('semicolon')) {
        diagnostics.push(error('stmt.expected-second-semicolon',
            "Expected the second ';' in the for head", tokenSpan(cursor.peek())));
        return null;
    }
    let update: Expr | null = null;
    if (!cursor.at('rparen')) {
        update = parseExpr(cursor, diagnostics, 'stmt');
        if (!update) return null;
    }
    if (!cursor.tryEat('rparen')) {
        diagnostics.push(error('stmt.expected-rparen-head',
            "Expected ')' to close the for head", tokenSpan(cursor.peek())));
        return null;
    }
    const body = parseBracedBody(cursor, diagnostics, 'for');
    if (!body) return null;
    return { kind: 'for', init, cond, update, body: body.body, span: spanBetween(start, body.span) };
}

/**
 * `return x` / bare `return`. Means something only inside a function body;
 * the section itself has no caller, so at the top level the way to emit a
 * value is named instead.
 */
function parseReturn(cursor: TokenCursor, diagnostics: Diagnostic[]): Stmt | null {
    const keyword = cursor.next();
    if (fnDepth === 0) {
        diagnostics.push(error('stmt.return-not-here',
            'The js section does not return a value — splice it into the body with ${...}',
            tokenSpan(keyword)));
        return null;
    }
    if (atBoundary(cursor)) {
        return { kind: 'return', value: null, span: tokenSpan(keyword) };
    }
    const value = parseExpr(cursor, diagnostics, 'stmt');
    if (!value) return null;
    return { kind: 'return', value, span: spanBetween(tokenSpan(keyword), value.span) };
}

/** `( cond )`. Assignments parse here so `if (n = 1)` can be warned, not mangled. */
function parseParenCond(cursor: TokenCursor, diagnostics: Diagnostic[], what: string): Expr | null {
    if (!cursor.tryEat('lparen')) {
        diagnostics.push(error('stmt.expected-lparen',
            `Expected '(' after '${what}'`, tokenSpan(cursor.peek()), { what }));
        return null;
    }
    const cond = parseExpr(cursor, diagnostics, 'stmt');
    if (!cond) return null;
    if (!cursor.tryEat('rparen')) {
        diagnostics.push(error('stmt.expected-rparen',
            `Expected ')' to close the ${what} condition`, tokenSpan(cursor.peek()), { what }));
        return null;
    }
    return cond;
}

/** `{ statements }` — the body of if/else/while/for. */
function parseBracedBody(
    cursor: TokenCursor, diagnostics: Diagnostic[], what: string
): { body: Stmt[]; span: Span } | null {
    cursor.skipNewlines();
    const open = cursor.peek();
    if (open.kind !== 'lbrace') {
        diagnostics.push(error('stmt.body-needs-braces',
            `The ${what} body is written in braces — a bare statement is where a dangling 'else' comes from`,
            tokenSpan(open), { what }));
        return null;
    }
    cursor.next();
    const body = parseStmtList(cursor, diagnostics, 'rbrace');
    const close = cursor.tryEat('rbrace');
    if (!close) {
        diagnostics.push(error('stmt.expected-rbrace-body',
            `Expected '}' to close the ${what} body`, tokenSpan(cursor.peek()), { what }));
        return null;
    }
    return { body, span: spanBetween(tokenSpan(open), tokenSpan(close)) };
}

/**
 * Whether the `{` the cursor sits on opens what someone meant as a record.
 * `{a: 1}` is the tell — a field name and a colon — and a block cannot start
 * that way, since the language has no labels. Line breaks are stepped over so
 * a record written open across lines is recognized too.
 *
 * Shared with the expression parser, which faces the same fork after an
 * arrow's `=>`. One test, so the two places cannot drift into disagreeing
 * about what `x => {a: 1}` is.
 */
export function looksLikeRecord(cursor: TokenCursor): boolean {
    let ahead = 1;
    while (cursor.peek(ahead).kind === 'newline') ahead++;
    const key = cursor.peek(ahead);
    if (key.kind !== 'ident' && key.kind !== 'string') return false;
    return cursor.peek(ahead + 1).kind === 'colon';
}

/** A bare `{ ... }` in statement position: a scope. */
function parseBlockStmt(cursor: TokenCursor, diagnostics: Diagnostic[]): Stmt | null {
    const open = cursor.next();
    const body = parseStmtList(cursor, diagnostics, 'rbrace');
    const close = cursor.tryEat('rbrace');
    if (!close) {
        diagnostics.push(error('stmt.expected-rbrace-block',
            "Expected '}' to close the block", tokenSpan(cursor.peek())));
        return null;
    }
    return { kind: 'block', body, span: spanBetween(tokenSpan(open), tokenSpan(close)) };
}
