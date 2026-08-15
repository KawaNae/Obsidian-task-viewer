import { type Diagnostic, error } from './Diagnostic';
import type { Token, TokenKind } from './Token';
import { DURATION_UNITS, type DurUnit } from './Value';

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
 */
export function tokenize(src: string): LexResult {
    const tokens: Token[] = [];
    const diagnostics: Diagnostic[] = [];
    let i = 0;

    const push = (kind: TokenKind, text: string, start: number, end: number) => {
        tokens.push({ kind, text, start, end });
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
                diagnostics.push(error('lex.unterminated-wikilink',
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
                diagnostics.push(error('lex.wikilink-looks-like-list',
                    'This reads as a wikilink, not a list of lists — separate the brackets: [ [1], [2] ]',
                    { start: i, end: close + 2 }, { target }));
            }
            push('wikilink', target, i, close + 2);
            i = close + 2;
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
                diagnostics.push(error('lex.unterminated-string', 'Unterminated string', { start, end: src.length }));
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
            const afterNum = rest.slice(num.length);
            // A decimal splits into number, dot, number under this lexer, which
            // then fails as a member access on a number. Say what is actually
            // wrong instead, and point at the way to write it today.
            if (/^\.\d/.test(afterNum)) {
                const full = num + afterNum.match(/^\.\d+/)![0];
                diagnostics.push(error('lex.decimal-unsupported',
                    `Decimal numbers are not supported yet ('${full}') — say it in a smaller unit`,
                    { start: i, end: i + full.length }, { text: full }));
                push('number', num, i, i + num.length);
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
                    diagnostics.push(error('lex.unknown-unit',
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
            three === '!==' ? 'neq' : undefined;
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

        diagnostics.push(error('lex.unexpected-char', `Unexpected character '${ch}'`, { start: i, end: i + 1 }, { char: ch }));
        i++;
    }

    push('eof', '', src.length, src.length);
    return { tokens, diagnostics };
}

/** Parse the text of a 'duration' token into its parts. */
export function splitDurationText(text: string): { amount: number; unit: DurUnit } {
    const m = text.match(/^(\d+)([A-Za-z]+)$/)!;
    return { amount: parseInt(m[1], 10), unit: m[2] as DurUnit };
}
