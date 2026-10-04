import type { TaskViewerSettings } from '../types';
import { filterColors, renderColorSuggestion } from './color/colorUtils';
import { filterLineStyles, renderLineStyleSuggestion } from './line/lineStyleUtils';

/**
 * A scope key whose value is one of a set the plugin knows (a color, a line
 * style), and how its values are offered: what the frontmatter suggests
 * (`FrontmatterValueSuggest` in the editor, `PropertyValueSuggest` in the
 * Properties view) and the hub's fields offer. One kind is the three things
 * that differ between them: the key, the candidates, the drawing.
 */
export interface ScopeValueKind {
    /** The key, as the settings name it now. */
    key(settings: TaskViewerSettings): string;
    /** The values offered for what is typed. */
    candidates(query: string): string[];
    /** Draw a value's item: its preview and its name. */
    render(value: string, el: HTMLElement): void;
}

/** The values offered when nothing is typed, at most. */
const FIRST = 20;

export const COLOR_VALUES: ScopeValueKind = {
    key: (settings) => settings.scopeKeys.color,
    candidates: (query) => (query.trim() === '' ? filterColors('', FIRST) : filterColors(query)),
    render: renderColorSuggestion,
};

export const LINE_STYLE_VALUES: ScopeValueKind = {
    key: (settings) => settings.scopeKeys.linestyle,
    candidates: (query) => filterLineStyles(query),
    render: renderLineStyleSuggestion,
};
