import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { ItemView } from 'obsidian';
import { viewContentEl, refreshView } from '../../../src/utils/ObsidianView';
import { editorCm } from '../../../src/utils/editorCm';
import { deviceMemoryGb, jsHeapStats, electronRequire } from '../../../src/utils/hostEnv';

const SRC = resolve(__dirname, '../../../src');

function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return tsFiles(path);
        return name.endsWith('.ts') ? [path] : [];
    });
}

/** Source with comments blanked, so prose cannot be mistaken for code. */
function code(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('as any', () => {
    /**
     * The refactor audit counted 21 `as any` in 10 files and named
     * types/index.ts a top offender. It had grepped raw text, and five of
     * those "casts" were the English words in comments like "same as any
     * other inline task" — types/index.ts had none at all. This test reads
     * code only, so the number it reports is the real one.
     */
    it('is not used anywhere in src', () => {
        const offenders = tsFiles(SRC)
            .filter(path => /\bas\s+any\b/.test(code(readFileSync(path, 'utf-8'))))
            .map(path => relative(SRC, path));
        expect(offenders).toEqual([]);
    });

    it('does not confuse prose for a cast', () => {
        // The guard above must stay honest: prose is fine, code is not.
        expect(/\bas\s+any\b/.test(code('// same as any other task'))).toBe(false);
        expect(/\bas\s+any\b/.test(code('const x = y as any;'))).toBe(true);
    });
});

describe('viewContentEl', () => {
    const leafWith = (view: unknown) => ({ view }) as unknown as Parameters<typeof viewContentEl>[0];

    it('returns the contentEl of an ItemView', () => {
        const view = new ItemView();
        (view as unknown as { contentEl: unknown }).contentEl = 'the-content';
        expect(viewContentEl(leafWith(view))).toBe('the-content');
    });

    // The `as any` this replaced returned undefined here too — but only
    // because the property happened to be missing, not because anything asked.
    it('returns undefined for a leaf holding some other view', () => {
        expect(viewContentEl(leafWith({ contentEl: 'not-an-item-view' }))).toBeUndefined();
    });
});

describe('refreshView', () => {
    it('calls refresh when the view has one', () => {
        let called = 0;
        refreshView({ refresh: () => { called++; } } as never);
        expect(called).toBe(1);
    });

    it('is a no-op when the view has none', () => {
        expect(() => refreshView({} as never)).not.toThrow();
    });
});

describe('editorCm', () => {
    it('hands back the cm handle when Obsidian exposes one', () => {
        expect(editorCm({ cm: 'cm6' } as never)).toBe('cm6');
    });

    it('returns undefined when it does not', () => {
        expect(editorCm({} as never)).toBeUndefined();
    });
});

describe('hostEnv', () => {
    // Mobile has no Electron and no Chrome-only counters; every accessor has
    // to answer "not here" rather than throw.
    it('returns undefined when the host does not provide the API', () => {
        expect(deviceMemoryGb()).toBeUndefined();
        expect(jsHeapStats()).toBeUndefined();
        expect(electronRequire({} as Window)).toBeUndefined();
    });

    it('finds require when the window carries one', () => {
        const req = (id: string) => id;
        expect(electronRequire({ require: req } as unknown as Window)).toBe(req);
    });

    // A page can carry a `require` that is not Electron's — a bundler shim,
    // another plugin's global. Handing it back would make the caller invoke it.
    it('ignores a require that is not callable', () => {
        expect(electronRequire({ require: {} } as unknown as Window)).toBeUndefined();
    });
});
