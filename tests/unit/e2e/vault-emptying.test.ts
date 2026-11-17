/**
 * The emptying of the E2E vault's folder (tests/integration/vault/emptying.ts)
 * refuses every folder that does not say it is that vault, and deletes
 * nothing then. Tried on folders made for each test in the system's
 * temporary folder; the vaults on the machine are never named here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MARKER, emptyVaultFolder, whyNotEmptiable } from '../../integration/vault/emptying';

let root: string;

/** A folder under the test's root holding a note, a settings folder and, when given, a marker with `marker` in it. */
function vault(name: string, marker?: string): string {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, '.obsidian', 'plugins', 'p'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'note.md'), '- [ ] a task\n');
    fs.writeFileSync(path.join(dir, '.obsidian', 'plugins', 'p', 'main.js'), '');
    if (marker !== undefined) fs.writeFileSync(path.join(dir, MARKER), marker);
    return dir;
}

function names(dir: string): string[] {
    return fs.readdirSync(dir).sort();
}

beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'tv-vault-emptying-')));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('a folder that says it is the E2E vault', () => {
    it('is emptied but for its marker', () => {
        const dir = vault('E2E', path.join(root, 'E2E'));
        expect(emptyVaultFolder(dir, [path.join(root, 'Main'), path.join(root, 'Dev')])).toBeNull();
        expect(names(dir)).toEqual([MARKER]);
        expect(fs.readFileSync(path.join(dir, MARKER), 'utf-8')).toBe(path.join(root, 'E2E'));
    });

    it('may hold its path with a line end after it', () => {
        const dir = vault('E2E', `${path.join(root, 'E2E')}\n`);
        expect(whyNotEmptiable(dir, [])).toBeNull();
    });

    it('deletes a link in it, not what the link points to', () => {
        const outside = vault('Outside');
        const dir = vault('E2E', path.join(root, 'E2E'));
        fs.symlinkSync(outside, path.join(dir, 'link'));
        expect(emptyVaultFolder(dir, [])).toBeNull();
        expect(names(dir)).toEqual([MARKER]);
        expect(names(outside)).toEqual(['.obsidian', 'note.md']);
    });
});

describe('a folder that does not say so is left as it is', () => {
    it('with no marker', () => {
        const dir = vault('E2E');
        expect(emptyVaultFolder(dir, [])?.what).toMatch(/has no \.tv-e2e-vault/);
        expect(names(dir)).toEqual(['.obsidian', 'note.md']);
    });

    it('with a marker holding another folder\'s path, as a copy of the vault holds', () => {
        vault('E2E', path.join(root, 'E2E'));
        const copy = vault('Copy', path.join(root, 'E2E'));
        expect(emptyVaultFolder(copy, [])?.what).toMatch(/not the path of the folder it is in/);
        expect(names(copy)).toEqual(['.obsidian', MARKER, 'note.md']);
    });

    it('with a marker holding a path relative to the folder', () => {
        const dir = vault('E2E', '.');
        expect(emptyVaultFolder(dir, [])?.what).toMatch(/not the path of the folder it is in/);
        expect(names(dir)).toEqual(['.obsidian', MARKER, 'note.md']);
    });

    it('with an empty marker', () => {
        const dir = vault('E2E', '');
        expect(emptyVaultFolder(dir, [])).not.toBeNull();
        expect(names(dir)).toEqual(['.obsidian', MARKER, 'note.md']);
    });

    it('when it is not there', () => {
        expect(emptyVaultFolder(path.join(root, 'Nowhere'), [])?.what).toMatch(/is not there/);
    });
});

describe('a vault kept is not emptied, whatever its marker says', () => {
    it('the kept vault itself', () => {
        const main = vault('Main', path.join(root, 'Main'));
        expect(emptyVaultFolder(main, [main])?.what).toMatch(/never emptied/);
        expect(names(main)).toEqual(['.obsidian', MARKER, 'note.md']);
    });

    it('a folder inside a kept vault', () => {
        const main = vault('Main');
        const inner = vault(path.join('Main', 'E2E'), path.join(root, 'Main', 'E2E'));
        expect(emptyVaultFolder(inner, [main])?.what).toMatch(/never emptied/);
        expect(names(inner)).toEqual(['.obsidian', MARKER, 'note.md']);
        expect(names(main)).toEqual(['.obsidian', 'E2E', 'note.md']);
    });

    it('a folder holding a kept vault', () => {
        const dev = vault(path.join('Vaults', 'Dev'));
        const outer = path.join(root, 'Vaults');
        fs.writeFileSync(path.join(outer, MARKER), outer);
        expect(emptyVaultFolder(outer, [dev])?.what).toMatch(/never emptied/);
        expect(names(dev)).toEqual(['.obsidian', 'note.md']);
    });

    it('the kept vault reached through a link', () => {
        const main = vault('Main', path.join(root, 'Main'));
        const link = path.join(root, 'Link');
        fs.symlinkSync(main, link);
        expect(emptyVaultFolder(link, [main])?.what).toMatch(/never emptied/);
        expect(names(main)).toEqual(['.obsidian', MARKER, 'note.md']);
    });

    it('a kept vault whose folder is not on the machine is still kept', () => {
        const dir = vault('E2E', path.join(root, 'E2E'));
        expect(emptyVaultFolder(dir, [path.join(root, 'E2E', 'Main')])?.what).toMatch(/never emptied/);
    });

    it('a sibling whose name starts with the kept vault\'s is not taken for it', () => {
        const dir = vault('DevE2E', path.join(root, 'DevE2E'));
        expect(whyNotEmptiable(dir, [path.join(root, 'Dev')])).toBeNull();
    });
});
