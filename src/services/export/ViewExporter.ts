import { Notice } from 'obsidian';
import type { ViewExportOptions, ExportStrategy } from './ExportTypes';
import { ExportUtils } from './ExportUtils';

export class ViewExporter {
    static async exportAsPng(options: ViewExportOptions, strategy: ExportStrategy): Promise<void> {
        const { app, container, readService, filename, expandScrollAreas = true } = options;

        const progress = new Notice('Exporting image…', 0);

        try {
            // Clone the container off-screen so the original DOM is never modified
            const clone = container.cloneNode(true) as HTMLElement;
            clone.style.position = 'absolute';
            clone.style.left = '-99999px';
            clone.style.top = '0';
            clone.style.width = `${container.offsetWidth}px`;
            clone.style.height = `${container.offsetHeight}px`;
            container.parentElement!.appendChild(clone);

            // Transfer scrollTop values (cloneNode doesn't copy them)
            for (const selector of strategy.getScrollAreaSelectors()) {
                ExportUtils.transferScrollPositions(container, clone, selector);
            }

            try {
                const restoreFns: (() => void)[] = [];
                if (expandScrollAreas) {
                    strategy.expandScrollAreas(clone, restoreFns);
                } else {
                    strategy.simulateScrollPosition(clone, restoreFns);
                }
                ExportUtils.applyMasking(clone, readService, restoreFns);

                const blob = await ExportUtils.captureToBlob(clone);
                await ExportUtils.downloadBlob(blob, filename, app);
                progress.hide();
            } finally {
                clone.remove();
            }
        } catch (err) {
            console.error('[ViewExporter] Export failed:', err);
            progress.hide();
            new Notice('Export failed. See console for details.');
        }
    }
}
