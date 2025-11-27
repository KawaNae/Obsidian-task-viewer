export class ColorUtils {
    static hexToHSL(hex: string): { h: number, s: number, l: number } | null {
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
}
