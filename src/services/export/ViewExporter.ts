import { Notice } from 'obsidian';
import type { ViewExportOptions, ExportTargetSpec } from './ExportTypes';
import { ExportUtils } from './ExportUtils';
import { logError } from '../../log/log';

export interface CaptureResult {
    blob: Blob;
    width: number;
    height: number;
}

/**
 * One-shot view-to-PNG export. Always captures the **full content** (the entire
 * scrollHeight), not just the visible viewport — the "visible area" mode lived
 * here historically but produced unreliable results because html-to-image
 * cannot honor scrollTop/clip through its foreignObject pipeline. Users wanting
 * a viewport-accurate image should use the OS screenshot tool instead.
 *
 * Masking is **not** applied here. It is a render-time visual mode of the live
 * view (`TaskCardRenderer.applyMaskToContent`), so the clone inherits whichever
 * masked/unmasked state the live DOM has.
 */
export class ViewExporter {
    /**
     * Clone, expand scroll areas, and capture to Blob.
     * Throws on failure — caller handles UX (Notice, logging).
     */
    static async captureExpanded(container: HTMLElement, spec: ExportTargetSpec): Promise<CaptureResult> {
        const clone = container.cloneNode(true) as HTMLElement;
        clone.style.position = 'absolute';
        clone.style.left = '-99999px';
        clone.style.top = '0';
        clone.style.width = `${container.offsetWidth}px`;
        clone.style.height = `${container.offsetHeight}px`;
        container.parentElement!.appendChild(clone);

        try {
            const restoreFns: (() => void)[] = [];

            for (const sel of spec.scrollAreas) {
                const matches = clone.matches(sel) ? [clone] : [];
                const descendants = Array.from(clone.querySelectorAll<HTMLElement>(sel));
                for (const area of [...matches, ...descendants]) {
                    ExportUtils.expandScrollArea(area, restoreFns);
                }
            }

            ExportUtils.expandOverflowParents(clone, spec.overflowParents, restoreFns);
            ExportUtils.expandContainer(clone, restoreFns);
            spec.extraExpand?.(clone, restoreFns);

            const width = clone.offsetWidth;
            const height = clone.offsetHeight;
            const blob = await ExportUtils.captureToBlob(clone);
            return { blob, width, height };
        } finally {
            clone.remove();
        }
    }

    /** UI entry point: shows progress Notice, captures, saves, shows result. */
    static async exportAsPng(options: ViewExportOptions, spec: ExportTargetSpec): Promise<void> {
        const { app, container, filename, folder } = options;
        const progress = new Notice('Exporting image…', 0);

        try {
            const { blob } = await ViewExporter.captureExpanded(container, spec);
            const filePath = await ExportUtils.saveBlobToVault(blob, filename, folder, app);
            progress.hide();
            new Notice(`Image saved to ${filePath}`);
        } catch (err) {
            logError(`[ViewExporter] Export failed: ${(err as Error)?.message ?? err}`);
            progress.hide();
            new Notice('Export failed. See console for details.');
        }
    }
}
