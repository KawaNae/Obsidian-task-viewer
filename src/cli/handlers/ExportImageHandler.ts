import type { CliData } from 'obsidian';
import type TaskViewerPlugin from '../../main';
import { cliOk, cliError } from '../CliOutputFormatter';
import { resolveViewTypeFromShortName, schemaFor } from '../../services/viewConfig';
import { exportDescriptorFor } from '../../services/export/ExportRegistry';
import { ViewTemplateLoader } from '../../services/template/ViewTemplateLoader';
import { buildViewStateFromParams } from '../../services/viewConfig/ViewStateFactory';
import type { ExportResult } from '../../services/export/ExportService';
import { toCliName } from '../../api/OperationSchemas';

const EXPORT_SPECIFIC_KEYS = new Set(['view', 'template', 'name', 'output-folder', 'filename', 'wait', 'keep-open']);

export function createExportImageHandler(plugin: TaskViewerPlugin) {
    return async (params: CliData): Promise<string> => {
        try {
            // 1. Resolve view type
            const viewType = resolveViewType(params, plugin);
            if (viewType.startsWith('{')) return viewType; // cliError JSON

            if (!exportDescriptorFor(viewType)) {
                return cliError(`View '${params.view ?? viewType}' does not support image export. Supported: timeline, schedule, kanban (calendar is currently unsupported)`);
            }

            // 2. Validate flags: only EXPORT_SPECIFIC_KEYS + valid view-config keys allowed
            const validationErr = validateFlags(params, viewType);
            if (validationErr) return validationErr;

            // 3. Determine mode: open-view vs temp-leaf
            const hasViewConfig = hasConfigParams(params);
            const hasTemplate = !!params.template;

            let result: ExportResult;

            if (!hasViewConfig && !hasTemplate) {
                // Capture the currently open view
                result = await plugin.exportService.exportOpenView(viewType, buildOpts(params));
            } else {
                // Open a temp leaf with specified state
                const configParams = extractConfigParams(params);
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
                result = await plugin.exportService.exportTempView(viewType, buildResult.state, buildOpts(params));
            }

            return cliOk({ ...result });
        } catch (e) {
            return cliError(e instanceof Error ? e.message : String(e));
        }
    };
}

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

/**
 * Extract view-config params, converting kebab-case CLI keys to camelCase
 * (the format that ViewConfigCodec.fromUriParams expects).
 */
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
    };
}
