import { t } from '../../i18n';
import type { Diagnostic } from '../lang/Diagnostic';

/**
 * Localize a lang/flow diagnostic for display.
 *
 * The lang core stays i18n-free by design: it emits a stable `code` (one
 * message shape per code) + `params`, plus the English `message`. This helper
 * resolves `flowDiag.<code>` in the active locale and falls back to that
 * message when no translation exists.
 *
 * The fallback is where English lives, not a stopgap for when it is missing:
 * `en.json` carries no `flowDiag` entries at all. It used to carry a copy of
 * every one of them, and the two copies had drifted in twelve places before
 * anyone compared them, because nothing did. Writing the sentence beside the
 * condition also lets each site say the precise thing — a missing property and
 * a missing method read differently there, where one template for one code has
 * to generalize to "member".
 *
 * So a locale file adds a translation; it is not what makes the text appear.
 * A new diagnostic shows English until `ja.json` catches up.
 */
export function diagnosticText(d: Diagnostic): string {
    const key = `flowDiag.${d.code}`;
    const translated = t(key, d.params);
    return translated === key ? d.message : translated;
}
