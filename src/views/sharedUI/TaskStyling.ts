import { VALID_LINE_STYLES } from '../../constants/style';

/**
 * Task accent color and line style DOM utilities.
 * Applies CSS custom properties to task elements.
 */
export class TaskStyling {

    private static hexToHSL(hex: string): { h: number, s: number, l: number } | null {
        // Accept both 'ff0000' and '#ff0000'
        const normalized = hex.startsWith('#') ? hex : '#' + hex;

        let r = 0, g = 0, b = 0;
        if (normalized.length === 4) {
            r = parseInt('0x' + normalized[1] + normalized[1]);
            g = parseInt('0x' + normalized[2] + normalized[2]);
            b = parseInt('0x' + normalized[3] + normalized[3]);
        } else if (normalized.length === 7) {
            r = parseInt('0x' + normalized[1] + normalized[2]);
            g = parseInt('0x' + normalized[3] + normalized[4]);
            b = parseInt('0x' + normalized[5] + normalized[6]);
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
        const normalized = VALID_LINE_STYLES.has(linestyle) ? linestyle : 'solid';
        el.style.setProperty('--file-linestyle', normalized);
        el.dataset.fileLinestyle = normalized;
    }

    static applyReadOnly(el: HTMLElement, task: { isReadOnly?: boolean }): void {
        if (task.isReadOnly) el.dataset.readOnly = 'true';
    }
}
