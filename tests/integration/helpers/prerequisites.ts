import { ev } from './view-helper';

/**
 * What only some test files need of the Dev vault, checked where they need
 * it and said as the suite's own checks say theirs (`preflight.ts`): what
 * does not hold, and what puts it right.
 */

/** Throw unless Dataview is enabled in the Dev vault, with DataviewJS when `js`. */
export function requireDataview({ js = false } = {}): void {
    const state = ev<{ loaded: boolean; js: boolean }>(`(() => {
        const dv = app.plugins.plugins.dataview;
        return JSON.stringify({ loaded: !!dv?._loaded, js: !!dv?.settings?.enableDataviewJs });
    })()`);
    if (!state.loaded) {
        throw new Error('Dataview is not enabled in the Dev vault: enable it in Settings > Community plugins');
    }
    if (js && !state.js) {
        throw new Error('DataviewJS is off in the Dev vault: turn on Enable JavaScript Queries in the settings of Dataview');
    }
}
