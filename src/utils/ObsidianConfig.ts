import type { App } from 'obsidian';

/**
 * Obsidian's own settings that the plugin writes by, read here and nowhere
 * else.
 *
 * `Vault.getConfig` is not in Obsidian's typings: it is the app's reading of
 * `.obsidian/app.json`, which answers a setting's default when the file does
 * not hold it (`archive/2026-09-stages/3-v058-2026-09-28.md`, sm0-measure: `useTab` true and
 * `tabSize` 4 on a vault whose file names neither). Being unpublished, it may
 * go or change its answers, so every reading of it is here, each with the
 * answer it falls back to — Obsidian's own default.
 */

interface ConfigReading {
    getConfig?: (key: string) => unknown;
}

/** The value of `key`, or undefined when there is no `getConfig` to ask, or it threw. */
function configOf(app: App, key: string): unknown {
    const vault = app.vault as unknown as ConfigReading;
    if (typeof vault.getConfig !== 'function') return undefined;
    try {
        return vault.getConfig(key);
    } catch {
        return undefined;
    }
}

/**
 * The indentation one new level of a list takes, as Obsidian's editor writes
 * it (settings `useTab`, `tabSize`): a tab, or `tabSize` spaces. It is what a
 * line nested one level deeper than any line there is gets — the first child
 * of a row that has none, a Tab in the source editor. A line written beside
 * one of the same depth takes that line's indentation instead
 * (`Placement.resolveChildIndent`).
 *
 * A tab when `useTab` is not a boolean, or `getConfig` answers nothing.
 * `tabSize` that is not a whole number is 4; one past 4 is 4, since a unit
 * wider than four columns puts a child under `- ` in indented code, no child
 * at all (`Outline.childIndent`), and one under 1 is 1.
 */
export function indentUnit(app: App): string {
    const useTab = configOf(app, 'useTab');
    if (typeof useTab !== 'boolean' || useTab) return '\t';
    const size = configOf(app, 'tabSize');
    const width = typeof size === 'number' && Number.isInteger(size) ? Math.min(Math.max(size, 1), 4) : 4;
    return ' '.repeat(width);
}
