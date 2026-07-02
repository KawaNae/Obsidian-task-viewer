import { Diagnostic, Span, error } from '../lang/Diagnostic';
import { parseExpr } from '../lang/ExprParser';
import { splitDurationText, tokenize } from '../lang/Lexer';
import { Token, TokenCursor, tokenSpan } from '../lang/Token';
import { Weekday, weekdayFromName } from '../lang/Value';
import { EveryRule, FlowProgram, SetAssignment, SetField, ScheduleNode } from './FlowAst';
import { checkFlow } from './FlowChecker';

export interface ParseFlowResult {
    /** Non-null iff there are no error diagnostics (warnings allowed). */
    program: FlowProgram | null;
    diagnostics: Diagnostic[];
}

const HEAD_HINT = 'clauses start with every / + / at(...) / xN / until / nochildren / set(...) / move(...)';
const SET_FIELDS: SetField[] = ['content', 'start', 'end', 'due'];
const LEGACY_HEADS = ['repeat', 'next'];

/**
 * Parse the raw text after `==>` into a FlowProgram.
 *
 * Grammar: flow := node+ — whitespace-separated, order-free, at most one
 * node per kind. Every node is self-identified by its head token, so a
 * misordering like `tue every` fails loudly instead of being misread.
 */
export function parseFlow(raw: string): ParseFlowResult {
    const { tokens, diagnostics } = tokenize(raw);
    const cursor = new TokenCursor(tokens);
    const program: FlowProgram = {};

    while (!cursor.atEof()) {
        parseNode(cursor, program, diagnostics);
    }

    checkFlow(program, diagnostics);

    const hasError = diagnostics.some(d => d.severity === 'error');
    return { program: hasError ? null : program, diagnostics };
}

function parseNode(cursor: TokenCursor, program: FlowProgram, diagnostics: Diagnostic[]): void {
    const head = cursor.peek();

    // +3d — offset from the visible anchor date (what the notation reads as)
    if (head.kind === 'plus' && cursor.peek(1).kind === 'duration') {
        cursor.next();
        const dur = cursor.next();
        const { amount, unit } = splitDurationText(dur.text);
        assignSchedule(program, { kind: 'plus', amount, unit, span: { start: head.start, end: dur.end } }, diagnostics);
        return;
    }

    if (head.kind !== 'ident') {
        diagnostics.push(error('flow.unknown-head', `Unknown clause '${head.text}' — ${HEAD_HINT}`, tokenSpan(head), { head: head.text }));
        cursor.next();
        skipToNextNode(cursor);
        return;
    }

    // xN — telomere lifetime
    const telomere = head.text.match(/^x(\d+)$/);
    if (telomere) {
        cursor.next();
        const count = parseInt(telomere[1], 10);
        if (count < 1) {
            diagnostics.push(error('flow.zero-lifetime', 'xN requires N >= 1', tokenSpan(head)));
            return;
        }
        assignNode(program, 'lifetime', { count, span: tokenSpan(head) }, diagnostics, tokenSpan(head));
        return;
    }

    switch (head.text) {
        case 'every':
            parseEvery(cursor, program, diagnostics);
            return;
        case 'at': {
            cursor.next();
            const expr = parseParenExpr(cursor, 'at', diagnostics);
            if (expr) {
                assignSchedule(program, { kind: 'at', expr, span: { start: head.start, end: expr.span.end + 1 } }, diagnostics);
            } else {
                skipToNextNode(cursor);
            }
            return;
        }
        case 'until': {
            cursor.next();
            const date = cursor.tryEat('date');
            if (!date) {
                diagnostics.push(error('flow.expected-date', "Expected a date after 'until' (e.g. until 2026-09-28)", tokenSpan(cursor.peek())));
                skipToNextNode(cursor);
                return;
            }
            assignNode(program, 'until', { date: date.text, span: { start: head.start, end: date.end } }, diagnostics, tokenSpan(head));
            return;
        }
        case 'nochildren':
            cursor.next();
            assignNode(program, 'nochildren', { span: tokenSpan(head) }, diagnostics, tokenSpan(head));
            return;
        case 'set':
            parseSet(cursor, program, diagnostics);
            return;
        case 'move': {
            cursor.next();
            const target = parseParenExpr(cursor, 'move', diagnostics);
            if (target) {
                assignNode(program, 'move', { target, span: { start: head.start, end: target.span.end + 1 } }, diagnostics, tokenSpan(head));
            } else {
                skipToNextNode(cursor);
            }
            return;
        }
    }

    cursor.next();
    if (LEGACY_HEADS.includes(head.text) && cursor.at('lparen')) {
        diagnostics.push(error('flow.legacy-syntax',
            `'${head.text}(...)' is the removed legacy syntax — use 'every <cadence>' / '+<duration>' instead`,
            tokenSpan(head), { head: head.text }));
        skipToNextNode(cursor);
        return;
    }

    diagnostics.push(error('flow.unknown-head', `Unknown clause '${head.text}' — ${HEAD_HINT}`, tokenSpan(head), { head: head.text }));
    skipToNextNode(cursor);
}

// ---------------------------------------------------------------------------
// every
// ---------------------------------------------------------------------------

function parseEvery(cursor: TokenCursor, program: FlowProgram, diagnostics: Diagnostic[]): void {
    const head = cursor.next(); // 'every'
    const arg = cursor.peek();

    // every mon / every tue,fri
    if (arg.kind === 'ident' && weekdayFromName(arg.text) !== null) {
        const days: Weekday[] = [];
        let end = arg.end;
        for (;;) {
            const dayToken = cursor.peek();
            const day = dayToken.kind === 'ident' ? weekdayFromName(dayToken.text) : null;
            if (day === null) {
                diagnostics.push(error('flow.expected-weekday', `Expected a weekday (mon..sun), got '${dayToken.text}'`, tokenSpan(dayToken), { token: dayToken.text }));
                skipToNextNode(cursor);
                return;
            }
            cursor.next();
            if (!days.includes(day)) days.push(day);
            end = dayToken.end;
            if (!cursor.tryEat('comma')) break;
        }
        assignSchedule(program, { kind: 'every', rule: { type: 'weekdays', days }, span: { start: head.start, end } }, diagnostics);
        return;
    }

    // every 2w / every 1mo — and every 2mo@15 (duration followed by @)
    if (arg.kind === 'duration') {
        cursor.next();
        const { amount, unit } = splitDurationText(arg.text);
        if (unit === 'mo' && cursor.at('at')) {
            const rule = parseMonthDay(cursor, amount, diagnostics);
            if (!rule) return;
            assignSchedule(program, { kind: 'every', rule, span: { start: head.start, end: cursor.peek(-1).end } }, diagnostics);
            return;
        }
        assignSchedule(program, { kind: 'every', rule: { type: 'interval', amount, unit }, span: { start: head.start, end: arg.end } }, diagnostics);
        return;
    }

    // every mo@25 / every mo@last
    if (arg.kind === 'ident' && arg.text === 'mo') {
        cursor.next();
        if (!cursor.at('at')) {
            diagnostics.push(error('flow.expected-monthday', "Expected '@' after 'mo' (e.g. every mo@25, every mo@last)", tokenSpan(cursor.peek())));
            skipToNextNode(cursor);
            return;
        }
        const rule = parseMonthDay(cursor, 1, diagnostics);
        if (!rule) return;
        assignSchedule(program, { kind: 'every', rule, span: { start: head.start, end: arg.end } }, diagnostics);
        return;
    }

    diagnostics.push(error('flow.expected-cadence',
        "Expected a cadence after 'every' (weekday, interval like 2w, or mo@N)", tokenSpan(arg)));
    skipToNextNode(cursor);
}

function parseMonthDay(cursor: TokenCursor, intervalMonths: number, diagnostics: Diagnostic[]): EveryRule | null {
    cursor.next(); // consume '@'
    const dayToken = cursor.peek();
    if (dayToken.kind === 'number') {
        cursor.next();
        const day = parseInt(dayToken.text, 10);
        if (day < 1 || day > 31) {
            diagnostics.push(error('flow.bad-monthday-range', `Day of month must be 1-31, got ${day}`, tokenSpan(dayToken), { day }));
            return null;
        }
        return { type: 'monthday', intervalMonths, day };
    }
    if (dayToken.kind === 'ident' && dayToken.text === 'last') {
        cursor.next();
        return { type: 'monthday', intervalMonths, day: 'last' };
    }
    diagnostics.push(error('flow.bad-monthday', "Expected a day number or 'last' after '@'", tokenSpan(dayToken)));
    skipToNextNode(cursor);
    return null;
}

// ---------------------------------------------------------------------------
// set
// ---------------------------------------------------------------------------

function parseSet(cursor: TokenCursor, program: FlowProgram, diagnostics: Diagnostic[]): void {
    const head = cursor.next(); // 'set'
    if (!cursor.tryEat('lparen')) {
        diagnostics.push(error('flow.expected-lparen', "Expected '(' after 'set'", tokenSpan(cursor.peek()), { fn: 'set' }));
        skipToNextNode(cursor);
        return;
    }

    const assignments: SetAssignment[] = [];
    for (;;) {
        const fieldToken = cursor.peek();
        if (fieldToken.kind !== 'ident' || !(SET_FIELDS as string[]).includes(fieldToken.text)) {
            diagnostics.push(error('flow.bad-set-field',
                `set() fields are ${SET_FIELDS.join('/')}, got '${fieldToken.text}'`, tokenSpan(fieldToken),
                { field: fieldToken.text, fields: SET_FIELDS.join('/') }));
            skipToNextNode(cursor);
            return;
        }
        cursor.next();
        if (!cursor.tryEat('colon')) {
            diagnostics.push(error('flow.expected-set-colon', `Expected ':' after set field '${fieldToken.text}'`, tokenSpan(cursor.peek()), { field: fieldToken.text }));
            skipToNextNode(cursor);
            return;
        }
        const expr = parseExpr(cursor, diagnostics);
        if (!expr) {
            skipToNextNode(cursor);
            return;
        }
        if (assignments.some(a => a.field === fieldToken.text)) {
            diagnostics.push(error('flow.duplicate-set-field', `set() assigns '${fieldToken.text}' twice`, tokenSpan(fieldToken), { field: fieldToken.text }));
        }
        assignments.push({
            field: fieldToken.text as SetField,
            expr,
            span: { start: fieldToken.start, end: expr.span.end },
        });
        if (cursor.tryEat('comma')) continue;
        break;
    }

    const close = cursor.tryEat('rparen');
    if (!close) {
        diagnostics.push(error('flow.expected-rparen', "Expected ')' to close set(...)", tokenSpan(cursor.peek()), { fn: 'set' }));
        skipToNextNode(cursor);
        return;
    }
    assignNode(program, 'set', { assignments, span: { start: head.start, end: close.end } }, diagnostics, tokenSpan(head));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseParenExpr(cursor: TokenCursor, fnName: string, diagnostics: Diagnostic[]) {
    if (!cursor.tryEat('lparen')) {
        diagnostics.push(error('flow.expected-lparen', `Expected '(' after '${fnName}'`, tokenSpan(cursor.peek()), { fn: fnName }));
        return null;
    }
    const expr = parseExpr(cursor, diagnostics);
    if (!expr) return null;
    if (!cursor.tryEat('rparen')) {
        diagnostics.push(error('flow.expected-rparen', `Expected ')' to close ${fnName}(...)`, tokenSpan(cursor.peek()), { fn: fnName }));
        return null;
    }
    return expr;
}

function assignSchedule(program: FlowProgram, node: ScheduleNode, diagnostics: Diagnostic[]): void {
    if (program.schedule) {
        diagnostics.push(error('flow.duplicate-schedule', 'Only one schedule clause (every / + / at) is allowed', node.span));
        return;
    }
    program.schedule = node;
}

function assignNode<K extends 'lifetime' | 'until' | 'nochildren' | 'set' | 'move'>(
    program: FlowProgram,
    key: K,
    node: NonNullable<FlowProgram[K]>,
    diagnostics: Diagnostic[],
    span: Span
): void {
    if (program[key]) {
        diagnostics.push(error('flow.duplicate-node', `Duplicate '${key}' clause`, span, { clause: key }));
        return;
    }
    program[key] = node;
}

/**
 * Error recovery: skip tokens until something that can start a node, so one
 * mistake yields one diagnostic instead of a cascade.
 */
function skipToNextNode(cursor: TokenCursor): void {
    while (!cursor.atEof()) {
        const t = cursor.peek();
        if (t.kind === 'ident' && (
            ['every', 'at', 'until', 'nochildren', 'set', 'move'].includes(t.text) || /^x\d+$/.test(t.text)
        )) return;
        cursor.next();
    }
}
