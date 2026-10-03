import type { App } from 'obsidian';
import { ViewTemplateLoader } from '../template/ViewTemplateLoader';
import { codecFor } from './index';
import { descriptorOf } from '../../views/ViewDescriptors';
import type { ConfigIssue } from './ViewConfigSchema';

export interface BuildViewStateResult {
    state: Record<string, unknown>;
    templateNotFound?: string;
    /** What the template or the params held that could not be read, and was dropped. */
    issues: ConfigIssue[];
}

/**
 * Build the canonical workspace-state dict for `setViewState` from
 * a view type + flat params dict. Merges:
 *   schema defaults (via codec REPLACE inside the view's setState)
 *   ← template config ← params overrides.
 *
 * Shared by URI handler and CLI export-image. A view that keeps no templates
 * (the timer) reads no `template` param.
 */
export async function buildViewStateFromParams(
    app: App,
    viewTemplateFolder: string,
    viewType: string,
    params: Record<string, string>,
): Promise<BuildViewStateResult> {
    const codec = codecFor(viewType);
    if (!codec) return { state: {}, issues: [] };

    let baseConfig: Record<string, unknown> = {};
    let baseName: string | undefined;
    let templateNotFound: string | undefined;

    if (params.template && descriptorOf(viewType)?.hasTemplates) {
        const loader = new ViewTemplateLoader(app);
        const summary = loader.findByBasename(viewTemplateFolder, params.template);
        if (summary) {
            const tmpl = await loader.loadFullTemplate(summary.filePath);
            if (tmpl) {
                baseConfig = tmpl.config ?? {};
                baseName = tmpl.name;
            }
        } else {
            templateNotFound = params.template;
        }
    }

    const issues: ConfigIssue[] = [];
    const baseParsed = codec.parseConfig(baseConfig, issues);
    const uriParsed = codec.fromUriParams(params, issues);
    const mergedConfig = { ...baseParsed, ...uriParsed };

    if (params.name) {
        (mergedConfig as Record<string, unknown>).customName = params.name;
    } else if (baseName && (mergedConfig as Record<string, unknown>).customName === undefined) {
        (mergedConfig as Record<string, unknown>).customName = baseName;
    }

    const transientSeed = codec.parseTransient(params);
    const state = {
        ...codec.serializeConfig(mergedConfig),
        ...codec.serializeTransient(transientSeed),
    };

    return { state, templateNotFound, issues };
}
