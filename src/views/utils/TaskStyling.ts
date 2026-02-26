import { App } from 'obsidian';

/**
 * Task accent color and line style utilities.
 * Reads file frontmatter for color/linestyle and applies CSS custom properties to task elements.
 */
export class TaskStyling {
    private static readonly VALID_LINE_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'dashdotted']);

    private static hexToHSL(hex: string): { h: number, s: number, l: number } | null {
        if (!hex.startsWith('#')) return null;

        let r = 0, g = 0, b = 0;
        if (hex.length === 4) {
            r = parseInt('0x' + hex[1] + hex[1]);
            g = parseInt('0x' + hex[2] + hex[2]);
            b = parseInt('0x' + hex[3] + hex[3]);
        } else if (hex.length === 7) {
            r = parseInt('0x' + hex[1] + hex[2]);
            g = parseInt('0x' + hex[3] + hex[4]);
            b = parseInt('0x' + hex[5] + hex[6]);
        } else {
            return null;
        }

        if (isNaN(r) || isNaN(g) || isNaN(b)) return null;

        r /= 255;
        g /= 255;
        b /= 255;

        const cmin = Math.min(r, g, b);
        const cmax = Math.max(r, g, b);
        const delta = cmax - cmin;
        let h = 0, s = 0, l = 0;

        if (delta === 0) h = 0;
        else if (cmax === r) h = ((g - b) / delta) % 6;
        else if (cmax === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;

        h = Math.round(h * 60);
        if (h < 0) h += 360;

        l = (cmax + cmin) / 2;
        s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

        s = +(s * 100).toFixed(1);
        l = +(l * 100).toFixed(1);

        return { h, s, l };
    }

    /**
     * Gets the custom color for a file from its frontmatter.
     */
    static getFileColor(app: App, filePath: string, frontmatterKey: string | null): string | null {
        if (!frontmatterKey) return null;

        const cache = app.metadataCache.getCache(filePath);
        return cache?.frontmatter?.[frontmatterKey] || null;
    }

    /**
     * Gets the custom line style for a file from its frontmatter.
     * Returns null when the key is missing or the value is invalid.
     */
    static getFileLinestyle(app: App, filePath: string, frontmatterKey: string | null): string | null {
        if (!frontmatterKey) return null;

        const cache = app.metadataCache.getCache(filePath);
        const value = cache?.frontmatter?.[frontmatterKey];
        if (typeof value !== 'string') return null;

        const normalized = value.trim().toLowerCase();
        if (!normalized) return null;

        return TaskStyling.VALID_LINE_STYLES.has(normalized) ? normalized : null;
    }

    /**
     * Applies a file-based accent color to a task element.
     * Sets CSS custom properties for the accent color (HSL format for flexibility).
     */
    static applyTaskColor(el: HTMLElement, color: string | null): void {
        if (!color) return;

        const hsl = TaskStyling.hexToHSL(color);
        if (hsl) {
            const { h, s, l } = hsl;
            el.style.setProperty('--accent-h', h.toString());
            el.style.setProperty('--accent-s', s + '%');
            el.style.setProperty('--accent-l', l + '%');

            el.style.setProperty('--color-accent-hsl', `var(--accent-h), var(--accent-s), var(--accent-l)`);
            el.style.setProperty('--file-accent', `hsl(var(--accent-h), var(--accent-s), var(--accent-l))`);
            el.style.setProperty('--file-accent-hover', `hsl(calc(var(--accent-h) - 1), calc(var(--accent-s) * 1.01), calc(var(--accent-l) * 1.075))`);
        } else {
            // Fallback for named colors or invalid hex
            el.style.setProperty('--file-accent', color);
            el.style.setProperty('--file-accent-hover', color);
        }
    }

    /**
     * Applies task accent line style to CSS variable.
     * Null means no linestyle — the default ::before (transparent) is used.
     */
    static applyTaskLinestyle(el: HTMLElement, linestyle: string | null): void {
        if (!linestyle) return;
        const normalized = TaskStyling.VALID_LINE_STYLES.has(linestyle) ? linestyle : 'solid';
        el.style.setProperty('--file-linestyle', normalized);
        el.dataset.fileLinestyle = normalized;
    }

    /**
     * Convenience method that combines getFileColor and applyTaskColor.
     */
    static applyFileColor(app: App, el: HTMLElement, filePath: string, frontmatterKey: string | null): void {
        const color = TaskStyling.getFileColor(app, filePath, frontmatterKey);
        TaskStyling.applyTaskColor(el, color);
    }

    /**
     * Convenience method that combines getFileLinestyle and applyTaskLinestyle.
     */
    static applyFileLinestyle(app: App, el: HTMLElement, filePath: string, frontmatterKey: string | null): void {
        const linestyle = TaskStyling.getFileLinestyle(app, filePath, frontmatterKey);
        TaskStyling.applyTaskLinestyle(el, linestyle);
    }
}
