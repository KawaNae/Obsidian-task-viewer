/**
 * Shared CSS color constants and utilities for color suggestions
 */

import { sortByMatchRank } from '../matchRank';

// Standard CSS color names
export const CSS_COLORS = [
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
 * Filter colors by query string. Matches are ranked exact > prefix >
 * substring (see matchRank), so typing `blu` surfaces `blue` before
 * `aliceblue`. An empty query ties every candidate at the same rank, so
 * the declared order passes through unchanged.
 */
export function filterColors(query: string, limit?: number): string[] {
    const lowerQuery = query.toLowerCase().trim();
    const filtered = CSS_COLORS.filter(color => color.toLowerCase().includes(lowerQuery));
    const sorted = sortByMatchRank(filtered, lowerQuery);
    return limit ? sorted.slice(0, limit) : sorted;
}

/**
 * Render a color suggestion with swatch
 */
export function renderColorSuggestion(value: string, el: HTMLElement): void {
    el.addClass('task-viewer-color-suggestion');

    const swatch = el.createDiv({ cls: 'color-swatch' });
    swatch.style.backgroundColor = value;
    swatch.style.width = '1em';
    swatch.style.height = '1em';
    swatch.style.display = 'inline-block';
    swatch.style.marginRight = '0.5em';
    swatch.style.border = '1px solid var(--background-modifier-border)';
    swatch.style.borderRadius = '2px';
    swatch.style.verticalAlign = 'middle';

    el.createSpan({ text: value });
}
