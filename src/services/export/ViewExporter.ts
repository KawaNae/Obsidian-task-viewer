import { Notice } from 'obsidian';
import type { ViewExportOptions, ExportStrategy } from './ExportTypes';
import { ExportUtils } from './ExportUtils';

export class ViewExporter {
    static async exportAsPng(options: ViewExportOptions, strategy: ExportStrategy): Promise<void> {
        const { container, taskIndex, filename, expandScrollAreas = true } = options;

        const progress = new Notice('Exporting image…', 0);
        const restoreFns: (() => void)[] = [];

        try {
            if (expandScrollAreas) {
                strategy.expandScrollAreas(container, restoreFns);
            } else {
                strategy.simulateScrollPosition(container, restoreFns);
            }
            ExportUtils.applyMasking(container, taskIndex, restoreFns);

            const blob = await ExportUtils.captureToBlob(container);
            ExportUtils.downloadBlob(blob, filename);
            progress.hide();
            new Notice('Image exported.');
        } catch (err) {
            console.error('[ViewExporter] Export failed:', err);
            progress.hide();
            new Notice('Export failed. See console for details.');
        } finally {
            for (const restore of restoreFns) restore();
        }
    }
}
