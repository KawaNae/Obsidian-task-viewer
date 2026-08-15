import { type Diagnostic, error } from './Diagnostic';
import type { Token, TokenKind } from './Token';
import { DECIMAL_PLACES, DURATION_UNITS, type DurUnit, MAX_EXACT_FRACTION } from './Value';

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const TIME_RE = /^\d{1,2}:\d{2}/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

export interface LexResult {
    tokens: Token[];
    diagnostics: Diagnostic[];
}

/**
 * Shared lexer for the flow-command surface and the expression language.
 * Whitespace separates tokens and is otherwise insignificant.
 *
 * `base` is where `src` sits inside whatever the reader is looking at. An
 * expression lifted out of a `${...}` is lexed on its own, and without this
 * every span it produces — the tokens, and every AST node built from them —
 * would measure from the start of the fragment and point at the wrong place
 * in the line. Carrying it here fixes all of them at once, rather than
 * remapping diagnostics afterwards and leaving the AST wrong.
 */
export function tokenize(src: string, base = 0): LexResult {
    const tokens: Token[] = [];
    const rawDiagnostics: Diagnostic[] = [];
    let i = 0;

    const push = (kind: TokenKind, text: string, start: number, end: number) => {
        tokens.push({ kind, text, start: start + base, end: end + base });
    };

    while (i < src.length) {
        const ch = src[i];

        if (/\s/.test(ch)) {
            i++;
            continue;
        }

        // Wikilink [[target]] — matched before '[', so a list of lists needs a
        // space between the brackets ([ [1], [2] ]). One of the four domain
        // literals that read as something else in JS.
        if (src.startsWith('[[', i)) {
            const close = src.indexOf(']]', i + 2);
            if (close === -1) {
                rawDiagnostics.push(error('lex.unterminated-wikilink',
                    'Unterminated wikilink — a list inside a list is written with a space: [ [1], [2] ]',
                    { start: i, end: src.length }));
                i = src.length;
                continue;
            }
            const target = src.slice(i + 2, close);
            // Obsidian forbids brackets in a note name, so a target carrying
            // one is a list of lists that lost the longest match. Say so here,
            // where it is still visible, rather than at evaluation.
            if (/[[\]]/.test(target)) {
                rawDiagnostics.push(error('lex.wikilink-looks-like-list',
                    'This reads as a wikilink, not a list of lists — separate the brackets: [ [1], [2] ]',
                    { start: i, end: close + 2 }, { target }));
            }
            push('wikilink', target, i, close + 2);
            i = close + 2;
            continue;
        }

        // Template literal `text ${expr}`. Taken whole: the interpolations
        // inside are read by the parser, which is what can read an expression.
        // Scanning past them here is what keeps a backtick inside one from
        // ending the template early.
        if (ch === '`') {
            let j = i + 1;
            let closed = false;
            while (j < src.length) {
                // A backslash escapes one thing and only one: the start of an
                // interpolation. Letting it escape anything would give the
                // same character two meanings between here and the splitter
                // that reads this body — and would eat the closing backtick
                // of a path ending in a separator.
                if (src[j] === '\\' && src[j + 1] === '$' && src[j + 2] === '{') { j += 3; continue; }
                if (src[j] === '$' && src[j + 1] === '{') {
                    const end = findInterpolationEnd(src, j);
                    if (end === -1) break;
                    j = end + 1;
                    continue;
                }
                if (src[j] === '`') { closed = true; break; }
                j++;
            }
            if (!closed) {
                rawDiagnostics.push(error('lex.unterminated-template', 'Unterminated template literal',
                    { start: i, end: src.length }));
                i = src.length;
                continue;
            }
            push('template', src.slice(i + 1, j), i, j + 1);
            i = j + 1;
            continue;
        }

        // String "..." with backslash escapes
        if (ch === '"' || ch === "'") {
            const quote = ch;
            const start = i;
            i++;
            let value = '';
            let closed = false;
            while (i < src.length) {
                const c = src[i];
                if (c === '\\' && i + 1 < src.length) {
                    const esc = src[i + 1];
                    value += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
                    i += 2;
                    continue;
                }
                if (c === quote) {
                    closed = true;
                    i++;
                    break;
                }
                value += c;
                i++;
            }
            if (!closed) {
                rawDiagnostics.push(error('lex.unterminated-string', 'Unterminated string', { start, end: src.length }));
            }
            push('string', value, start, i);
            continue;
        }

        // Numeric-led tokens: datetime > date > time > duration > number
        if (/\d/.test(ch)) {
            const rest = src.slice(i);
            const dt = rest.match(DATETIME_RE);
            if (dt) {
                push('datetime', dt[0], i, i + dt[0].length);
                i += dt[0].length;
                continue;
            }
            const d = rest.match(DATE_RE);
            if (d) {
                push('date', d[0], i, i + d[0].length);
                i += d[0].length;
                continue;
            }
            const t = rest.match(TIME_RE);
            if (t) {
                push('time', t[0], i, i + t[0].length);
                i += t[0].length;
                continue;
            }
            const num = rest.match(/^\d+/)![0];
            let afterNum = rest.slice(num.length);
            const fraction = afterNum.match(/^\.\d+/)?.[0];
            if (fraction !== undefined) {
                const places = fraction.length - 1;
                const full = num + fraction;
                const unit = afterNum.slice(fraction.length).match(/^[A-Za-z]+/)?.[0];
                // A duration is a whole number and a unit — there is no way to
                // write 0.5d back, so it is refused where it is written rather
                // than a generation later.
                if (unit !== undefined && (DURATION_UNITS as readonly string[]).includes(unit)) {
                    rawDiagnostics.push(error('lex.decimal-duration',
                        `A duration is a whole number ('${full}${unit}') — say it in a smaller unit`,
                        { start: i, end: i + full.length + unit.length }, { text: full + unit }));
                    push('duration', num + unit, i, i + full.length + unit.length);
                    i += full.length + unit.length;
                    continue;
                }
                // Values live on a grid of ten decimal places, the same one
                // division rounds to. Anything finer cannot be held, so it is
                // said here rather than quietly rounded away.
                if (places > DECIMAL_PLACES) {
                    rawDiagnostics.push(error('lex.decimal-too-precise',
                        `A number keeps at most ${DECIMAL_PLACES} decimal places ('${full}')`,
                        { start: i, end: i + full.length }, { text: full, places: DECIMAL_PLACES }));
                }
                // The evaluator's range gate guards operation results only; a
                // literal is the other way onto the grid, so its magnitude is
                // checked where it is written. Past this bound the grid stops
                // being one-to-one on doubles and the value would drift on the
                // print/read round trip. A fraction of zeros still means a
                // whole number, which is exact far beyond this.
                const value = parseFloat(full);
                if (!Number.isInteger(value) && value > MAX_EXACT_FRACTION) {
                    rawDiagnostics.push(error('lex.decimal-too-large',
                        `A number with a fraction holds its precision up to ${MAX_EXACT_FRACTION} ('${full}')`,
                        { start: i, end: i + full.length }, { text: full, max: MAX_EXACT_FRACTION }));
                }
                push('number', full, i, i + full.length);
                i += full.length;
                continue;
            }
            const unitMatch = afterNum.match(/^[A-Za-z]+/);
            if (unitMatch) {
                const unit = unitMatch[0];
                const full = num + unit;
                if ((DURATION_UNITS as readonly string[]).includes(unit)) {
                    push('duration', full, i, i + full.length);
                } else {
                    rawDiagnostics.push(error('lex.unknown-unit',
                        `Unknown duration unit '${unit}' (expected ${DURATION_UNITS.join('/')})`,
                        { start: i, end: i + full.length },
                        { unit, units: DURATION_UNITS.join('/') }));
                    // Emit as duration-shaped ident so downstream reports once.
                    push('ident', full, i, i + full.length);
                }
                i += full.length;
                continue;
            }
            push('number', num, i, i + num.length);
            i += num.length;
            continue;
        }

        // Identifiers / keywords (x14 also lexes as ident; FlowParser splits it)
        const identMatch = src.slice(i).match(IDENT_RE);
        if (identMatch) {
            push('ident', identMatch[0], i, i + identMatch[0].length);
            i += identMatch[0].length;
            continue;
        }

        // Multi-char operators. Longest first: `===` must not split into `==` + `=`.
        const three = src.slice(i, i + 3);
        const threeKind: TokenKind | undefined =
            three === '===' ? 'eq' :
            three === '!==' ? 'neq' :
            three === '...' ? 'ellipsis' : undefined;
        if (threeKind) {
            push(threeKind, three, i, i + 3);
            i += 3;
            continue;
        }

        const two = src.slice(i, i + 2);
        const twoKind: TokenKind | undefined =
            two === '&&' ? 'ampamp' :
            two === '||' ? 'pipepipe' :
            two === '==' ? 'eq' :
            two === '!=' ? 'neq' :
            two === '<=' ? 'lte' :
            two === '>=' ? 'gte' :
            two === '?.' ? 'qdot' :
            two === '??' ? 'qq' :
            two === '=>' ? 'arrow' : undefined;
        if (twoKind) {
            push(twoKind, two, i, i + 2);
            i += 2;
            continue;
        }

        const oneKind: TokenKind | undefined =
            ch === '(' ? 'lparen' :
            ch === ')' ? 'rparen' :
            ch === '[' ? 'lbracket' :
            ch === ']' ? 'rbracket' :
            ch === '{' ? 'lbrace' :
            ch === '}' ? 'rbrace' :
            ch === ',' ? 'comma' :
            ch === ':' ? 'colon' :
            ch === '@' ? 'at' :
            ch === '.' ? 'dot' :
            ch === '+' ? 'plus' :
            ch === '-' ? 'minus' :
            ch === '*' ? 'star' :
            ch === '/' ? 'slash' :
            ch === '%' ? 'percent' :
            ch === '!' ? 'bang' :
            ch === '?' ? 'question' :
            ch === '<' ? 'lt' :
            ch === '>' ? 'gt' : undefined;
        if (oneKind) {
            push(oneKind, ch, i, i + 1);
            i++;
            continue;
        }

        rawDiagnostics.push(error('lex.unexpected-char', `Unexpected character '${ch}'`, { start: i, end: i + 1 }, { char: ch }));
        i++;
    }

    push('eof', '', src.length, src.length);
    const diagnostics = base === 0
        ? rawDiagnostics
        : rawDiagnostics.map(d => ({ ...d, span: { start: d.span.start + base, end: d.span.end + base } }));
    return { tokens, diagnostics };
}

/** Parse the text of a 'duration' token into its parts. */
/**
 * Index of the `}` that closes the `${` starting at `open`, or -1.
 *
 * Not the first brace: an object literal, a function body and a string can
 * each carry one, and `${xs.map(x => { return x })}` has three before the
 * real end. Strings are skipped whole, including the template literals that
 * can nest another interpolation inside them.
 *
 * Shared by the template-literal lexer and the interpolation of a generation
 * block's body — the two places where a `${` has to be closed correctly.
 */
export function findInterpolationEnd(src: string, open: number): number {
    /** Closers still owed, innermost last. Every bracket kind, not just the
     *  braces: keeping one list means a kind added later cannot be forgotten
     *  the way a hand-written brace count would forget it. */
    const owed: string[] = [];
    const CLOSER: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
    let i = open + 2; // past the `${`
    let quote: string | null = null;

    while (i < src.length) {
        const ch = src[i];
        if (quote === '`') {
            // Same one rule as the lexer: inside a template body a backslash
            // means something only in front of an interpolation.
            if (ch === '\\' && src[i + 1] === '$' && src[i + 2] === '{') { i += 3; continue; }
            if (ch === '$' && src[i + 1] === '{') {
                // A template inside this interpolation closes its own
                // interpolations before this one closes.
                const inner = findInterpolationEnd(src, i);
                if (inner === -1) return -1;
                i = inner + 1;
                continue;
            }
            if (ch === '`') { quote = null; }
            i++;
            continue;
        }
        if (quote !== null) {
            // A quoted string is a string literal, where a backslash escapes
            // whatever follows it.
            if (ch === '\\') { i += 2; continue; }
            if (ch === quote) { quote = null; }
            i++;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; i++; continue; }
        if (CLOSER[ch] !== undefined) { owed.push(CLOSER[ch]); i++; continue; }
        if (ch === '}' && owed.length === 0) return i;
        if (ch === owed[owed.length - 1]) { owed.pop(); i++; continue; }
        i++;
    }
    return -1;
}

export function splitDurationText(text: string): { amount: number; unit: DurUnit } {
    const m = text.match(/^(\d+)([A-Za-z]+)$/)!;
    return { amount: parseInt(m[1], 10), unit: m[2] as DurUnit };
}
