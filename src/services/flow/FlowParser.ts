import { type Diagnostic, type Span, error, warning } from '../lang/Diagnostic';
import type { Expr } from '../lang/ExprAst';
import { isReservedName } from '../lang/ExprChecker';
import { nestingOverflow, parseExpr } from '../lang/ExprParser';
import { splitDurationText, tokenize } from '../lang/Lexer';
import { type Token, TokenCursor, tokenSpan } from '../lang/Token';
import { type Value, type Weekday, weekdayFromName } from '../lang/Value';
import { lookupWord } from '../lang/WordTable';
import { type EveryRule, type FlowCell, type FlowProgram, SET_FIELD_ORDER, type SetField, type ScheduleNode, setHeadName } from './FlowAst';
import { checkFlow } from './FlowChecker';

export interface ParseFlowResult {
    /** Non-null iff there are no error diagnostics (warnings allowed). */
    program: FlowProgram | null;
    diagnostics: Diagnostic[];
}

// `nochildren` is missing on purpose: it is still read, but a hint is a
// list of what to write, and a retired clause does not belong on one.
const HEAD_HINT = 'clauses start with every / + / at(...) / xN / until(...) / let(...) / use(...) / setContent|setStart|setStartTime|setEnd|setEndTime|setDue|setDueTime(...) / move(...)';
const SET_HEADS: Record<string, SetField> = Object.fromEntries(
    SET_FIELD_ORDER.map(field => [setHeadName(field), field])
);

/**
 * Parse the raw text after `==>` into a FlowProgram.
 *
 * Grammar: flow := node+ — whitespace-separated, order-free, at most one
 * node per kind. Every node is self-identified by its head token, so a
 * misordering like `tue every` fails loudly instead of being misread.
 */
export function parseFlow(raw: string): ParseFlowResult {
    try {
        const { program, diagnostics, hasError } = readFlow(raw);
        return { program: hasError ? null : program, diagnostics };
    } catch (e) {
        return { program: null, diagnostics: [nestingOverflow(e, { start: 0, end: raw.length })] };
    }
}

/**
 * The cells a command declares, whatever else is wrong with it.
 *
 * The editor checks a generation block without knowing which command uses it,
 * so it needs the cell names of the file to tell a cell from a typo. It reads
 * every line on its own, and a line that carries only part of a multi-line
 * command does not parse into a program — the declarations are still there and
 * still true, which is all this answers.
 */
export function parseFlowCells(raw: string): FlowCell[] {
    try {
        return readFlow(raw).program.cells?.entries ?? [];
    } catch {
        return [];
    }
}

function readFlow(raw: string): { program: FlowProgram; diagnostics: Diagnostic[]; hasError: boolean } {
    const { tokens, diagnostics, comments } = tokenize(raw);
    const cursor = new TokenCursor(tokens);
    const program: FlowProgram = {};

    // A comment is fine inside a generation block, whose source is kept as
    // written. Here it is not: every fire reprints the command from its AST,
    // and the AST has nowhere to hold a comment — so it would be dropped the
    // first time the task moves on. Refusing is the only form of this that
    // does not lose what someone wrote.
    for (const span of comments) {
        diagnostics.push(error('flow.comment-not-here',
            'A // comment cannot be written in a command — the command is rewritten on every fire, and the comment would be dropped',
            span));
    }

    while (!cursor.atEof()) {
        parseNode(cursor, program, diagnostics);
    }

    checkFlow(program, diagnostics);

    return { program, diagnostics, hasError: diagnostics.some(d => d.severity === 'error') };
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
            const expr = parseParenExpr(cursor, 'until', diagnostics);
            if (expr) {
                assignNode(program, 'until', { expr, span: { start: head.start, end: expr.span.end + 1 } }, diagnostics, tokenSpan(head));
            } else {
                skipToNextNode(cursor);
            }
            return;
        }
        case 'nochildren':
            // Read and dropped. Refusing the token would null the program and
            // take the rest of the command down with it, so it stays in the
            // grammar; keeping it on the AST would put it back on the line
            // every time a fire regenerates the clause. Between those, the
            // value goes and the notice stays.
            cursor.next();
            diagnostics.push(warning('flow.nochildren-retired',
                "'nochildren' is retired: child lines no longer travel to the next instance, so the clause can be deleted",
                tokenSpan(head)));
            return;
        case 'let':
            cursor.next();
            parseCells(cursor, head, program, diagnostics);
            return;
        case 'use': {
            cursor.next();
            const name = parseParenExpr(cursor, 'use', diagnostics);
            if (name) {
                assignNode(program, 'use', { name, span: { start: head.start, end: name.span.end + 1 } }, diagnostics, tokenSpan(head));
            } else {
                skipToNextNode(cursor);
            }
            return;
        }
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

    // setContent(...) / setStart(...) / setEnd(...) / setDue(...)
    const setField = lookupWord(SET_HEADS, head.text);
    if (setField !== undefined) {
        cursor.next();
        const expr = parseParenExpr(cursor, head.text, diagnostics);
        if (!expr) {
            skipToNextNode(cursor);
            return;
        }
        if (program.sets?.[setField]) {
            diagnostics.push(error('flow.duplicate-node', `Duplicate '${head.text}' clause`, tokenSpan(head), { clause: head.text }));
            return;
        }
        program.sets = {
            ...program.sets,
            [setField]: { expr, span: { start: head.start, end: expr.span.end + 1 } },
        };
        return;
    }

    cursor.next();
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
// let
// ---------------------------------------------------------------------------

/** The one sentence every malformed `let(...)` gets, since it is the whole grammar. */
const CELL_SHAPE = 'let(...) declares cells as name: value — e.g. let(n: 3)';

/**
 * `let(n: 3, done: false)` — the cells carried between generations.
 *
 * One clause holds every cell rather than one clause each. A second `let` is a
 * duplicate like any other node, which keeps "at most one node of a kind" true
 * for the whole grammar and leaves the canonical print with one place to put
 * them.
 *
 * Values are literals and not expressions. What the clause holds is printed
 * back on every fire, so an expression would be evaluated once and then
 * replaced by its result — the line would stop saying what its author wrote
 * after the first firing. A literal reads back as itself, generation after
 * generation.
 */
function parseCells(cursor: TokenCursor, head: Token, program: FlowProgram, diagnostics: Diagnostic[]): void {
    if (!cursor.tryEat('lparen')) {
        diagnostics.push(error('flow.expected-lparen', "Expected '(' after 'let'", tokenSpan(cursor.peek()), { fn: 'let' }));
        return;
    }

    const entries: FlowCell[] = [];
    for (;;) {
        const nameToken = cursor.peek();
        if (nameToken.kind !== 'ident') {
            diagnostics.push(error('flow.expected-cell', CELL_SHAPE, tokenSpan(nameToken)));
            skipToNextNode(cursor);
            return;
        }
        cursor.next();
        if (!cursor.tryEat('colon')) {
            diagnostics.push(error('flow.expected-cell', CELL_SHAPE, tokenSpan(cursor.peek())));
            skipToNextNode(cursor);
            return;
        }
        const expr = parseExpr(cursor, diagnostics, 'flow');
        if (!expr) {
            skipToNextNode(cursor);
            return;
        }
        readCell(nameToken, expr, entries, diagnostics);

        if (!cursor.tryEat('comma')) break;
        // A trailing comma is written wherever a list is, and refusing it here
        // alone would make the flow line the one place it is not allowed.
        if (cursor.at('rparen')) break;
    }

    if (!cursor.tryEat('rparen')) {
        diagnostics.push(error('flow.expected-rparen', "Expected ')' to close let(...)", tokenSpan(cursor.peek()), { fn: 'let' }));
        return;
    }
    if (program.cells) {
        diagnostics.push(error('flow.duplicate-node', "Duplicate 'let' clause", tokenSpan(head), { clause: 'let' }));
        return;
    }
    program.cells = { entries, span: { start: head.start, end: cursor.peek(-1).end } };
}

/** One `name: value` pair, once both halves have been read. */
function readCell(nameToken: Token, expr: Expr, entries: FlowCell[], diagnostics: Diagnostic[]): void {
    const name = nameToken.text;
    // A name the expression language resolves for itself cannot be read as a
    // cell, so the cell would be write-only — said here rather than left to
    // surface as an unrelated complaint inside the block.
    if (isReservedName(name) || weekdayFromName(name) !== null) {
        diagnostics.push(error('flow.cell-reserved-name',
            `'${name}' already means something in an expression, so a cell cannot be named it`,
            tokenSpan(nameToken), { name }));
        return;
    }
    if (entries.some(c => c.name === name)) {
        diagnostics.push(error('flow.duplicate-cell', `Cell '${name}' is declared twice`, tokenSpan(nameToken), { name }));
        return;
    }
    const value = literalValue(expr);
    if (value === null) {
        diagnostics.push(error('flow.cell-not-literal',
            `Cell '${name}' starts from a written value — a computed one would be replaced by its result on the first fire`,
            expr.span, { name }));
        return;
    }
    entries.push({ name, value, nameSpan: tokenSpan(nameToken), valueSpan: expr.span });
}

/** The value an expression already is, or null when it has to be computed. */
function literalValue(expr: Expr): Value | null {
    if (expr.kind === 'lit') return expr.value;
    // A counter that runs down writes a negative number back, and `-1` is a
    // node rather than a literal — so the print would not read back.
    if (expr.kind === 'unary' && expr.op === '-' && expr.operand.kind === 'lit') {
        const inner = expr.operand.value;
        if (inner.type === 'number') return { type: 'number', value: -inner.value };
        if (inner.type === 'duration') return { type: 'duration', amount: -inner.amount, unit: inner.unit };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseParenExpr(cursor: TokenCursor, fnName: string, diagnostics: Diagnostic[]) {
    if (!cursor.tryEat('lparen')) {
        diagnostics.push(error('flow.expected-lparen', `Expected '(' after '${fnName}'`, tokenSpan(cursor.peek()), { fn: fnName }));
        return null;
    }
    const expr = parseExpr(cursor, diagnostics, 'flow');
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

function assignNode<K extends 'lifetime' | 'until' | 'use' | 'move'>(
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
 *
 * `nochildren` belongs on this list even though it is retired. Recovery has
 * to recognize every head the parser accepts, and it is still accepted; drop
 * it and a command written after one would be skipped along with the mistake.
 */
function skipToNextNode(cursor: TokenCursor): void {
    while (!cursor.atEof()) {
        const t = cursor.peek();
        if (t.kind === 'ident' && (
            ['every', 'at', 'until', 'nochildren', 'let', 'use', 'move'].includes(t.text)
            || lookupWord(SET_HEADS, t.text) !== undefined
            || /^x\d+$/.test(t.text)
        )) return;
        cursor.next();
    }
}
