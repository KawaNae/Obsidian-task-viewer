/**
 * The view settings (gear) menu, built once for every view from what the view
 * is (its descriptor) and what it holds (its store).
 *
 * Each toolbar used to spell out the same options — rename, Copy URI, save
 * and load a template, reset, export — reading and writing the view through
 * a bundle of closures. Here they read the store and write it with one
 * patch; the view's answer to the patch (draw, save the layout, retitle the
 * tab) is the base view's (`TaskViewerView`).
 */

import type { App, Menu, WorkspaceLeaf } from 'obsidian';
import type { PluginContext } from '../../PluginContext';
import type { ViewTemplate } from '../../types';
import type { ViewConfigCodec } from '../../services/viewConfig/ViewConfigCodec';
import { readViewConfig } from '../../services/viewConfig/ConfigIssueNotice';
import { exportFolderOf } from '../../services/export/ExportSave';
import type { ViewSettingsOptions } from '../sharedUI/ViewToolbar';
import { viewDisplayName, type ViewDescriptor } from '../ViewDescriptors';
import type { StateSource } from './ViewStore';

/** Every view's config can carry the name the user gave the view. */
export interface NamedConfig {
    customName?: string;
}

/** A view's state: its config and its transient fields, as one value. */
export type ViewStateOf<TConfig, TTransient> = Partial<TConfig> & Partial<TTransient>;

/**
 * The patch that resets a view: its config back to the schema's defaults
 * (REPLACE, so the name and the filter go too), and its transient fields
 * cleared — the collapse of its lists — except the date it looks at, which
 * is where the view is, not how it is set up.
 */
export function resetPatch<C extends object, T extends object>(codec: ViewConfigCodec<C, T>): ViewStateOf<C, T> {
    const patch: Record<string, unknown> = { ...codec.withDefaults({}) };
    for (const key in codec.schema.transient) {
        if (key === codec.schema.anchorKey) continue;
        patch[key] = undefined;
    }
    return patch as ViewStateOf<C, T>;
}

/**
 * The patch that applies a template: its config over the defaults (REPLACE),
 * named after the template when it has a name.
 */
export function templatePatch<C extends NamedConfig, T extends object>(
    codec: ViewConfigCodec<C, T>,
    template: ViewTemplate,
): ViewStateOf<C, T> {
    const config = codec.withDefaults(readViewConfig(codec, template.config ?? null));
    if (template.name) config.customName = template.name;
    return config as ViewStateOf<C, T>;
}

/**
 * A state read as its config: the codec reads only the config's fields. (The
 * compiler cannot see that a part of an intersection of two generic partials
 * is the first.)
 */
export function configOf<C>(state: object): Partial<C> {
    return state as Partial<C>;
}

/** A state read as its transient fields; see {@link configOf}. */
export function transientOf<T>(state: object): Partial<T> {
    return state as Partial<T>;
}

/** What the menu reads of a view. */
export interface SettingsMenuSource<C extends NamedConfig, T extends object> {
    readonly app: App;
    readonly leaf: WorkspaceLeaf;
    readonly plugin: PluginContext;
    readonly descriptor: ViewDescriptor;
    readonly codec: ViewConfigCodec<C, T>;
    readonly store: StateSource<ViewStateOf<C, T>>;
}

/**
 * The options of the settings menu of the view `source` describes. The
 * template items are there when the view keeps templates (a template is
 * saved under the view's own short name); the export item is there when the
 * view exports an image.
 *
 * @param appendCustomItems the toolbar's own items, put above the shared block
 */
export function buildViewSettingsOptions<C extends NamedConfig, T extends object>(
    source: SettingsMenuSource<C, T>,
    appendCustomItems?: (menu: Menu) => void,
): ViewSettingsOptions {
    const { app, leaf, plugin, descriptor, codec, store } = source;
    const customName = () => store.get().customName;
    const defaultName = () => viewDisplayName(descriptor.type);
    return {
        app,
        leaf,
        getCustomName: customName,
        getDefaultName: defaultName,
        onRename: (name) => store.update({ customName: name } as ViewStateOf<C, T>),
        buildUri: () => ({ configParams: codec.toUriParams(configOf<C>(store.get())) }),
        viewType: descriptor.type,
        templates: descriptor.hasTemplates ? {
            getFolder: () => plugin.settings.viewTemplateFolder,
            notes: plugin.getOperations(),
            getViewTemplate: () => ({
                filePath: '',
                name: customName() || defaultName(),
                viewType: descriptor.shortName,
                config: codec.serializeConfig(configOf<C>(store.get())),
            }),
            onApply: (template) => store.update(templatePatch(codec, template)),
        } : undefined,
        onReset: () => store.update(resetPatch(codec)),
        getExportFolder: descriptor.exportable ? () => exportFolderOf(plugin.settings) : undefined,
        menuPresenter: plugin.menuPresenter,
        appendCustomItems,
    };
}
