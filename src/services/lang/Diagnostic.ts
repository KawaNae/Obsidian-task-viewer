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
    /** Stable machine-readable code, e.g. 'lex.unterminated-string', 'flow.legacy-syntax' */
    code: string;
    message: string;
    span: Span;
}

export function error(code: string, message: string, span: Span): Diagnostic {
    return { severity: 'error', code, message, span };
}

export function warning(code: string, message: string, span: Span): Diagnostic {
    return { severity: 'warning', code, message, span };
}
