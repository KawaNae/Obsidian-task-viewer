
type RestoreFn = () => void;

/**
 * Shared export utilities: make the clone show what the view shows and expand
 * it so the full content is captured, plus capture/download helpers. The previous visible-area simulation
 * (margin-top trick on the first non-sticky child) is gone — OS screenshot is
 * the right tool for "the pixels currently on screen", and masking is now a
 * render-time concern handled by TaskCardRenderer rather than a clone-walk.
 */
export class ExportUtils {
    /**
     * Draw each canvas under `source` into its counterpart under `clone`, a
     * deep clone of `source` made just before: a cloned canvas keeps its size
     * but not its picture, so a chart in the view would be captured empty.
     * Canvases pair up in document order, as the clone has them.
     *
     * A canvas that cannot be copied is left empty in the clone, and the rest
     * of the export goes on:
     * - one of no width or height, which `drawImage` refuses
     * - one holding a picture from another origin: drawn, it would taint the
     *   clone's canvas, and capturing that canvas would throw, failing the
     *   whole export, so it is replaced with an empty one
     * - a WebGL canvas whose buffer is not kept after it is shown is drawn as
     *   it reads then, which may be empty
     */
    static copyCanvases(source: HTMLElement, clone: HTMLElement): void {
        const originals = source.querySelectorAll('canvas');
        const copies = clone.querySelectorAll('canvas');
        if (originals.length !== copies.length) return;
        originals.forEach((original, i) => {
            const copy = copies[i];
            if (original.width === 0 || original.height === 0) return;
            const ctx = copy.getContext('2d');
            if (!ctx) return;
            try {
                ctx.drawImage(original, 0, 0);
                // Reading a pixel throws on a tainted canvas.
                ctx.getImageData(0, 0, 1, 1);
            } catch {
                copy.replaceWith(copy.cloneNode(false));
            }
        });
    }

    /** Expand a single scroll area to its full scrollHeight. */
    static expandScrollArea(area: HTMLElement, restoreFns: RestoreFn[]): void {
        const origOverflow = area.style.overflow;
        const origHeight = area.style.height;
        const origScrollTop = area.scrollTop;
        area.style.overflow = 'visible';
        area.style.height = `${area.scrollHeight}px`;
        restoreFns.push(() => {
            area.style.overflow = origOverflow;
            area.style.height = origHeight;
            area.scrollTop = origScrollTop;
        });
    }

    /** Remove overflow constraints from parent elements matching the given selectors. */
    static expandOverflowParents(container: HTMLElement, selectors: string, restoreFns: RestoreFn[]): void {
        const parents = Array.from(container.querySelectorAll<HTMLElement>(selectors));
        // Include the container itself so callers can pass the container's own
        // class without relying on querySelectorAll's descendant-only semantics.
        const targets = new Set([...parents, container]);

        for (const el of targets) {
            const computed = getComputedStyle(el);
            if (computed.overflow === 'hidden' || computed.overflowY === 'hidden' ||
                computed.overflowY === 'scroll' || computed.overflowY === 'auto') {
                const origOverflow = el.style.overflow;
                const origHeight = el.style.height;
                const origScrollTop = el.scrollTop;
                el.style.overflow = 'visible';
                el.style.height = 'auto';
                restoreFns.push(() => {
                    el.style.overflow = origOverflow;
                    el.style.height = origHeight;
                    el.scrollTop = origScrollTop;
                });
            }
        }
    }

    /** Remove flex height constraints from the export container. */
    static expandContainer(container: HTMLElement, restoreFns: RestoreFn[]): void {
        const origHeight = container.style.height;
        const origMinHeight = container.style.minHeight;
        container.style.height = 'auto';
        container.style.minHeight = 'auto';
        restoreFns.push(() => {
            container.style.height = origHeight;
            container.style.minHeight = origMinHeight;
        });
    }

    /** html-to-image filter: excludes handles, toolbar, time indicator, expand bar. */
    static getExportFilter(): (node: Element) => boolean {
        return (node: Element) => {
            if (!(node instanceof HTMLElement)) return true;
            const cls = node.className;
            if (typeof cls === 'string') {
                if (cls.includes('task-card__handle') ||
                    cls.includes('current-time-indicator') ||
                    cls.includes('task-card__expand-bar') ||
                    cls.includes('toolbar-host')) {
                    return false;
                }
            }
            if (node.classList?.contains('is-selected') && node.classList?.contains('task-card')) {
                node.classList.remove('is-selected');
            }
            return true;
        };
    }

    /** Capture a container to a Blob using html-to-image. */
    static async captureToBlob(container: HTMLElement): Promise<Blob> {
        const { toBlob } = await import('html-to-image');
        const blob = await toBlob(container, {
            pixelRatio: 2,
            backgroundColor: undefined,
            filter: this.getExportFilter(),
            style: {
                position: 'static',
                left: 'auto',
                top: 'auto',
            },
        });
        if (!blob) throw new Error('Failed to create blob');
        return blob;
    }
}
