/**
 * Type extensions for Obsidian internal/undocumented APIs used by this plugin.
 * These APIs are stable and widely used but not included in the official type definitions.
 */
import 'obsidian';

declare module 'obsidian' {
    interface FileManager {
        /** Process frontmatter of a file atomically. Available since Obsidian v1.4.0. */
        processFrontMatter(file: TFile, fn: (frontmatter: Record<string, unknown>) => void): Promise<void>;
    }

    interface WorkspaceLeaf {
        /** Update the leaf's header text (tab title). Internal API, stable. */
        updateHeader(): void;
    }

    interface MenuItem {
        /** Create a submenu under this menu item. Internal API, stable. */
        setSubmenu(): Menu;
        /** The DOM element for this menu item. Internal API. */
        dom: HTMLElement;
        /** The submenu Menu instance (after setSubmenu()). Internal API. */
        submenu: Menu;
    }
}
