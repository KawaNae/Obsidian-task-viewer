import { describe, it, expect } from 'vitest';
import { applyBodyStyles, clearBodyStyles } from '../../../src/settings/BodyStyles';

/**
 * What the settings put on the document comes off on unload, all of it.
 * `onunload` used to remove only `task-viewer-global-styles`; the class that
 * hides the view headers and the top-offset variable stayed after the plugin
 * was disabled.
 */
function fakeDocument() {
    const classes = new Set<string>();
    const vars = new Map<string, string>();
    const doc = {
        body: { classList: {
            toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c); return on; },
            remove: (c: string) => { classes.delete(c); },
        } },
        documentElement: { style: {
            setProperty: (n: string, v: string) => { vars.set(n, v); },
            removeProperty: (n: string) => { vars.delete(n); return ''; },
        } },
    } as unknown as Document;
    return { doc, classes, vars };
}

const allOn = { applyGlobalStyles: true, hideViewHeader: true, fixMobileGradientWidth: true, mobileTopOffset: 32 };

describe('body styles', () => {
    it('apply puts on the classes and variables the settings turn on', () => {
        const h = fakeDocument();
        applyBodyStyles(allOn, h.doc);
        expect([...h.classes].sort()).toEqual([
            'task-viewer-fix-mobile-gradient', 'task-viewer-global-styles', 'task-viewer-hide-view-header',
        ]);
        expect(h.vars.get('--tv-mobile-top-offset')).toBe('32px');
    });

    it('apply takes off a class whose setting is turned off', () => {
        const h = fakeDocument();
        applyBodyStyles(allOn, h.doc);
        applyBodyStyles({ ...allOn, hideViewHeader: false }, h.doc);
        expect(h.classes.has('task-viewer-hide-view-header')).toBe(false);
    });

    it('clear takes off everything apply put on', () => {
        const h = fakeDocument();
        applyBodyStyles(allOn, h.doc);
        clearBodyStyles(h.doc);
        expect(h.classes.size).toBe(0);
        expect(h.vars.size).toBe(0);
    });
});
