import { normalizePath, TFile, type App } from 'obsidian';
import { DEFAULT_SETTINGS, type TaskViewerSettings } from '../../types';
import { ensureFolderOf } from '../persistence/FileLines';
import { nodeFs } from '../../utils/hostEnv';

/**
 * Where an exported image is saved, and saving it. The view menu's export
 * and the API's `exportImage` both come through here, so the folder an
 * export lands in is answered once: the one asked for, else the setting,
 * else the setting's default.
 */
export function exportFolderOf(settings: Pick<TaskViewerSettings, 'exportFolder'>, override?: string): string {
    return override?.trim() || settings.exportFolder?.trim() || DEFAULT_SETTINGS.exportFolder;
}

/** A folder named from the root of the disk (`/x`, `\x`, `C:\x`), not from the vault. */
function isAbsoluteFolder(folder: string): boolean {
    return /^(?:[A-Za-z]:)?[\\/]/.test(folder);
}

/**
 * Save `blob` as `filename` in `folder`, replacing a file already there, and
 * answer the path it was saved at. A folder relative to the vault is written
 * through the vault, as any other note, on every platform. A folder outside
 * the vault is written with Node's `fs`, which only the desktop app has;
 * elsewhere that fails.
 */
export async function saveExportImage(app: App, blob: Blob, folder: string, filename: string): Promise<string> {
    const data = await blob.arrayBuffer();
    if (isAbsoluteFolder(folder)) {
        const fs = nodeFs();
        if (!fs) throw new Error('Saving outside the vault needs the desktop app');
        const dir = folder.replace(/[\\/]+$/, '');
        await fs.promises.mkdir(dir, { recursive: true });
        const filePath = `${dir}/${filename}`;
        await fs.promises.writeFile(filePath, new Uint8Array(data));
        return filePath.replace(/\\/g, '/');
    }
    const filePath = normalizePath(`${folder}/${filename}`);
    const existing = app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
        await app.vault.modifyBinary(existing, data);
    } else {
        await ensureFolderOf(app, filePath);
        await app.vault.createBinary(filePath, data);
    }
    return filePath;
}
