import type { CliData } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import { cliOk, cliError } from '../CliOutputFormatter';
import { resolveViewTypeFromShortName, schemaFor } from '../../services/viewConfig';
import { exportDescriptorFor } from '../../services/export/ExportRegistry';
import { ViewTemplateLoader } from '../../services/template/ViewTemplateLoader';
import { buildViewStateFromParams } from '../../services/viewConfig/ViewStateFactory';
import type { ExportResult } from '../../services/export/ExportService';
import { toCliName } from '../../api/OperationSchemas';

const EXPORT_SPECIFIC_KEYS = new Set([
    'view', 'template', 'name', 'output-folder', 'filename', 'wait', 'keep-open', 'width',
    'anchor-date',
]);

export function createExportImageHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        try {
            // 1. Resolve view type
            const viewType = resolveViewType(params, plugin);
            if (viewType.startsWith('{')) return viewType; // cliError JSON

            if (!exportDescriptorFor(viewType)) {
                return cliError(`View '${params.view ?? viewType}' does not support image export. Supported: timeline, calendar, schedule, kanban`);
            }

            // 2. Resolve anchor-date → view-specific transient key
            const anchorResult = resolveAnchorDate(params, viewType);
            if (anchorResult.error) return anchorResult.error;
            const resolvedParams = anchorResult.params;

            // 3. Validate flags: only EXPORT_SPECIFIC_KEYS + valid view-config keys allowed
            const validationErr = validateFlags(resolvedParams, viewType);
            if (validationErr) return validationErr;

            // 4. Determine mode: open-view vs temp-leaf
            const hasViewConfig = hasConfigParams(resolvedParams);
            const hasTemplate = !!resolvedParams.template;

            let result: ExportResult;

            if (!hasViewConfig && !hasTemplate) {
                result = await plugin.exportService.exportOpenView(viewType, buildOpts(resolvedParams));
            } else {
                const configParams = extractConfigParams(resolvedParams);
                const buildResult = await buildViewStateFromParams(
                    plugin.app,
                    plugin.settings.viewTemplateFolder,
                    viewType,
                    configParams,
                );
                if (buildResult.templateNotFound) {
                    const loader = new ViewTemplateLoader(plugin.app);
                    const available = loader.loadTemplates(plugin.settings.viewTemplateFolder)
                        .map(s => s.name);
                    return cliError(`Template '${buildResult.templateNotFound}' not found. Available: ${available.join(', ') || '(none)'}`);
                }
                result = await plugin.exportService.exportTempView(viewType, buildResult.state, buildOpts(resolvedParams));
            }

            const rangeInfo = computeRenderedRange(viewType, anchorResult.resolvedAnchor, resolvedParams);
            return cliOk({
                ...result,
                ...(rangeInfo ? {
                    resolvedAnchor: rangeInfo.anchor,
                    renderedRange: { from: rangeInfo.from, to: rangeInfo.to },
                } : {}),
            });
        } catch (e) {
            return cliError(e instanceof Error ? e.message : String(e));
        }
    };
}

// ── Anchor date resolution ──

interface AnchorResult {
    params: CliData;
    resolvedAnchor: string | undefined;
    error: string | null;
}

function resolveAnchorDate(params: CliData, viewType: string): AnchorResult {
    const anchorValue = params['anchor-date'];
    if (!anchorValue) return { params, resolvedAnchor: undefined, error: null };

    const schema = schemaFor(viewType);
    const anchorKey = schema?.anchorKey;
    if (!anchorKey) {
        return {
            params,
            resolvedAnchor: undefined,
            error: cliError(`View '${viewType}' has no date anchor. anchor-date= is not supported for this view type`),
        };
    }

    const cliKey = toCliName(anchorKey);
    if (params[cliKey] && params[cliKey] !== anchorValue) {
        return {
            params,
            resolvedAnchor: undefined,
            error: cliError(`Conflicting date flags: anchor-date=${anchorValue} and ${cliKey}=${params[cliKey]}. Use one or the other`),
        };
    }

    const copy = { ...params, [cliKey]: anchorValue };
    delete copy['anchor-date'];
    return { params: copy, resolvedAnchor: anchorValue, error: null };
}

// ── Rendered range computation ──

interface RenderedRange {
    anchor: string;
    from: string;
    to: string;
}

function computeRenderedRange(
    viewType: string,
    resolvedAnchor: string | undefined,
    params: CliData,
): RenderedRange | null {
    if (!resolvedAnchor) {
        const schema = schemaFor(viewType);
        const anchorKey = schema?.anchorKey;
        if (!anchorKey) return null;
        const cliKey = toCliName(anchorKey);
        const dateFromParams = params[cliKey];
        if (!dateFromParams) return null;
        resolvedAnchor = dateFromParams;
    }

    const schema = schemaFor(viewType);
    const shortName = schema?.shortName;

    switch (shortName) {
        case 'timeline': {
            const daysToShow = params['days-to-show']
                ? parseInt(params['days-to-show'], 10)
                : (schema?.defaults as Record<string, unknown>)?.daysToShow as number ?? 3;
            const from = resolvedAnchor;
            const to = addDays(resolvedAnchor, daysToShow - 1);
            return { anchor: resolvedAnchor, from, to };
        }
        case 'calendar':
        case 'mini-calendar': {
            const [year, month] = resolvedAnchor.split('-').map(Number);
            const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
            return { anchor: resolvedAnchor, from: monthStart, to: monthEnd };
        }
        case 'schedule':
            return { anchor: resolvedAnchor, from: resolvedAnchor, to: resolvedAnchor };
        default:
            return null;
    }
}

function addDays(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + days);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// ── Existing helpers ──

function resolveViewType(params: CliData, plugin: TaskViewerPlugin): string {
    if (params.view) {
        const resolved = resolveViewTypeFromShortName(params.view);
        if (!resolved) return cliError(`Unknown view: '${params.view}'. Use: timeline, calendar, schedule, kanban`);
        return resolved;
    }
    if (params.template) {
        const loader = new ViewTemplateLoader(plugin.app);
        const summary = loader.findByBasename(plugin.settings.viewTemplateFolder, params.template);
        if (summary) {
            const resolved = resolveViewTypeFromShortName(summary.viewType);
            if (resolved) return resolved;
        }
        const available = listTemplateNames(plugin);
        return cliError(`Template '${params.template}' not found or has no valid view type. Available: ${available || '(none)'}`);
    }
    const available = listTemplateNames(plugin);
    const templateHint = available ? ` Available templates: ${available}` : '';
    return cliError(`Missing required flag: view= or template=. Specify the view to export (view=timeline|calendar|schedule|kanban) or a saved template name.${templateHint}`);
}

function validateFlags(params: CliData, viewType: string): string | null {
    const schema = schemaFor(viewType);
    const validConfigKeys = new Set<string>();
    if (schema) {
        const allFields = [
            ...Object.values(schema.config),
            ...Object.values(schema.transient ?? {}),
        ] as Array<{ key: string; legacyKeys?: string[] }>;
        for (const field of allFields) {
            validConfigKeys.add(toCliName(field.key));
            if (field.legacyKeys) {
                for (const lk of field.legacyKeys) validConfigKeys.add(toCliName(lk));
            }
        }
    }

    for (const key of Object.keys(params)) {
        if (EXPORT_SPECIFIC_KEYS.has(key)) continue;
        if (validConfigKeys.has(key)) continue;
        const allValid = [...EXPORT_SPECIFIC_KEYS, ...validConfigKeys].sort();
        return cliError(`Unknown flag: '${key}'. Available flags: ${allValid.join(', ')}`);
    }
    return null;
}

function hasConfigParams(params: CliData): boolean {
    return Object.keys(params).some(k => !EXPORT_SPECIFIC_KEYS.has(k));
}

function extractConfigParams(params: CliData): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
        if (EXPORT_SPECIFIC_KEYS.has(k)) continue;
        out[fromCliName(k)] = v;
    }
    if (params.template) out.template = params.template;
    if (params.name) out.name = params.name;
    return out;
}

function listTemplateNames(plugin: TaskViewerPlugin): string {
    const loader = new ViewTemplateLoader(plugin.app);
    return loader.loadTemplates(plugin.settings.viewTemplateFolder).map(s => s.name).join(', ');
}

function fromCliName(kebab: string): string {
    return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function buildOpts(params: CliData) {
    return {
        folder: params['output-folder'] || undefined,
        filename: params.filename || undefined,
        name: params.name || params.template || undefined,
        waitMs: params.wait ? parseInt(params.wait, 10) : undefined,
        keepOpen: params['keep-open'] === 'true',
        width: params.width ? parseInt(params.width, 10) : undefined,
    };
}
