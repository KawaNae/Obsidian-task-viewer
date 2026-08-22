import { type App, Notice } from 'obsidian';
import type { TaskViewerSettings } from '../../types';
import type { ViewType } from '../../constants/viewRegistry';
import { t } from '../../i18n';
import { resolveViewTypeFromShortName } from './SchemaRegistry';
import { buildViewStateFromParams } from './ViewStateFactory';
import { openLeafFromState, parseLeafPosition } from './LeafOpener';

const TIMER_VIEW: ViewType = 'timer-view';

/**
 * `obsidian://task-viewer?view=<shortName>&template=<name>&...` — the whole
 * road from a URI to an open view.
 *
 * The per-view differences live in each view's config schema, not here: the
 * work is to name the view, load its template if one was asked for, overlay
 * the query's own overrides, and hand the resulting state dict to
 * {@link openLeafFromState}. A newly persisted field needs no change in this
 * file.
 *
 * An unrecognised view name is silence, not an error. A URI is something a
 * user typed or a note linked to, and a typo there should not raise a dialog.
 */
export async function openViewFromUri(
    app: App,
    settings: TaskViewerSettings,
    params: Record<string, string>,
): Promise<void> {
    const viewType = resolveViewTypeFromShortName(params.view) ?? legacyShortName(params.view);
    if (!viewType) return;

    const position = parseLeafPosition(params.position);

    const state = viewType === TIMER_VIEW
        ? timerState(params)
        : await templatedState(app, settings, viewType, params);

    await openLeafFromState(app, settings, viewType, position, state);
}

/**
 * Short names for views that predate the schema registry.
 *
 * The timer view never had a schema, so `resolveViewTypeFromShortName` — which
 * only knows registered schemas — cannot find it.
 */
function legacyShortName(shortName: string | undefined): string | undefined {
    return shortName === 'timer' ? TIMER_VIEW : undefined;
}

/** The timer view carries its state in the query itself; it has no template. */
function timerState(params: Record<string, string>): Record<string, unknown> {
    const state: Record<string, unknown> = {};
    if (params.mode) state.timerViewMode = params.mode;
    if (params.intervalTemplate) state.intervalTemplate = params.intervalTemplate;
    if (params.name) state.customName = params.name;
    return state;
}

/**
 * A template's state with the query's overrides on top.
 *
 * A template that cannot be found is worth saying out loud — unlike a bad
 * view name, the user named a file they expected to exist — and the view
 * still opens, on its defaults.
 */
async function templatedState(
    app: App,
    settings: TaskViewerSettings,
    viewType: string,
    params: Record<string, string>,
): Promise<Record<string, unknown>> {
    const result = await buildViewStateFromParams(
        app, settings.viewTemplateFolder, viewType, params,
    );
    if (result.templateNotFound) {
        new Notice(t('notice.templateNotFound', { name: result.templateNotFound }));
    }
    return result.state;
}
