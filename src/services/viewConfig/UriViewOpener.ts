import { type App, Notice } from 'obsidian';
import type { TaskViewerSettings } from '../../types';
import { t } from '../../i18n';
import { resolveViewTypeFromShortName } from './SchemaRegistry';
import { buildViewStateFromParams } from './ViewStateFactory';
import { openLeafFromState, parseLeafPosition } from './LeafOpener';
import { noticeConfigIssues } from './ConfigIssueNotice';

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
    const viewType = resolveViewTypeFromShortName(params.view);
    if (!viewType) return;

    const position = parseLeafPosition(params.position);

    const state = await stateFromParams(app, settings, viewType, params);

    await openLeafFromState(app, settings, viewType, position, state);
}

/**
 * A template's state with the query's overrides on top; a view without
 * templates (the timer) takes the query alone.
 *
 * A template that cannot be found is worth saying out loud — unlike a bad
 * view name, the user named a file they expected to exist — and the view
 * still opens, on its defaults. So is a condition the template or the query
 * holds that cannot be read: the view opens without it.
 */
async function stateFromParams(
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
    noticeConfigIssues(result.issues);
    return result.state;
}
