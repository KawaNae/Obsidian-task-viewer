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
     * 'flow.legacy-syntax'. Exactly ONE message shape per code — the
     * presentation layer translates via `t('flowDiag.<code>', params)`
     * (see services/flow/diagnosticText.ts).
     */
    code: string;
    /** English default text (logs / tests / i18n fallback). */
    message: string;
    span: Span;
    /** Values interpolated into the translated template. */
    params?: Record<string, string | number>;
}

export function error(code: string, message: string, span: Span, params?: Diagnostic['params']): Diagnostic {
    return { severity: 'error', code, message, span, params };
}

export function warning(code: string, message: string, span: Span, params?: Diagnostic['params']): Diagnostic {
    return { severity: 'warning', code, message, span, params };
}
