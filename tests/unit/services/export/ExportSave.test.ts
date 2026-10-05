import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, TFile, TFolder } from 'obsidian';
import { exportFolderOf, saveExportImage } from '../../../../src/services/export/ExportSave';
import { DEFAULT_SETTINGS } from '../../../../src/types';

describe('exportFolderOf', () => {
    it('answers the folder asked for, else the setting, else the default', () => {
        expect(exportFolderOf({ exportFolder: 'set' }, ' asked ')).toBe('asked');
        expect(exportFolderOf({ exportFolder: ' set ' }, '  ')).toBe('set');
        expect(exportFolderOf({ exportFolder: '' })).toBe(DEFAULT_SETTINGS.exportFolder);
    });
});

/** A vault holding `paths` (folders end in `/`), recording what is written. */
function vaultApp(paths: string[]) {
    const held = new Map<string, TFile | TFolder>();
    const hold = (path: string) => {
        const folder = path.endsWith('/');
        const entry = folder ? new TFolder() : new TFile();
        entry.path = folder ? path.slice(0, -1) : path;
        held.set(entry.path, entry);
        return entry;
    };
    paths.forEach(hold);
    const app = new App();
    const vault = {
        getAbstractFileByPath: (p: string) => held.get(p) ?? null,
        createFolder: vi.fn(async (p: string) => { hold(`${p}/`); }),
        createBinary: vi.fn(async (p: string) => hold(p)),
        modifyBinary: vi.fn(async () => {}),
    };
    (app as unknown as { vault: unknown }).vault = vault;
    return { app, vault };
}

const blob = () => new Blob([new Uint8Array([1, 2, 3])]);

describe('saveExportImage', () => {
    afterEach(() => {
        delete (globalThis as { window?: unknown }).window;
    });

    it('writes a relative folder through the vault, making the folders it names', async () => {
        const { app, vault } = vaultApp(['out/']);

        const path = await saveExportImage(app, blob(), 'out/png', 'a.png');

        expect(path).toBe('out/png/a.png');
        expect(vault.createFolder.mock.calls).toEqual([['out/png']]);
        expect(vault.createBinary).toHaveBeenCalledWith('out/png/a.png', expect.any(ArrayBuffer));
    });

    it('replaces an image already at the path', async () => {
        const { app, vault } = vaultApp(['out/', 'out/a.png']);

        expect(await saveExportImage(app, blob(), 'out', 'a.png')).toBe('out/a.png');
        expect(vault.modifyBinary).toHaveBeenCalledTimes(1);
        expect(vault.createBinary).not.toHaveBeenCalled();
    });

    it('writes an absolute folder with Node fs, not through the vault', async () => {
        const fs = { promises: { mkdir: vi.fn(async () => {}), writeFile: vi.fn(async () => {}), stat: vi.fn() } };
        (globalThis as { window?: unknown }).window = { require: (id: string) => (id === 'fs' ? fs : undefined) };
        const { app, vault } = vaultApp([]);

        const path = await saveExportImage(app, blob(), 'C:\\exports\\', 'a.png');

        expect(path).toBe('C:/exports/a.png');
        expect(fs.promises.mkdir).toHaveBeenCalledWith('C:\\exports', { recursive: true });
        const [written, data] = fs.promises.writeFile.mock.calls[0] as unknown as [string, Uint8Array];
        expect(written).toBe('C:\\exports/a.png');
        expect([...data]).toEqual([1, 2, 3]);
        expect(vault.createBinary).not.toHaveBeenCalled();
    });

    it('fails an absolute folder off the desktop app', async () => {
        const { app } = vaultApp([]);

        await expect(saveExportImage(app, blob(), '/tmp/out', 'a.png')).rejects.toThrow('desktop app');
    });
});
