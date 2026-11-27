import { t } from '../../../i18n';
import type { FieldLook } from './FieldState';

/**
 * A field's look (`FieldStates.look`) put on its box and its input: the
 * dashed frame of what the field is given (`tv-form__control--inherited` on
 * the box), and its faint text.
 *
 * A value hidden is not the input's placeholder: it is drawn over the field
 * as text of its own (`tv-form__struck`), whose line `_form.css` draws, so
 * that where the line stands, how far past the text it reaches, its color
 * and its thickness are set in one rule there. It stands where the input's
 * text does, in the box's font and padding. The value is the input's
 * placeholder too, drawn clear: the text drawn over goes while the
 * placeholder does not show (`:placeholder-shown`), so it goes once the
 * field holds any text, whichever way it was put in (typed, picked from a
 * list, a picker's drag).
 */
export class FieldLookView {
    private struck: { outer: HTMLElement; text: HTMLElement } | null = null;

    /** @param box the element the field's frame is drawn in: the input's box (`tv-form__control`) */
    constructor(private readonly box: HTMLElement, private readonly input: HTMLInputElement) {}

    /**
     * Put `look` on the field. `fallback` is the kind's own faint text (a
     * date the rules fill in, a format), shown where the look leaves it to
     * the kind, and for a value that spells as nothing in the field (an
     * inherited due with no time, in the due's time field).
     */
    show(look: FieldLook, fallback = ''): void {
        this.box.toggleClass('tv-form__control--inherited', look.frame === 'inherited');
        const { faint } = look;
        this.input.placeholder = faint === null ? fallback
            : faint.kind === 'value' ? faint.text || fallback
                : faint.kind === 'noValue' ? t('modal.hub.noValue')
                    : faint.text;
        if (faint?.kind === 'struck') {
            const struck = this.struck ?? this.drawStruck();
            struck.text.setText(faint.text);
        } else {
            this.struck?.outer.detach();
            this.struck = null;
        }
        this.box.toggleClass('tv-form__has-struck', this.struck !== null);
    }

    /** The text drawn over the field, put after the input: `_form.css` shows it while the input's placeholder shows. */
    private drawStruck(): { outer: HTMLElement; text: HTMLElement } {
        const outer = this.box.createSpan({ cls: 'tv-form__struck', attr: { 'aria-hidden': 'true' } });
        this.struck = { outer, text: outer.createSpan({ cls: 'tv-form__struck-text' }) };
        return this.struck;
    }
}
