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
