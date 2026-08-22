import type { Diagnostic } from './Diagnostic';

/**
 * Base for every "this failed, and here is how to translate it" error in the
 * lang/flow stack: a stable `code` (one message shape per code), the English
 * `message` written at the throw site (superclass `Error.message`), and
 * `params` the i18n layer (diagnosticText.ts/runtimeText.ts) interpolates
 * into the translated string. `EvalError`/`FnCallError`/`GenerationError`
 * each add exactly the one field their catch site needs (`span`, nothing,
 * `inner`) on top of this shape rather than repeating it.
 */
export class TranslatableError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly params?: Diagnostic['params'],
    ) {
        super(message);
    }
}
