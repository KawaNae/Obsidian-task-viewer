import type { CliData } from 'obsidian';
import type { PluginContext } from '../../PluginContext';
import type { ExportHost, ExportOptions } from '../../services/export/ExportService';
import { cliOk, cliError } from '../CliOutputFormatter';
import { resolveViewTypeFromShortName, schemaFor } from '../../services/viewConfig';
import type { ConfigField } from '../../services/viewConfig/ViewConfigSchema';
import { IntInput } from '../../utils/values/NumberValues';
import { issueText } from '../../utils/values/IssueText';
import { exportDescriptorFor } from '../../services/export/ExportRegistry';
import { ViewTemplateLoader } from '../../services/template/ViewTemplateLoader';
import { buildViewStateFromParams } from '../../services/viewConfig/ViewStateFactory';
import type { ExportResult } from '../../services/export/ExportService';
import { toCliName } from '../../api/OperationSchemas';
import { MIN_DAYS_TO_SHOW, MAX_DAYS_TO_SHOW } from '../../views/timelineview/TimelineSchema';

const EXPORT_SPECIFIC_KEYS = new Set([
    'view', 'template', 'name', 'output-folder', 'filename', 'wait', 'keep-open', 'width',
    'anchor-date',
]);

/**
 * The handler checks its own flags: they are the export's and those of the
 * view it exports, known only once the view is (`validateFlags`). An error
 * it throws is the registrar's to turn into a cliError.
 */
export function createExportImageHandler(plugin: PluginContext & ExportHost) {
    return async (params: CliData): Promise<string> => {
        // 1. Resolve view type
        const resolution = resolveViewType(params, plugin);
        if ('error' in resolution) return resolution.error;
        const { viewType } = resolution;

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

        // 3b. Validate days-to-show against the same schema field the
        // actual render reads, so an out-of-range flag fails fast instead
        // of silently falling back to the default.
        const daysToShowErr = validateDaysToShow(resolvedParams, viewType);
        if (daysToShowErr) return daysToShowErr;

        // 4. Validate filename if user-specified
        const filenameErr = validateFilename(resolvedParams);
        if (filenameErr) return filenameErr;

        // 4b. Read the export's own flags; a number flag that is not one fails.
        const opts = readExportOptions(resolvedParams);
        if (typeof opts === 'string') return opts;

        // 5. Determine mode: open-view vs temp-leaf
        const hasViewConfig = hasConfigParams(resolvedParams);
        const hasTemplate = !!resolvedParams.template;

        let result: ExportResult;

        if (!hasViewConfig && !hasTemplate) {
            result = await plugin.exportService.exportOpenView(viewType, opts);
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
            // As the API refuses a filter it cannot read whole, the export
            // refuses to draw a view on less than its template and flags say.
            if (buildResult.issues.length > 0) {
                return cliError(`Cannot read the view's config: ${buildResult.issues.map(i => `${i.field} ${i.text}`).join('; ')}`);
            }
            result = await plugin.exportService.exportTempView(viewType, buildResult.state, opts);
        }

        const { renderedRange, ...rest } = result;
        return cliOk({
            ...rest,
            ...(renderedRange ? {
                resolvedAnchor: renderedRange.anchor,
                renderedRange: { from: renderedRange.from, to: renderedRange.to },
            } : {}),
        });
    };
}

// ── Anchor date resolution ──

interface AnchorResult {
    params: CliData;
    error: string | null;
}

function resolveAnchorDate(params: CliData, viewType: string): AnchorResult {
    const anchorValue = params['anchor-date'];
    if (!anchorValue) return { params, error: null };

    const schema = schemaFor(viewType);
    const anchorKey = schema?.anchorKey;
    if (!anchorKey) {
        return {
            params,
            error: cliError(`View '${viewType}' has no date anchor. anchor-date= is not supported for this view type`),
        };
    }

    const cliKey = toCliName(anchorKey);
    if (params[cliKey] && params[cliKey] !== anchorValue) {
        return {
            params,
            error: cliError(`Conflicting date flags: anchor-date=${anchorValue} and ${cliKey}=${params[cliKey]}. Use one or the other`),
        };
    }

    const copy = { ...params, [cliKey]: anchorValue };
    delete copy['anchor-date'];
    return { params: copy, error: null };
}

// ── Existing helpers ──

/** The view an export is of, or the cliError saying why there is none. */
type ViewTypeResolution = { viewType: string } | { error: string };

function resolveViewType(params: CliData, plugin: PluginContext & ExportHost): ViewTypeResolution {
    if (params.view) {
        const resolved = resolveViewTypeFromShortName(params.view);
        if (!resolved) return { error: cliError(`Unknown view: '${params.view}'. Use: timeline, calendar, schedule, kanban`) };
        return { viewType: resolved };
    }
    if (params.template) {
        const loader = new ViewTemplateLoader(plugin.app);
        const summary = loader.findByBasename(plugin.settings.viewTemplateFolder, params.template);
        if (summary) {
            const resolved = resolveViewTypeFromShortName(summary.viewType);
            if (resolved) return { viewType: resolved };
        }
        const available = listTemplateNames(plugin);
        return { error: cliError(`Template '${params.template}' not found or has no valid view type. Available: ${available || '(none)'}`) };
    }
    const available = listTemplateNames(plugin);
    const templateHint = available ? ` Available templates: ${available}` : '';
    return { error: cliError(`Missing required flag: view= or template=. Specify the view to export (view=timeline|calendar|schedule|kanban) or a saved template name.${templateHint}`) };
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

/**
 * Reads the `daysToShow` field's own `fromUriParam` off the resolved schema —
 * the same parser `codec.fromUriParams` uses for the actual render — so
 * upfront validation can't drift from what the render itself would accept.
 */
export function parseDaysToShow(schema: ReturnType<typeof schemaFor>, raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const field = (schema?.config as Record<string, ConfigField<unknown>> | undefined)?.daysToShow;
    const parsed = field?.fromUriParam?.(raw);
    return typeof parsed === 'number' ? parsed : undefined;
}

export function validateDaysToShow(params: CliData, viewType: string): string | null {
    const raw = params['days-to-show'];
    if (raw === undefined) return null;
    const schema = schemaFor(viewType);
    if (schema?.shortName !== 'timeline') return null;
    if (parseDaysToShow(schema, raw) === undefined) {
        return cliError(`Invalid days-to-show: '${raw}'. Must be an integer between ${MIN_DAYS_TO_SHOW} and ${MAX_DAYS_TO_SHOW}`);
    }
    return null;
}

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/;

function validateFilename(params: CliData): string | null {
    const fn = params.filename;
    if (!fn) return null;
    const match = fn.match(INVALID_FILENAME_CHARS);
    if (match) {
        return cliError(`Invalid filename '${fn}': character '${match[0]}' is not allowed in filenames`);
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

function listTemplateNames(plugin: PluginContext & ExportHost): string {
    const loader = new ViewTemplateLoader(plugin.app);
    return loader.loadTemplates(plugin.settings.viewTemplateFolder).map(s => s.name).join(', ');
}

function fromCliName(kebab: string): string {
    return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * The export's options from its own flags. `width` and `wait` are whole
 * decimal numbers in range (`IntInput`, as the view's numbers are): a flag
 * that is given but is not one is a cliError, not NaN passed on and not the
 * default put in its place.
 */
export function readExportOptions(params: CliData): ExportOptions | string {
    const read = (flag: 'width' | 'wait', min: number): number | string | undefined => {
        const raw = params[flag];
        if (raw === undefined) return undefined;
        const n = IntInput.read(raw, { min });
        return n.ok ? n.value : cliError(issueText(n.issue, flag, raw));
    };
    const width = read('width', 1);
    if (typeof width === 'string') return width;
    const waitMs = read('wait', 0);
    if (typeof waitMs === 'string') return waitMs;
    return {
        folder: params['output-folder'] || undefined,
        filename: params.filename || undefined,
        name: params.name || params.template || undefined,
        waitMs,
        keepOpen: params['keep-open'] === 'true',
        width,
    };
}
