import type { TaskViewerSettings } from '../types';

type BodyStyleSettings = Pick<TaskViewerSettings,
    'applyGlobalStyles' | 'hideViewHeader' | 'fixMobileGradientWidth' | 'mobileTopOffset'>;

/**
 * Everything the plugin puts on the document outside its own views: body
 * classes and root CSS variables that settings drive. One table, read both
 * to apply the settings and to take them all off on unload, so what is put
 * on and what is taken off cannot drift apart. `onunload` used to remove
 * only the first class, and the view headers stayed hidden after the plugin
 * was disabled.
 */
const BODY_CLASSES: readonly [string, (s: BodyStyleSettings) => boolean][] = [
    ['task-viewer-global-styles', s => s.applyGlobalStyles],
    ['task-viewer-hide-view-header', s => s.hideViewHeader],
    ['task-viewer-fix-mobile-gradient', s => s.fixMobileGradientWidth],
];

const ROOT_VARIABLES: readonly [string, (s: BodyStyleSettings) => string][] = [
    ['--tv-mobile-top-offset', s => `${s.mobileTopOffset}px`],
];

/** Put the settings' classes and variables on the document. */
export function applyBodyStyles(settings: BodyStyleSettings, doc: Document = document): void {
    for (const [cls, isOn] of BODY_CLASSES) doc.body.classList.toggle(cls, isOn(settings));
    for (const [name, value] of ROOT_VARIABLES) doc.documentElement.style.setProperty(name, value(settings));
}

/** Take off every class and variable {@link applyBodyStyles} can put on. */
export function clearBodyStyles(doc: Document = document): void {
    for (const [cls] of BODY_CLASSES) doc.body.classList.remove(cls);
    for (const [name] of ROOT_VARIABLES) doc.documentElement.style.removeProperty(name);
}
