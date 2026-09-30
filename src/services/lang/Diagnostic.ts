/**
 * Shared diagnostic types for the lang core.
 *
 * Spans are character offsets relative to the parsed source string
 * (for flow commands: the raw text after `==>`), so callers that embed
 * the source in a larger document must translate offsets themselves.
 */
export interface Span {
    start: number;
    end: number;
}

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
    severity: DiagnosticSeverity;
    /**
     * Stable machine-readable code, e.g. 'lex.unterminated-string',
     * 'flow.unknown-head'. Exactly ONE message shape per code — the
     * presentation layer translates via `t('flowDiag.<code>', params)`
     * (see services/lang/flow/diagnosticText.ts).
     */
    code: string;
    /**
     * The English text, written here and nowhere else. Locale files hold
     * translations only; display falls back to this one (see
     * services/lang/flow/diagnosticText.ts).
     */
    message: string;
    span: Span;
    /** Values interpolated into the translated template. */
    params?: Record<string, string | number>;
}

/** A diagnostic anchored to one line, with columns inside that line. */
export interface LocatedDiagnostic extends Diagnostic {
    /** Absolute index of the line the span belongs to. */
    line: number;
    /**
     * Last line the span reaches, when it reaches past its first.
     *
     * A js section is the first source here that is more than one line, so a
     * statement broken across two of them has a span that no single line
     * holds. `span.start` is then a column on `line` and `span.end` a column
     * on `endLine`. Absent means the two are the same, which is every
     * diagnostic that came before the section existed.
     *
     * One diagnostic still means one problem. Cutting it into a mark per line
     * is the decorator's job — doing it here would make the count of
     * diagnostics stop matching the count of things wrong.
     */
    endLine?: number;
}

export function error(code: string, message: string, span: Span, params?: Diagnostic['params']): Diagnostic {
    return { severity: 'error', code, message, span, params };
}

export function warning(code: string, message: string, span: Span, params?: Diagnostic['params']): Diagnostic {
    return { severity: 'warning', code, message, span, params };
}
