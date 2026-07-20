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
    width?: number;
}

export interface ExportResult {
    path: string;
    width: number;
    height: number;
    captureDurationMs: number;
    totalDurationMs: number;
    clamped?: boolean;
    actualWidth?: number;
    actualHeight?: number;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const DEFAULT_POPOUT_WIDTH = 1200;
const DEFAULT_POPOUT_HEIGHT = 800;
const OFFSCREEN_X = -9999;

function doubleRaf(win: Window): Promise<void> {
    return new Promise(resolve => {
        win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve()));
    });
}

function getElectronWindow(win: Window): any | null {
    const remote = (win as any).require?.('electron')?.remote
        ?? (win as any).require?.('@electron/remote');
    return remote?.getCurrentWindow?.() ?? null;
}

function resizePopout(win: Window, bw: any | null, width: number, height: number): void {
    if (bw) {
        bw.setSize(width, height);
    } else {
        win.resizeTo(width, height);
    }
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
        const popoutWidth = opts?.width ?? DEFAULT_POPOUT_WIDTH;
        const leaf = workspace.openPopoutLeaf({
            ...(opts?.keepOpen ? {} : { x: OFFSCREEN_X, y: 0 }),
            size: { width: popoutWidth, height: DEFAULT_POPOUT_HEIGHT },
        });

        try {
            const popoutWin = (leaf.getContainer() as any).win as Window;
            const bw = getElectronWindow(popoutWin);
            if (bw && !opts?.keepOpen) bw.setOpacity(0);
            resizePopout(popoutWin, bw, popoutWidth, DEFAULT_POPOUT_HEIGHT);

            await leaf.setViewState({ type: viewType, active: true, state });

            await doubleRaf(popoutWin);
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

        const result = await ViewExporter.captureExpanded(container, spec);

        const folder = resolveFolder(opts, this.plugin);
        const filename = resolveFilename(opts, viewType, this.plugin);
        const path = await ExportUtils.saveBlobToVault(result.blob, filename, folder, this.plugin.app);

        const out: ExportResult = {
            path,
            width: result.width,
            height: result.height,
            captureDurationMs: Math.round(performance.now() - captureStart),
            totalDurationMs: Math.round(performance.now() - totalStart),
        };
        if (result.clamped) {
            out.clamped = true;
            out.actualWidth = result.actualWidth;
            out.actualHeight = result.actualHeight;
        }
        return out;
    }
}
