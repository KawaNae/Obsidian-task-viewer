import { CSS_COLORS, ColorCheck, normalizeColor } from '../ColorUtils';
import { typed } from './Normalize';
import { readFail, readOk, type FieldCodec, type Read } from './Read';

const NAMES = new Set(CSS_COLORS);

/**
 * A task's color, as the notation holds it: a text a line's `tv-color`
 * reads as a color (`ColorCheck`). A hex color of 3 or 6 digits is held
 * without its `#` (`ff8800`, `f80`), a CSS color name in lower case
 * (`red`), and any other color as typed (`rgb(0 0 0)`). A leading `#` is
 * taken off (`normalizeColor`, the one the reading of a note applies), and
 * a name is matched in any case.
 */
export const ColorInput: FieldCodec<string> = {
    read(text: string): Read<string> {
        const t = normalizeColor(typed(text));
        if (t === '') return readFail({ code: 'empty' });
        const name = t.toLowerCase();
        if (NAMES.has(name)) return readOk(name);
        return ColorCheck.isColor(t) ? readOk(t) : readFail({ code: 'shape', kind: 'color' });
    },
    show: (color) => color,
};
