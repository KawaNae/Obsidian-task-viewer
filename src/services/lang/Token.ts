import type { Span } from './Diagnostic';

export type TokenKind =
    | 'ident'      // every, mon, x14, format, ...
    | 'number'     // 42
    | 'date'       // 2026-07-15
    | 'datetime'   // 2026-07-15T14:00
    | 'time'       // 14:00
    | 'duration'   // 3d, 30min, 2mo
    | 'string'     // "text" (escapes resolved)
    | 'wikilink'   // [[target]] (brackets stripped)
    | 'template'   // `text ${expr}` (backticks stripped, interpolations raw)
    | 'lparen'
    | 'rparen'
    | 'lbracket'   // [ (a wikilink's [[ is matched first)
    | 'rbracket'
    | 'lbrace'     // {
    | 'rbrace'
    | 'ellipsis'   // ... (spread)
    | 'arrow'      // =>
    | 'comma'
    | 'colon'
    | 'at'         // @ (used by mo@25)
    | 'dot'        // . (used by file.name)
    | 'qdot'       // ?. optional chaining
    | 'plus'
    | 'minus'
    | 'star'
    | 'slash'
    | 'percent'
    | 'bang'
    | 'question'
    | 'ampamp'
    | 'pipepipe'
    | 'qq'         // ?? (nullish coalescing)
    | 'eq'         // ==
    | 'neq'        // !=
    | 'lt'
    | 'lte'
    | 'gt'
    | 'gte'
    | 'assign'     // =
    | 'pluseq'     // +=
    | 'minuseq'    // -=
    | 'plusplus'   // ++ (always refused, but lexed so the diagnostic can name it)
    | 'minusminus' // --
    | 'semicolon'  // ;
    | 'newline'    // statement boundary; only emitted where no ( or [ is open
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
 *
 * Newlines: an expression read on its own — a flow clause, a `${...}` — sits
 * inside something that already decided where it ends, so line breaks mean
 * nothing and the default drops them up front. The statement parser is the
 * one reader that keeps them: there a newline is what ends a statement.
 */
export class TokenCursor {
    private pos = 0;
    private readonly tokens: Token[];

    constructor(tokens: Token[], newlines: 'skip' | 'keep' = 'skip') {
        this.tokens = newlines === 'skip' ? tokens.filter(t => t.kind !== 'newline') : tokens;
    }

    peek(offset = 0): Token {
        const i = Math.max(0, Math.min(this.pos + offset, this.tokens.length - 1));
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

    /**
     * Consume a run of newlines. For the places where a line break is
     * allowed but says nothing: between statements, and inside a record
     * literal, whose braces the lexer cannot tell from a block's.
     */
    skipNewlines(): void {
        while (this.at('newline')) this.next();
    }
}
