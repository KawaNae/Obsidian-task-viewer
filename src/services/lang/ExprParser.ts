import { type Diagnostic, type Span, error } from './Diagnostic';
import { type BinaryOp, type Expr, FN_NAMES, type FnName, type PropName } from './ExprAst';
import { splitDurationText } from './Lexer';
import { type Token, type TokenCursor, tokenSpan } from './Token';
import { weekdayFromName } from './Value';

/** Bare idents inside expressions that read as unit keywords (startOf(week)). */
const UNIT_KEYWORDS = ['week', 'month', 'year'] as const;

const SIMPLE_PROPS = ['start', 'end', 'due', 'content', 'done', 'today'] as const;

/**
 * Recursive-descent expression parser. Consumes tokens from the cursor and
 * returns null after emitting a diagnostic when the input is malformed.
 *
 * Precedence (loose to tight):
 * ?: < ?? < || < && < comparison < + - < * / % < unary < postfix < primary
 */
export function parseExpr(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    return parseTernary(cursor, diagnostics);
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
        const optional = cursor.at('qdot');
        if (!optional && !cursor.at('dot')) return obj;
        cursor.next();

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

function parsePrimary(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const token = cursor.peek();
    const span = tokenSpan(token);

    switch (token.kind) {
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
            return { kind: 'lit', value: { type: 'number', value: parseInt(token.text, 10) }, span };
        case 'string':
            cursor.next();
            return { kind: 'lit', value: { type: 'string', value: token.text }, span };
        case 'wikilink':
            cursor.next();
            return { kind: 'lit', value: { type: 'link', target: token.text }, span };
        case 'lparen': {
            cursor.next();
            const inner = parseExpr(cursor, diagnostics);
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
        return parseTvNamespace(cursor, diagnostics, span);
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

/** `tv.date.<fn>(...)` and `tv.file.name`, resolved to the bare forms. */
function parseTvNamespace(cursor: TokenCursor, diagnostics: Diagnostic[], span: Span): Expr | null {
    if (!cursor.tryEat('dot')) {
        diagnostics.push(error('expr.tv-needs-member', "'tv' requires a member (tv.date.format(...) / tv.file.name)", span));
        return null;
    }
    const group = cursor.peek();
    if (group.kind !== 'ident' || (group.text !== 'date' && group.text !== 'file')) {
        diagnostics.push(error('expr.unknown-property', `Unknown namespace 'tv.${group.text}'`,
            tokenSpan(group), { name: `tv.${group.text}` }));
        return null;
    }
    cursor.next();
    if (!cursor.tryEat('dot')) {
        diagnostics.push(error('expr.tv-needs-member', `'tv.${group.text}' requires a member`, span));
        return null;
    }
    const member = cursor.peek();
    if (member.kind !== 'ident') {
        diagnostics.push(error('expr.expected-member', 'Expected a name after the dot', tokenSpan(member)));
        return null;
    }

    if (group.text === 'file') {
        if (member.text !== 'name') {
            diagnostics.push(error('expr.unknown-property', `Unknown property 'tv.file.${member.text}'`,
                tokenSpan(member), { name: `tv.file.${member.text}` }));
            return null;
        }
        cursor.next();
        return { kind: 'prop', name: 'file.name', span: spanBetween(span, tokenSpan(member)) };
    }

    if (!(FN_NAMES as readonly string[]).includes(member.text)) {
        diagnostics.push(error('expr.unknown-property', `Unknown function 'tv.date.${member.text}'`,
            tokenSpan(member), { name: `tv.date.${member.text}` }));
        return null;
    }
    cursor.next();
    if (!cursor.at('lparen')) {
        diagnostics.push(error('expr.expected-call', `'tv.date.${member.text}' is a function — call it`, tokenSpan(member)));
        return null;
    }
    return parseCall(member.text as FnName, spanBetween(span, tokenSpan(member)), cursor, diagnostics);
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
            const arg = parseExpr(cursor, diagnostics);
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
