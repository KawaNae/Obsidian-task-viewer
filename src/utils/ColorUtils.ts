/** The CSS color names, which a color may be given as besides a hex value. */
export const CSS_COLORS: readonly string[] = [
    "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure",
    "beige", "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown", "burlywood",
    "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan",
    "darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue",
    "firebrick", "floralwhite", "forestgreen", "fuchsia",
    "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey",
    "honeydew", "hotpink",
    "indianred", "indigo", "ivory",
    "khaki",
    "lavender", "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen", "linen",
    "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin",
    "navajowhite", "navy",
    "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid",
    "palegoldenrod", "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple",
    "rebeccapurple", "red", "rosybrown", "royalblue",
    "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen", "steelblue",
    "tan", "teal", "thistle", "tomato", "turquoise",
    "violet",
    "wheat", "white", "whitesmoke",
    "yellow", "yellowgreen"
];

/**
 * Strip leading '#' from color values.
 * Accepts: '#ff0000' → 'ff0000', '#fff' → 'fff', 'red' → 'red'
 */
export function normalizeColor(raw: string): string {
    const trimmed = raw.trim();
    return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
}

const HEX_COLOR = /^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const NAMES = new Set(CSS_COLORS);

/** How a text is told to be a CSS color (`ColorCheck`). */
type CssColorTest = (text: string) => boolean;

/** CSS's own answer; where there is no CSS to ask (a run with no DOM), the color names. */
const askCss: CssColorTest = (text) => {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') return CSS.supports('color', text);
    return NAMES.has(text.toLowerCase());
};

let cssColor: CssColorTest = askCss;

/**
 * Whether a text is a color: the one answer for a `tv-color` value, read on
 * any layer (`readBuiltin`) and typed in the hub (`ColorInput`). A hex value
 * of 3 or 6 digits, with its `#` or without, is one, as the notation holds
 * it (`ff8800`); anything else is one when CSS reads it as a color
 * (`CSS.supports('color', text)`): a color name in any case, `rgb()`,
 * `hsl()`. A misspelt name (`rde`) is none.
 *
 * What CSS answers is asked through a test that can be put in its place
 * ({@link use}), so a run with no DOM tells colors as Obsidian does.
 */
export const ColorCheck = {
    isColor(text: string): boolean {
        const t = normalizeColor(text);
        if (t === '') return false;
        return HEX_COLOR.test(t) || cssColor(t);
    },

    /** Ask `test` in place of CSS, until {@link reset}. */
    use(test: CssColorTest): void {
        cssColor = test;
    },

    reset(): void {
        cssColor = askCss;
    },
};

/**
 * A color as a color picker takes it: 6-digit '#rrggbb'. The value is a
 * color as the notation holds it (a hex value of 3 or 6 digits without its
 * `#`, `f80` standing for `ff8800`, or a CSS color name) or any CSS color
 * expression. '#000000' when it cannot be read, or is empty.
 *
 * The one reading of a color for the pickers (the hub's, the Properties
 * view's). Uses Canvas 2D fillStyle as the parser, so no DOM mutation and
 * no dependency on getComputedStyle / window.
 */
export function cssColorToHex(value: string, doc: Document): string {
    let v = value.trim();
    if (!v) return '#000000';
    if (/^(?:[0-9a-fA-F]{3}){1,2}$/.test(v)) v = '#' + v;
    const ctx = doc.createElement('canvas').getContext('2d');
    if (!ctx) return '#000000';
    ctx.fillStyle = '#000000';
    ctx.fillStyle = v;
    return ctx.fillStyle as string;
}
