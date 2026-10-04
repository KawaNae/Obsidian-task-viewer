import { CSS_COLORS, normalizeColor } from '../ColorUtils';
import { typed } from './Normalize';
import { readFail, readOk, type FieldCodec, type Read } from './Read';

const HEX = /^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const NAMES = new Set(CSS_COLORS);

/**
 * A task's color, as the notation holds it: a hex color of 3 or 6 digits
 * without its `#` (`ff8800`, `f80`), or a CSS color name, in lower case
 * (`red`). A leading `#` is taken off (`normalizeColor`, the one the
 * reading of a note applies), and a name is matched in any case.
 */
export const ColorInput: FieldCodec<string> = {
    read(text: string): Read<string> {
        const t = normalizeColor(typed(text));
        if (t === '') return readFail({ code: 'empty' });
        if (HEX.test(t)) return readOk(t);
        const name = t.toLowerCase();
        return NAMES.has(name) ? readOk(name) : readFail({ code: 'shape', kind: 'color' });
    },
    show: (color) => color,
};
