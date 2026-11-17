import { ev } from './view-helper';

/**
 * What only some test files need of the E2E vault, checked where they need
 * it and said as the suite's own checks say theirs (`preflight.ts`): what
 * does not hold, and what puts it right.
 */

/** Throw unless Dataview is enabled in the E2E vault, with DataviewJS when `js`. */
export function requireDataview({ js = false } = {}): void {
    const state = ev<{ loaded: boolean; js: boolean }>(`(() => {
        const dv = app.plugins.plugins.dataview;
        return JSON.stringify({ loaded: !!dv?._loaded, js: !!dv?.settings?.enableDataviewJs });
    })()`);
    if (!state.loaded) {
        throw new Error('Dataview is not loaded in the E2E vault, which its definition installs (tests/integration/vault/definition.ts): see the developer console of the vault for the error of its load');
    }
    if (js && !state.js) {
        throw new Error('DataviewJS is off in the E2E vault: its definition turns it on (tests/integration/vault/definition.ts); see that Dataview reads the data.json written there');
    }
}
