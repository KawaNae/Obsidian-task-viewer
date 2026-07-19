import type { ItemView } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import { ViewExporter } from './ViewExporter';
import { ExportUtils } from './ExportUtils';
import { exportDescriptorFor, resolveExportContainer } from './ExportRegistry';

export interface ExportOptions {
    filename?: string;
    folder?: string;
    name?: string;
    waitMs?: number;
    keepOpen?: boolean;
}

export interface ExportResult {
    path: string;
    width: number;
    height: number;
    captureDurationMs: number;
    totalDurationMs: number;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function doubleRaf(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

function resolveFolder(opts: ExportOptions | undefined, plugin: TaskViewerPlugin): string {
    const folder = opts?.folder?.trim() || plugin.settings.exportFolder?.trim() || 'task-viewer-export';
    return folder;
}

function resolveFilename(opts: ExportOptions | undefined, viewType: string, plugin: TaskViewerPlugin): string {
    if (opts?.filename) return opts.filename;
    const label = opts?.name || viewType.replace('-view', '');
    const sanitized = label.replace(/[\\/:*?"<>|]/g, '_');
    const date = new Date().toISOString().slice(0, 10);
    return `${sanitized}_${date}.png`;
}

export class ExportService {
    constructor(private plugin: TaskViewerPlugin) {}

    async exportOpenView(viewType: string, opts?: ExportOptions): Promise<ExportResult> {
        const totalStart = performance.now();
        const descriptor = exportDescriptorFor(viewType);
        if (!descriptor) throw new Error(`View type '${viewType}' does not support image export`);

        const leaves = this.plugin.app.workspace.getLeavesOfType(viewType);
        const visibleLeaf = leaves.find(l => {
            const el = (l.view as any)?.contentEl as HTMLElement | undefined;
            return el && el.offsetWidth > 0;
        });
        if (!visibleLeaf) {
            throw new Error(`No visible '${viewType}' view is open. Open the view first or use template= to create a temporary one.`);
        }

        const contentEl = (visibleLeaf.view as any).contentEl as HTMLElement;
        const container = resolveExportContainer(contentEl, descriptor);
        if (!container) throw new Error('Export container not found in the open view');

        return this.capture(container, descriptor.spec, viewType, totalStart, opts);
    }

    async exportTempView(
        viewType: string,
        state: Record<string, unknown>,
        opts?: ExportOptions,
    ): Promise<ExportResult> {
        const totalStart = performance.now();
        const descriptor = exportDescriptorFor(viewType);
        if (!descriptor) throw new Error(`View type '${viewType}' does not support image export`);

        const workspace = this.plugin.app.workspace;
        const leaf = workspace.getLeaf('tab');

        try {
            await leaf.setViewState({ type: viewType, active: true, state });
            workspace.revealLeaf(leaf);

            await doubleRaf();
            await sleep(opts?.waitMs ?? 500);

            const contentEl = ((leaf.view as ItemView).contentEl ?? (leaf.view as any).contentEl) as HTMLElement | undefined;
            if (!contentEl) throw new Error('View did not produce a contentEl');

            const container = resolveExportContainer(contentEl, descriptor);
            if (!container) throw new Error('Export container not found after rendering. The view may not have finished initialization.');

            return await this.capture(container, descriptor.spec, viewType, totalStart, opts);
        } finally {
            if (opts?.keepOpen) {
                this.plugin.app.workspace.requestSaveLayout();
            } else {
                leaf.detach();
            }
        }
    }

    private async capture(
        container: HTMLElement,
        spec: import('./ExportTypes').ExportTargetSpec,
        viewType: string,
        totalStart: number,
        opts?: ExportOptions,
    ): Promise<ExportResult> {
        const captureStart = performance.now();

        const { blob, width, height } = await ViewExporter.captureExpanded(container, spec);

        const folder = resolveFolder(opts, this.plugin);
        const filename = resolveFilename(opts, viewType, this.plugin);
        const path = await ExportUtils.saveBlobToVault(blob, filename, folder, this.plugin.app);

        return {
            path,
            width,
            height,
            captureDurationMs: Math.round(performance.now() - captureStart),
            totalDurationMs: Math.round(performance.now() - totalStart),
        };
    }
}
