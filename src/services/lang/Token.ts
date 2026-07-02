import { Span } from './Diagnostic';

export type TokenKind =
    | 'ident'      // every, mon, x14, format, ...
    | 'number'     // 42
    | 'date'       // 2026-07-15
    | 'datetime'   // 2026-07-15T14:00
    | 'time'       // 14:00
    | 'duration'   // 3d, 30min, 2mo
    | 'string'     // "text" (escapes resolved)
    | 'wikilink'   // [[target]] (brackets stripped)
    | 'lparen'
    | 'rparen'
    | 'comma'
    | 'colon'
    | 'at'         // @ (used by mo@25)
    | 'dot'        // . (used by file.name)
    | 'plus'
    | 'minus'
    | 'bang'
    | 'question'
    | 'ampamp'
    | 'pipepipe'
    | 'eq'         // ==
    | 'neq'        // !=
    | 'lt'
    | 'lte'
    | 'gt'
    | 'gte'
    | 'eof';

export interface Token {
    kind: TokenKind;
    /** Raw source text of the token. For string/wikilink this is the decoded value. */
    text: string;
    start: number;
    end: number;
}

export function tokenSpan(token: Token): Span {
    return { start: token.start, end: token.end };
}

/**
 * Sequential reader over a token array. The final token is always 'eof',
 * so peek() past the end keeps returning it.
 */
export class TokenCursor {
    private pos = 0;

    constructor(private readonly tokens: Token[]) { }

    peek(offset = 0): Token {
        const i = Math.min(this.pos + offset, this.tokens.length - 1);
        return this.tokens[i];
    }

    next(): Token {
        const t = this.peek();
        if (this.pos < this.tokens.length - 1) this.pos++;
        return t;
    }

    at(kind: TokenKind): boolean {
        return this.peek().kind === kind;
    }

    atIdent(text: string): boolean {
        const t = this.peek();
        return t.kind === 'ident' && t.text === text;
    }

    atEof(): boolean {
        return this.at('eof');
    }

    /** Consume the next token if it matches, otherwise return null. */
    tryEat(kind: TokenKind): Token | null {
        return this.at(kind) ? this.next() : null;
    }
}
