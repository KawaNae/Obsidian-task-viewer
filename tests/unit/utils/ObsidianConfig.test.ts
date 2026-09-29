import { describe, it, expect } from 'vitest';
import type { App } from 'obsidian';
import { indentUnit } from '../../../src/utils/ObsidianConfig';

/** An app whose `.obsidian/app.json` answers `config`, or one with no `getConfig` at all. */
function appWith(config?: Record<string, unknown> | (() => never)): App {
    if (config === undefined) return { vault: {} } as unknown as App;
    const getConfig = typeof config === 'function' ? config : (key: string) => config[key];
    return { vault: { getConfig } } as unknown as App;
}

describe('ObsidianConfig.indentUnit: the indentation of a new level, as Obsidian\'s editor writes one', () => {
    it('is a tab when the vault indents with tabs', () => {
        expect(indentUnit(appWith({ useTab: true, tabSize: 2 }))).toBe('\t');
    });

    it('is tabSize spaces when it indents with spaces', () => {
        expect(indentUnit(appWith({ useTab: false, tabSize: 4 }))).toBe('    ');
        expect(indentUnit(appWith({ useTab: false, tabSize: 2 }))).toBe('  ');
    });

    it('falls back to Obsidian\'s defaults, a tab and four columns, where it cannot read them', () => {
        expect(indentUnit(appWith())).toBe('\t');
        expect(indentUnit(appWith(() => { throw new Error('gone'); }))).toBe('\t');
        expect(indentUnit(appWith({ useTab: 'no' }))).toBe('\t');
        expect(indentUnit(appWith({ useTab: false }))).toBe('    ');
        expect(indentUnit(appWith({ useTab: false, tabSize: '2' }))).toBe('    ');
        expect(indentUnit(appWith({ useTab: false, tabSize: 2.5 }))).toBe('    ');
    });

    it('keeps a unit of spaces within four columns, past which a child under `- ` is indented code', () => {
        expect(indentUnit(appWith({ useTab: false, tabSize: 8 }))).toBe('    ');
        expect(indentUnit(appWith({ useTab: false, tabSize: 0 }))).toBe(' ');
    });
});
