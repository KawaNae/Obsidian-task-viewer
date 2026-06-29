import { Notice } from 'obsidian';
import type { ViewExportOptions, ExportTargetSpec } from './ExportTypes';
import { ExportUtils } from './ExportUtils';
import { logError } from '../../log/log';

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
    static async exportAsPng(options: ViewExportOptions, spec: ExportTargetSpec): Promise<void> {
        const { app, container, filename } = options;

        const progress = new Notice('Exporting image…', 0);

        try {
            // Clone the container off-screen so the original DOM is never modified.
            const clone = container.cloneNode(true) as HTMLElement;
            clone.style.position = 'absolute';
            clone.style.left = '-99999px';
            clone.style.top = '0';
            clone.style.width = `${container.offsetWidth}px`;
            clone.style.height = `${container.offsetHeight}px`;
            container.parentElement!.appendChild(clone);

            try {
                const restoreFns: (() => void)[] = [];

                // Expand each declared scroll area to its full scrollHeight.
                // expandScrollAreaSelf(true) so a selector matching the
                // container itself (Timeline's historical contract) still works.
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

                const blob = await ExportUtils.captureToBlob(clone);
                await ExportUtils.downloadBlob(blob, filename, app);
                progress.hide();
            } finally {
                clone.remove();
            }
        } catch (err) {
            logError(`[ViewExporter] Export failed: ${(err as Error)?.message ?? err}`);
            progress.hide();
            new Notice('Export failed. See console for details.');
        }
    }
}
