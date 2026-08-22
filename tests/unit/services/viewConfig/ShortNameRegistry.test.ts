import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    registeredViewTypes,
    shortNameFor,
    resolveViewTypeFromShortName,
} from '../../../../src/services/viewConfig';

/**
 * A view's short name is what appears in `obsidian://task-viewer?view=…`, in
 * exported filenames, and in template files. It used to be written out three
 * times — each view's schema, a table in ViewUriBuilder, and a `-view` suffix
 * strip in ViewSettingsMenu — so nothing stopped the three from disagreeing.
 * Now the schema registry is the only source, which makes it worth checking
 * that every view actually reaches it.
 */
const REGISTRY_SRC = resolve(__dirname, '../../../../src/constants/viewRegistry.ts');

/** Read the ViewType union from source, so a newly added view is picked up here without editing this test. */
function declaredViewTypes(): string[] {
    const src = readFileSync(REGISTRY_SRC, 'utf8');
    const union = /export type ViewType =([^;]+);/.exec(src);
    if (!union) throw new Error('could not find the ViewType union in viewRegistry.ts');
    return [...union[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

beforeAll(async () => {
    // Schemas register themselves as a side effect of being imported.
    await import('../../../../src/views/registerAllSchemas');
});

describe('view short names', () => {
    it('finds every view type the registry declares', () => {
        expect(declaredViewTypes().length).toBeGreaterThan(0);
    });

    it('registers a schema for every declared view type', () => {
        // Catches the step that is easy to forget when adding a view: the
        // side-effect import in registerAllSchemas.ts.
        const missing = declaredViewTypes().filter(v => !registeredViewTypes().includes(v));
        expect(missing).toEqual([]);
    });

    it('gives every declared view type a short name', () => {
        const nameless = declaredViewTypes().filter(v => !shortNameFor(v));
        expect(nameless).toEqual([]);
    });

    it('hands out a distinct short name per view type', () => {
        const names = declaredViewTypes().map(v => shortNameFor(v));
        expect(new Set(names).size).toBe(names.length);
    });

    it('round-trips a view type through its short name', () => {
        // The write side (ViewUriBuilder) and the read side (UriViewOpener)
        // now share this map; the round trip is what keeps a copied URI
        // reopening the view it came from.
        for (const viewType of declaredViewTypes()) {
            const short = shortNameFor(viewType);
            expect(short, viewType).toBeDefined();
            expect(resolveViewTypeFromShortName(short!)).toBe(viewType);
        }
    });

    it('returns nothing for a view type with no schema', () => {
        expect(shortNameFor('log-view')).toBeUndefined();
        expect(resolveViewTypeFromShortName('not-a-view')).toBeUndefined();
    });

    it('does not assume a short name is the view type minus "-view"', () => {
        // The old regex happened to agree with every schema, which is why the
        // duplication went unnoticed. Assert the values themselves so a schema
        // that departs from the pattern is a decision, not a silent break.
        expect(shortNameFor('mini-calendar-view')).toBe('mini-calendar');
        expect(shortNameFor('timer-view')).toBe('timer');
    });
});
