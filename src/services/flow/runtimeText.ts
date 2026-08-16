import { t } from '../../i18n';
import { diagnosticText } from './diagnosticText';
import { GenerationError } from './FlowPlanner';
import type { EvalError } from '../lang/ExprEvaluator';

/**
 * Localize a failure that happened while a flow fired, for the notice that
 * tells the user their check did nothing.
 *
 * The same shape as the diagnostics: the English is written where the error is
 * thrown, `flowEval.<code>` holds a translation, and a code with no translation
 * shows the English. Only the display goes through here — the log keeps
 * `err.message`, so a log stays in one language whoever is reading it.
 *
 * A code is looked up in two places, because a fire can fail in two ways. Its
 * own failures are `eval.*`, thrown at run time. But a generation also refuses
 * lines by the rules that the editor already states as diagnostics, and when
 * one of those is what stopped the fire, the error carries that diagnostic's
 * code — already translated, under the diagnostics' own key.
 */
export function runtimeText(err: EvalError | GenerationError): string {
    const params = err instanceof GenerationError && err.inner
        // The message quotes a diagnostic. Quote the reader's language of it,
        // or the notice is half in one language and half in another.
        ? { ...err.params, reason: diagnosticText(err.inner) }
        : err.params;

    for (const key of [`flowEval.${err.code}`, `flowDiag.${err.code}`]) {
        const translated = t(key, params);
        if (translated !== key) return translated;
    }
    return err.message;
}
