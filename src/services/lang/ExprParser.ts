import { type Diagnostic, type Span, error } from './Diagnostic';
import { type BinaryOp, type Expr, FN_NAMES, type FnName, type InterpolationPart, type PropName } from './ExprAst';
import { findInterpolationEnd, splitDurationText, tokenize } from './Lexer';
import { type Token, TokenCursor, tokenSpan } from './Token';
import { weekdayFromName } from './Value';

/** Bare idents inside expressions that read as unit keywords (startOf(week)). */
const UNIT_KEYWORDS = ['week', 'month', 'year'] as const;

const SIMPLE_PROPS = ['start', 'end', 'due', 'content', 'done', 'today'] as const;

/**
 * Which surface an expression is being read for. One grammar, two profiles:
 * a flow command is a single expression that has to print back to canonical
 * source, while a generation block is verbatim and may use the wider forms.
 *
 * Lists and functions are refused in the flow profile at the point they are
 * written, which both keeps the printer's vocabulary closed and puts the
 * diagnostic on the literal rather than on the whole clause.
 */
export type ParseProfile = 'flow' | 'block';

/**
 * Profile for the parse in progress. Set by {@link parseExpr} only —
 * recursive descent calls {@link parseTernary} directly so a nested
 * expression cannot silently reset it.
 */
let profile: ParseProfile = 'flow';

/**
 * Recursive-descent expression parser. Consumes tokens from the cursor and
 * returns null after emitting a diagnostic when the input is malformed.
 *
 * Precedence (loose to tight):
 * ?: < ?? < || < && < comparison < + - < * / % < unary < postfix < primary
 */
export function parseExpr(cursor: TokenCursor, diagnostics: Diagnostic[], forProfile: ParseProfile = 'flow'): Expr | null {
    // Saved and restored rather than merely set: a nested call — someone
    // reaching for the exported entry point from inside a bracket or an
    // argument list — would otherwise drop a block back to flow rules
    // mid-expression, and lists would start being refused with no sign why.
    const outer = profile;
    profile = forProfile;
    try {
        return parseTernary(cursor, diagnostics);
    } finally {
        profile = outer;
    }
}

function spanBetween(a: Span, b: Span): Span {
    return { start: a.start, end: b.end };
}

function parseTernary(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const cond = parseNullish(cursor, diagnostics);
    if (!cond) return null;
    if (!cursor.tryEat('question')) return cond;
    const thenExpr = parseTernary(cursor, diagnostics);
    if (!thenExpr) return null;
    if (!cursor.tryEat('colon')) {
        diagnostics.push(error('expr.expected-colon', "Expected ':' in conditional expression", tokenSpan(cursor.peek())));
        return null;
    }
    const elseExpr = parseTernary(cursor, diagnostics);
    if (!elseExpr) return null;
    return { kind: 'cond', cond, then: thenExpr, else: elseExpr, span: spanBetween(cond.span, elseExpr.span) };
}

/**
 * `a ?? b` — b only when a is none. Looser than `||`, as in JS.
 *
 * Mixing the two without parentheses is a syntax error in JS, and reading
 * `a || b ?? c` silently as `(a || b) ?? c` is exactly the kind of quiet
 * disagreement this language avoids. The parenthesized form is not affected:
 * parentheses are consumed by the primary parser, so `||` inside them never
 * appears on this level's token run.
 */
function parseNullish(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const logic: LogicSeen = { any: false };
    let left = parseOr(cursor, diagnostics, logic);
    if (!left) return null;
    while (cursor.tryEat('qq')) {
        const right = parseOr(cursor, diagnostics, logic);
        if (!right) return null;
        if (logic.any) {
            diagnostics.push(error('expr.nullish-mixed-with-logic',
                "'??' cannot be mixed with '||' or '&&' — parenthesize the one you mean",
                spanBetween(left.span, right.span)));
            return null;
        }
        left = { kind: 'binary', op: '??', left, right, span: spanBetween(left.span, right.span) };
    }
    return left;
}

/**
 * Whether this `??` level actually consumed a `||`/`&&`.
 *
 * Recorded by the levels themselves rather than read back off the token run:
 * a parenthesized `a || b` is parsed by a nested descent from the primary
 * parser, so it never sets this flag — and the rule stays right no matter
 * which bracket kinds the lexer grows later.
 */
interface LogicSeen { any: boolean }

function parseOr(cursor: TokenCursor, diagnostics: Diagnostic[], logic?: LogicSeen): Expr | null {
    let left = parseAnd(cursor, diagnostics, logic);
    if (!left) return null;
    while (cursor.tryEat('pipepipe')) {
        if (logic) logic.any = true;
        const right = parseAnd(cursor, diagnostics, logic);
        if (!right) return null;
        left = { kind: 'binary', op: '||', left, right, span: spanBetween(left.span, right.span) };
    }
    return left;
}

function parseAnd(cursor: TokenCursor, diagnostics: Diagnostic[], logic?: LogicSeen): Expr | null {
    let left = parseComparison(cursor, diagnostics);
    if (!left) return null;
    while (cursor.tryEat('ampamp')) {
        if (logic) logic.any = true;
        const right = parseComparison(cursor, diagnostics);
        if (!right) return null;
        left = { kind: 'binary', op: '&&', left, right, span: spanBetween(left.span, right.span) };
    }
    return left;
}

const COMPARISON_OPS: Partial<Record<Token['kind'], BinaryOp>> = {
    eq: '==', neq: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=',
};

/**
 * Comparisons do not chain: `a < b < c` reads as `(a < b) < c` in JS, which
 * compares a bool with c and is never what anyone means. This level takes one
 * operator and stops — and says so when a second one follows, rather than
 * dropping the rest of the expression on the floor.
 */
function parseComparison(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const left = parseAdditive(cursor, diagnostics);
    if (!left) return null;
    const op = COMPARISON_OPS[cursor.peek().kind];
    if (!op) return left;
    cursor.next();
    const right = parseAdditive(cursor, diagnostics);
    if (!right) return null;
    const expr: Expr = { kind: 'binary', op, left, right, span: spanBetween(left.span, right.span) };
    const chained = COMPARISON_OPS[cursor.peek().kind];
    if (chained) {
        diagnostics.push(error('expr.comparison-chain',
            `Comparisons do not chain — parenthesize what you mean: (a ${op} b) ${chained} c`,
            spanBetween(expr.span, tokenSpan(cursor.peek())), { first: op, second: chained }));
        return null;
    }
    return expr;
}

function parseAdditive(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    let left = parseMultiplicative(cursor, diagnostics);
    if (!left) return null;
    for (;;) {
        const op: BinaryOp | null = cursor.at('plus') ? '+' : cursor.at('minus') ? '-' : null;
        if (!op) return left;
        cursor.next();
        const right = parseMultiplicative(cursor, diagnostics);
        if (!right) return null;
        left = { kind: 'binary', op, left, right, span: spanBetween(left.span, right.span) };
    }
}

/**
 * Multiplicative binds tighter than additive, as in JS. `%` is the remainder
 * operator here; the line-leading marker of a generation block is a different
 * layer and never reaches this parser.
 */
function parseMultiplicative(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    let left = parseUnary(cursor, diagnostics);
    if (!left) return null;
    for (;;) {
        const t = cursor.peek();
        const op: BinaryOp | null =
            t.kind === 'star' ? '*' :
            t.kind === 'slash' ? '/' :
            t.kind === 'percent' ? '%' : null;
        if (!op) return left;
        cursor.next();
        const right = parseUnary(cursor, diagnostics);
        if (!right) return null;
        left = { kind: 'binary', op, left, right, span: spanBetween(left.span, right.span) };
    }
}

function parseUnary(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    if (cursor.at('bang') || cursor.at('minus')) {
        const opToken = cursor.next();
        const operand = parseUnary(cursor, diagnostics);
        if (!operand) return null;
        return {
            kind: 'unary',
            op: opToken.kind === 'bang' ? '!' : '-',
            operand,
            span: spanBetween(tokenSpan(opToken), operand.span),
        };
    }
    return parsePostfix(cursor, diagnostics);
}

/**
 * Property reads and method calls on a value: `start.format("MM/DD")`,
 * `title.length`, `xs?.first`.
 *
 * `file.name` never reaches here — it is consumed as a single property by
 * {@link parseIdentLed}, so the two spellings do not compete.
 */
function parsePostfix(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    let obj = parsePrimary(cursor, diagnostics);
    if (!obj) return null;
    for (;;) {
        if (cursor.at('lbracket')) {
            const next = parseIndex(cursor, diagnostics, obj, false);
            if (!next) return null;
            obj = next;
            continue;
        }
        const optional = cursor.at('qdot');
        if (!optional && !cursor.at('dot')) return obj;
        cursor.next();

        // `xs?.[0]` — the optional form of an element read.
        if (optional && cursor.at('lbracket')) {
            const next = parseIndex(cursor, diagnostics, obj, true);
            if (!next) return null;
            obj = next;
            continue;
        }

        const nameToken = cursor.peek();
        if (nameToken.kind !== 'ident') {
            diagnostics.push(error('expr.expected-member', 'Expected a property or method name after the dot',
                tokenSpan(nameToken)));
            return null;
        }
        cursor.next();

        if (cursor.at('lparen')) {
            const args = parseArgs(cursor, diagnostics);
            if (!args) return null;
            obj = {
                kind: 'method', obj, name: nameToken.text, args, optional,
                span: spanBetween(obj.span, tokenSpan(cursor.peek(-1))),
            };
            continue;
        }
        obj = {
            kind: 'member', obj, name: nameToken.text, optional,
            span: spanBetween(obj.span, tokenSpan(nameToken)),
        };
    }
}

/** `xs[i]`. Cursor sits on '['. */
function parseIndex(cursor: TokenCursor, diagnostics: Diagnostic[], obj: Expr, optional: boolean): Expr | null {
    cursor.next(); // consume '['
    const index = parseTernary(cursor, diagnostics);
    if (!index) return null;
    const close = cursor.tryEat('rbracket');
    if (!close) {
        diagnostics.push(error('expr.expected-rbracket', "Expected ']'", tokenSpan(cursor.peek())));
        return null;
    }
    return { kind: 'index', obj, index, optional, span: spanBetween(obj.span, tokenSpan(close)) };
}

function parsePrimary(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const token = cursor.peek();
    const span = tokenSpan(token);

    // `x => ...` / `(a, b) => ...`. Checked before the parenthesized-expression
    // branch, which would otherwise eat the parameter list.
    if (isArrowAhead(cursor)) {
        return parseArrow(cursor, diagnostics);
    }

    switch (token.kind) {
        case 'lbracket':
            return parseArrayLiteral(cursor, diagnostics);
        case 'lbrace':
            return parseRecordLiteral(cursor, diagnostics);
        case 'ellipsis': {
            // Accepted here so the diagnostic can say where a spread belongs;
            // the list literal consumes its own before reaching this.
            cursor.next();
            diagnostics.push(error('expr.spread-not-here',
                'A spread only means something inside a list: [...xs, y]', span));
            return null;
        }
        case 'date':
            cursor.next();
            return { kind: 'lit', value: { type: 'date', value: token.text }, span };
        case 'datetime': {
            cursor.next();
            const [date, time] = token.text.split('T');
            return { kind: 'lit', value: { type: 'datetime', date, time }, span };
        }
        case 'time':
            cursor.next();
            return { kind: 'lit', value: { type: 'time', value: normalizeTime(token.text) }, span };
        case 'duration': {
            cursor.next();
            const { amount, unit } = splitDurationText(token.text);
            return { kind: 'lit', value: { type: 'duration', amount, unit }, span };
        }
        case 'number':
            cursor.next();
            return { kind: 'lit', value: { type: 'number', value: parseFloat(token.text) }, span };
        case 'string':
            cursor.next();
            return { kind: 'lit', value: { type: 'string', value: token.text }, span };
        case 'wikilink':
            cursor.next();
            return { kind: 'lit', value: { type: 'link', target: token.text }, span };
        case 'template': {
            cursor.next();
            // Block-only, like lists. A flow command is re-serialized on every
            // firing, and carrying interpolation back out canonically is a
            // heavy contract for the printer to hold for a rare shape — so
            // the surface that has to print says to join with + instead.
            if (profile === 'flow') {
                diagnostics.push(error('expr.template-not-here',
                    'A template literal is only available inside a generation block — join with + here', span));
                return null;
            }
            // The token holds the text between the backticks, so an offset of
            // one puts the interpolations back where the reader sees them.
            const parts = splitInterpolations(token.text, diagnostics, span.start + 1, 'block');
            return { kind: 'template', parts, span };
        }
        case 'lparen': {
            cursor.next();
            const inner = parseTernary(cursor, diagnostics);
            if (!inner) return null;
            if (!cursor.tryEat('rparen')) {
                diagnostics.push(error('expr.expected-rparen', "Expected ')'", tokenSpan(cursor.peek())));
                return null;
            }
            return inner;
        }
        case 'ident':
            return parseIdentLed(cursor, diagnostics);
        default:
            if (token.kind === 'eof') {
                diagnostics.push(error('expr.unexpected-eof', 'Unexpected end of expression', span));
            } else {
                diagnostics.push(error('expr.unexpected-token', `Unexpected token '${token.text}'`, span, { token: token.text }));
            }
            return null;
    }
}

/** `["a", "b"]`. Cursor sits on '['. */
function parseArrayLiteral(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const open = cursor.next();
    if (profile === 'flow') {
        diagnostics.push(error('expr.list-not-here',
            'A list is only available inside a generation block', tokenSpan(open)));
        return null;
    }
    const items: Expr[] = [];
    if (!cursor.at('rbracket')) {
        for (;;) {
            const item = cursor.at('ellipsis')
                ? parseSpread(cursor, diagnostics)
                : parseTernary(cursor, diagnostics);
            if (!item) return null;
            items.push(item);
            if (cursor.tryEat('comma')) continue;
            break;
        }
    }
    const close = cursor.tryEat('rbracket');
    if (!close) {
        diagnostics.push(error('expr.expected-rbracket-list', "Expected ']' to close the list", tokenSpan(cursor.peek())));
        return null;
    }
    return { kind: 'array', items, span: spanBetween(tokenSpan(open), tokenSpan(close)) };
}

/** `...xs`, inside a list literal. Cursor sits on the ellipsis. */
function parseSpread(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const open = cursor.next();
    const arg = parseTernary(cursor, diagnostics);
    if (!arg) return null;
    return { kind: 'spread', arg, span: spanBetween(tokenSpan(open), arg.span) };
}

/**
 * `{ mon: "a", tue: "b" }`. Cursor sits on the brace.
 *
 * Keys are written as names or as strings; a computed key is not read here,
 * because a record's fields are what the checker knows about it and a key
 * decided at evaluation would leave it knowing nothing.
 */
function parseRecordLiteral(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const open = cursor.next();
    if (profile === 'flow') {
        diagnostics.push(error('expr.record-not-here',
            'A record is only available inside a generation block', tokenSpan(open)));
        return null;
    }
    const entries: { key: string; value: Expr }[] = [];
    if (!cursor.at('rbrace')) {
        for (;;) {
            const keyToken = cursor.peek();
            if (keyToken.kind !== 'ident' && keyToken.kind !== 'string') {
                diagnostics.push(error('expr.expected-field-name',
                    'Expected a field name', tokenSpan(keyToken)));
                return null;
            }
            cursor.next();
            if (!cursor.tryEat('colon')) {
                diagnostics.push(error('expr.expected-field-value',
                    `Expected ':' after the field name '${keyToken.text}'`, tokenSpan(cursor.peek()),
                    { name: keyToken.text }));
                return null;
            }
            const value = parseTernary(cursor, diagnostics);
            if (!value) return null;
            entries.push({ key: keyToken.text, value });
            if (cursor.tryEat('comma')) continue;
            break;
        }
    }
    const close = cursor.tryEat('rbrace');
    if (!close) {
        diagnostics.push(error('expr.expected-rbrace', "Expected '}' to close the record",
            tokenSpan(cursor.peek())));
        return null;
    }
    return { kind: 'record', entries, span: spanBetween(tokenSpan(open), tokenSpan(close)) };
}

/**
 * Does an arrow function start here? `x =>` is one token of lookahead;
 * `(a, b) =>` needs the matching ')' first, since a parameter list and a
 * parenthesized expression start the same way.
 */
function isArrowAhead(cursor: TokenCursor): boolean {
    if (cursor.at('ident')) return cursor.peek(1).kind === 'arrow';
    if (!cursor.at('lparen')) return false;
    let depth = 0;
    for (let i = 0; ; i++) {
        const t = cursor.peek(i);
        if (t.kind === 'eof') return false;
        if (t.kind === 'lparen') depth++;
        else if (t.kind === 'rparen') {
            depth--;
            if (depth === 0) return cursor.peek(i + 1).kind === 'arrow';
        }
    }
}

/** `x => body` / `(a, b) => body`. Expression bodies only; blocks are statements. */
function parseArrow(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const start = cursor.peek();
    if (profile === 'flow') {
        diagnostics.push(error('expr.function-not-here',
            'A function is only available inside a generation block', tokenSpan(start)));
        return null;
    }
    const params: string[] = [];
    if (cursor.at('ident')) {
        params.push(cursor.next().text);
    } else {
        cursor.next(); // '('
        if (!cursor.at('rparen')) {
            for (;;) {
                const p = cursor.peek();
                if (p.kind !== 'ident') {
                    diagnostics.push(error('expr.expected-param', 'Expected a parameter name', tokenSpan(p)));
                    return null;
                }
                cursor.next();
                params.push(p.text);
                if (cursor.tryEat('comma')) continue;
                break;
            }
        }
        if (!cursor.tryEat('rparen')) {
            diagnostics.push(error('expr.expected-rparen', "Expected ')'", tokenSpan(cursor.peek())));
            return null;
        }
    }
    cursor.next(); // '=>'
    const body = parseTernary(cursor, diagnostics);
    if (!body) return null;
    return { kind: 'arrow', params, body, span: spanBetween(tokenSpan(start), body.span) };
}

function parseIdentLed(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const token = cursor.next();
    const span = tokenSpan(token);
    const name = token.text;

    // Function call
    if ((FN_NAMES as readonly string[]).includes(name) && cursor.at('lparen')) {
        return parseCall(name as FnName, span, cursor, diagnostics);
    }

    // Boolean literals
    if (name === 'true' || name === 'false') {
        return { kind: 'lit', value: { type: 'bool', value: name === 'true' }, span };
    }

    // None literal
    if (name === 'none') {
        return { kind: 'lit', value: { type: 'none' }, span };
    }

    // Unit keywords (arguments to startOf/endOf) are carried as strings
    if ((UNIT_KEYWORDS as readonly string[]).includes(name)) {
        return { kind: 'lit', value: { type: 'string', value: name }, span };
    }

    // Property references
    if ((SIMPLE_PROPS as readonly string[]).includes(name)) {
        return { kind: 'prop', name: name as PropName, span };
    }
    // `tv.date.format(...)` / `tv.file.name` — the namespaced spelling of the
    // built-ins. Accepted as an alias and resolved here, so the canonical form
    // stays the bare one and the printer needs no new shape.
    if (name === 'tv') {
        return parseNamespaced(name, cursor, diagnostics, span);
    }

    // `Math.floor(...)` — the same resolution as `tv.`, not a second one.
    if (name === 'Math') {
        return parseNamespaced(name, cursor, diagnostics, span);
    }

    if (name === 'file') {
        if (cursor.tryEat('dot')) {
            const member = cursor.peek();
            if (member.kind === 'ident' && member.text === 'name') {
                cursor.next();
                return { kind: 'prop', name: 'file.name', span: spanBetween(span, tokenSpan(member)) };
            }
            diagnostics.push(error('expr.unknown-property', `Unknown property 'file.${member.text}'`, tokenSpan(member), { name: `file.${member.text}` }));
            return null;
        }
        diagnostics.push(error('expr.file-needs-member', "Property 'file' requires a member (file.name)", span));
        return null;
    }

    // Inside a block, a name the built-ins do not claim is a binding — today
    // an arrow parameter, later a cell. The built-ins resolve first, which is
    // what makes those names effectively reserved.
    if (profile === 'block') {
        return { kind: 'var', name, span };
    }

    // A weekday is a string here, so `start.weekday() == "tue"` — the form
    // everyone writes — compares equal. Bare `mon` survives only in the
    // schedule syntax (`every mon,fri`), which never reaches this parser.
    if (weekdayFromName(name) !== null) {
        diagnostics.push(error('expr.weekday-not-literal',
            `Weekdays are strings in expressions — write "${name}" (bare ${name} is only for 'every ${name}')`,
            span, { name }));
        return null;
    }

    diagnostics.push(error('expr.unknown-ident', `Unknown identifier '${name}'`, span, { name }));
    return null;
}

/**
 * A built-in reached through a namespace: `tv.date.format(...)`,
 * `tv.file.name`, `Math.floor(...)`.
 *
 * One resolver for all of them. `tv.date.*` is an alias that resolves to the
 * bare function so the canonical form stays single, while `Math.*` keeps its
 * namespace in the name itself — a dot cannot appear in an identifier, so
 * there is no bare spelling to collide with and the printed form reads back
 * as the same call.
 */
function parseNamespaced(root: string, cursor: TokenCursor, diagnostics: Diagnostic[], span: Span): Expr | null {
    const hint = root === 'tv' ? "'tv' requires a member (tv.date.format(...) / tv.file.name)" : "'Math' requires a member (Math.floor(...))";
    if (!cursor.tryEat('dot')) {
        diagnostics.push(error('expr.namespace-needs-member', hint, span, { name: root }));
        return null;
    }

    // `tv` has one more level; `Math` holds its functions directly.
    let group = root;
    if (root === 'tv') {
        const groupToken = cursor.peek();
        if (groupToken.kind !== 'ident' || (groupToken.text !== 'date' && groupToken.text !== 'file')) {
            diagnostics.push(error('expr.unknown-property', `Unknown namespace 'tv.${groupToken.text}'`,
                tokenSpan(groupToken), { name: `tv.${groupToken.text}` }));
            return null;
        }
        cursor.next();
        group = `tv.${groupToken.text}`;
        if (!cursor.tryEat('dot')) {
            diagnostics.push(error('expr.namespace-needs-member', `'${group}' requires a member`, span, { name: group }));
            return null;
        }
    }

    const member = cursor.peek();
    if (member.kind !== 'ident') {
        diagnostics.push(error('expr.expected-member', 'Expected a name after the dot', tokenSpan(member)));
        return null;
    }
    const written = `${group}.${member.text}`;

    if (group === 'tv.file') {
        if (member.text !== 'name') {
            diagnostics.push(error('expr.unknown-property', `Unknown property '${written}'`,
                tokenSpan(member), { name: written }));
            return null;
        }
        cursor.next();
        return { kind: 'prop', name: 'file.name', span: spanBetween(span, tokenSpan(member)) };
    }

    // `tv.date.format` resolves to `format`; `Math.floor` keeps its name.
    const resolved = group === 'tv.date' ? member.text : written;
    if (!(FN_NAMES as readonly string[]).includes(resolved)) {
        diagnostics.push(error('expr.unknown-property', `Unknown function '${written}'`,
            tokenSpan(member), { name: written }));
        return null;
    }
    cursor.next();
    if (!cursor.at('lparen')) {
        diagnostics.push(error('expr.expected-call', `'${written}' is a function — call it`, tokenSpan(member), { name: written }));
        return null;
    }
    return parseCall(resolved as FnName, spanBetween(span, tokenSpan(member)), cursor, diagnostics);
}

function parseCall(fn: FnName, fnSpan: Span, cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const args = parseArgs(cursor, diagnostics, fn);
    if (!args) return null;
    return { kind: 'call', fn, args, span: spanBetween(fnSpan, tokenSpan(cursor.peek(-1))) };
}

/** `( a, b )` — shared by plain calls and method calls. Cursor sits on '('. */
function parseArgs(cursor: TokenCursor, diagnostics: Diagnostic[], fn = 'the call'): Expr[] | null {
    cursor.next(); // consume '('
    const args: Expr[] = [];
    if (!cursor.at('rparen')) {
        for (;;) {
            const arg = parseTernary(cursor, diagnostics);
            if (!arg) return null;
            args.push(arg);
            if (cursor.tryEat('comma')) continue;
            break;
        }
    }
    if (!cursor.tryEat('rparen')) {
        diagnostics.push(error('expr.expected-rparen-call', `Expected ')' to close ${fn}(...)`, tokenSpan(cursor.peek()), { fn }));
        return null;
    }
    return args;
}

/** Normalize H:mm to HH:mm so time values compare lexicographically. */
function normalizeTime(text: string): string {
    const [h, m] = text.split(':');
    return `${h.padStart(2, '0')}:${m}`;
}


/**
 * Split text into its literal parts and its `${...}` expressions.
 *
 * Used for a template literal and for a line of a generation block's body,
 * which are the same problem written two ways. Diagnostic spans are absolute:
 * `offset` is where `text` sits in whatever the reader is looking at.
 *
 * Everything that goes wrong is reported — a line with two broken
 * interpolations says so twice rather than stopping at the first.
 */
export function splitInterpolations(
    text: string,
    diagnostics: Diagnostic[],
    offset = 0,
    forProfile: ParseProfile = 'block'
): InterpolationPart[] {
    const parts: InterpolationPart[] = [];
    let literal = '';
    const flushLiteral = () => {
        if (literal !== '') parts.push({ kind: 'text', text: literal });
        literal = '';
    };
    let i = 0;

    while (i < text.length) {
        if (text[i] !== '$' || text[i + 1] !== '{') { literal += text[i]; i++; continue; }
        // A backslash immediately before makes the `${` literal, and is the
        // only thing a backslash ever does here: everywhere else it is an
        // ordinary character, so a Windows path can be written as it is.
        if (literal.endsWith('\\')) {
            literal = literal.slice(0, -1) + '${';
            i += 2;
            continue;
        }
        const end = findInterpolationEnd(text, i);
        if (end === -1) {
            diagnostics.push(error('gen.unterminated-interpolation',
                "Unterminated '${' — the closing brace is missing",
                { start: offset + i, end: offset + text.length }));
            break;
        }
        flushLiteral();

        const source = text.slice(i + 2, end);
        const span = { start: offset + i, end: offset + end + 1 };
        const expr = parseWholeExpr(source, offset + i + 2, span, diagnostics, forProfile);
        if (expr) parts.push({ kind: 'expr', expr, span });

        i = end + 1;
    }
    flushLiteral();
    return parts;
}

/**
 * One `${...}`, read to the end.
 *
 * The expression parser reads one expression and stops, which is fine inside
 * a call where the `)` catches whatever is left over. Nothing catches it here.
 * Without this check `${a == b == c}` would quietly generate from `a == b`,
 * and no round-trip test can see it: the half that was read prints and reads
 * back perfectly well.
 */
function parseWholeExpr(
    source: string,
    offset: number,
    span: Span,
    diagnostics: Diagnostic[],
    forProfile: ParseProfile
): Expr | null {
    // Lexed with the offset, so every span the parse produces — the tokens,
    // the AST nodes, and anything the checker or the evaluator reports later
    // against them — already points into the line the reader is looking at.
    const { tokens, diagnostics: lexDiagnostics } = tokenize(source, offset);
    diagnostics.push(...lexDiagnostics);
    const cursor = new TokenCursor(tokens);
    const expr = parseExpr(cursor, diagnostics, forProfile);
    if (!expr) return null;
    if (!cursor.atEof()) {
        diagnostics.push(error('gen.trailing-input',
            `Not all of this was read — there is more after the expression in '${source.trim()}'`,
            span, { source: source.trim() }));
        return null;
    }
    return expr;
}
