import { t } from '../../i18n';
import { Diagnostic } from '../lang/Diagnostic';

/**
 * Localize a lang/flow diagnostic for display.
 *
 * The lang core stays i18n-free by design: it emits a stable `code` (one
 * message shape per code) + `params`, plus an English default `message`.
 * This helper resolves `flowDiag.<code>` in the active locale and falls
 * back to the English default when no translation exists — so adding a
 * new diagnostic never breaks display, it just shows English until the
 * locale entry is added.
 */
export function diagnosticText(d: Diagnostic): string {
    const key = `flowDiag.${d.code}`;
    const translated = t(key, d.params);
    return translated === key ? d.message : translated;
}
