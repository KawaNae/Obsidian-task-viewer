import { Diagnostic, Span, error } from './Diagnostic';
import { BinaryOp, Expr, FN_NAMES, FnName, PropName } from './ExprAst';
import { splitDurationText } from './Lexer';
import { Token, TokenCursor, tokenSpan } from './Token';
import { weekdayFromName } from './Value';

/** Bare idents inside expressions that read as unit keywords (startOf(week)). */
const UNIT_KEYWORDS = ['week', 'month', 'year'] as const;

const SIMPLE_PROPS = ['start', 'end', 'due', 'content', 'done'] as const;

/**
 * Recursive-descent expression parser. Consumes tokens from the cursor and
 * returns null after emitting a diagnostic when the input is malformed.
 *
 * Precedence (loose to tight): ?: < || < && < comparison < + - < unary < primary
 */
export function parseExpr(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    return parseTernary(cursor, diagnostics);
}

function spanBetween(a: Span, b: Span): Span {
    return { start: a.start, end: b.end };
}

function parseTernary(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const cond = parseOr(cursor, diagnostics);
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

function parseOr(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    let left = parseAnd(cursor, diagnostics);
    if (!left) return null;
    while (cursor.tryEat('pipepipe')) {
        const right = parseAnd(cursor, diagnostics);
        if (!right) return null;
        left = { kind: 'binary', op: '||', left, right, span: spanBetween(left.span, right.span) };
    }
    return left;
}

function parseAnd(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    let left = parseComparison(cursor, diagnostics);
    if (!left) return null;
    while (cursor.tryEat('ampamp')) {
        const right = parseComparison(cursor, diagnostics);
        if (!right) return null;
        left = { kind: 'binary', op: '&&', left, right, span: spanBetween(left.span, right.span) };
    }
    return left;
}

const COMPARISON_OPS: Partial<Record<Token['kind'], BinaryOp>> = {
    eq: '==', neq: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=',
};

function parseComparison(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    const left = parseAdditive(cursor, diagnostics);
    if (!left) return null;
    const op = COMPARISON_OPS[cursor.peek().kind];
    if (!op) return left;
    cursor.next();
    const right = parseAdditive(cursor, diagnostics);
    if (!right) return null;
    return { kind: 'binary', op, left, right, span: spanBetween(left.span, right.span) };
}

function parseAdditive(cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
    let left = parseUnary(cursor, diagnostics);
    if (!left) return null;
    for (;;) {
        const op: BinaryOp | null = cursor.at('plus') ? '+' : cursor.at('minus') ? '-' : null;
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
    return parsePrimary(cursor, diagnostics);
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
            diagnostics.push(error('expr.unexpected-token',
                token.kind === 'eof' ? 'Unexpected end of expression' : `Unexpected token '${token.text}'`,
                span));
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

    // Weekday literals
    const weekday = weekdayFromName(name);
    if (weekday !== null) {
        return { kind: 'lit', value: { type: 'weekday', value: weekday }, span };
    }

    // Unit keywords (arguments to startOf/endOf) are carried as strings
    if ((UNIT_KEYWORDS as readonly string[]).includes(name)) {
        return { kind: 'lit', value: { type: 'string', value: name }, span };
    }

    // Property references
    if ((SIMPLE_PROPS as readonly string[]).includes(name)) {
        return { kind: 'prop', name: name as PropName, span };
    }
    if (name === 'file') {
        if (cursor.tryEat('dot')) {
            const member = cursor.peek();
            if (member.kind === 'ident' && member.text === 'name') {
                cursor.next();
                return { kind: 'prop', name: 'file.name', span: spanBetween(span, tokenSpan(member)) };
            }
            diagnostics.push(error('expr.unknown-property', `Unknown property 'file.${member.text}'`, tokenSpan(member)));
            return null;
        }
        diagnostics.push(error('expr.unknown-property', "Property 'file' requires a member (file.name)", span));
        return null;
    }

    diagnostics.push(error('expr.unknown-ident', `Unknown identifier '${name}'`, span));
    return null;
}

function parseCall(fn: FnName, fnSpan: Span, cursor: TokenCursor, diagnostics: Diagnostic[]): Expr | null {
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
    const close = cursor.tryEat('rparen');
    if (!close) {
        diagnostics.push(error('expr.expected-rparen', `Expected ')' to close ${fn}(...)`, tokenSpan(cursor.peek())));
        return null;
    }
    return { kind: 'call', fn, args, span: spanBetween(fnSpan, tokenSpan(close)) };
}

/** Normalize H:mm to HH:mm so time values compare lexicographically. */
function normalizeTime(text: string): string {
    const [h, m] = text.split(':');
    return `${h.padStart(2, '0')}:${m}`;
}
