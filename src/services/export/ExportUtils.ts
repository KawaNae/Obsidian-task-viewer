import { Notice, type App, TFile } from 'obsidian';
import type { TaskReadService } from '../data/TaskReadService';
import { TaskIdGenerator } from '../display/TaskIdGenerator';

type RestoreFn = () => void;

/**
 * Shared export utilities used by all view-specific export strategies.
 */
export class ExportUtils {
    // ── Scroll area helpers ──

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

    /** Simulate scroll position by shifting the first non-sticky child. */
    static simulateScroll(area: HTMLElement, restoreFns: RestoreFn[]): void {
        const scrollTop = area.scrollTop;
        if (scrollTop <= 0) return;

        const origOverflow = area.style.overflow;
        area.style.overflow = 'hidden';
        restoreFns.push(() => { area.style.overflow = origOverflow; area.scrollTop = scrollTop; });

        const children = Array.from(area.children) as HTMLElement[];
        for (const child of children) {
            if (getComputedStyle(child).position === 'sticky') continue;
            const origMargin = child.style.marginTop;
            child.style.marginTop = `-${scrollTop}px`;
            restoreFns.push(() => { child.style.marginTop = origMargin; });
            break;
        }
    }

    // ── Clone helpers ──

    /** Transfer scrollTop values from original to clone for matching elements. */
    static transferScrollPositions(original: HTMLElement, clone: HTMLElement, selector: string): void {
        const origAreas = Array.from(original.querySelectorAll<HTMLElement>(selector));
        const cloneAreas = Array.from(clone.querySelectorAll<HTMLElement>(selector));
        for (let i = 0; i < origAreas.length && i < cloneAreas.length; i++) {
            cloneAreas[i].scrollTop = origAreas[i].scrollTop;
        }
    }

    // ── Capture helpers ──

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
            if (node.classList?.contains('selected') && node.classList?.contains('task-card')) {
                node.classList.remove('selected');
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

    /** Save a Blob to the vault as a binary file. */
    static async downloadBlob(blob: Blob, filename: string, app: App): Promise<void> {
        const buffer = await blob.arrayBuffer();
        const folder = 'task-viewer-export';
        if (!app.vault.getAbstractFileByPath(folder)) {
            await app.vault.createFolder(folder);
        }
        const filePath = `${folder}/${filename}`;
        const existing = app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
            await app.vault.modifyBinary(existing, buffer);
        } else {
            await app.vault.createBinary(filePath, buffer);
        }
        new Notice(`Image saved to ${filePath}`);
    }

    // ── Masking ──

    /** Temporarily replace task content with mask text for export. */
    static applyMasking(container: HTMLElement, readService: TaskReadService, restoreFns: RestoreFn[]): void {
        const cards = Array.from(container.querySelectorAll<HTMLElement>('.task-card'));
        for (const card of cards) {
            const taskId = card.dataset.id;
            if (!taskId) continue;

            const segment = TaskIdGenerator.parseSegmentId(taskId);
            const resolvedId = segment ? segment.baseId : taskId;
            const task = readService.getTask(resolvedId);
            if (!task?.mask) continue;

            const contentEl = card.querySelector('.task-card__content');
            if (!contentEl) continue;

            const listItem = contentEl.querySelector('.task-list-item');
            if (!listItem) continue;

            const savedTexts = this.replaceTextContent(listItem, task.mask);
            const savedLinks = this.hideFileLinks(listItem);
            restoreFns.push(() => {
                this.restoreTextContent(savedTexts);
                this.restoreFileLinks(savedLinks);
            });
        }
    }

    private static replaceTextContent(listItem: Element, mask: string): { node: Text; original: string }[] {
        const saved: { node: Text; original: string }[] = [];
        let replaced = false;
        const walker = document.createTreeWalker(listItem, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
            textNodes.push(node);
        }

        for (const textNode of textNodes) {
            const parent = textNode.parentElement;
            if (parent?.closest('.task-card__time, .task-card__child-notation, input')) continue;
            if (parent?.closest('.internal-link')) continue;

            if (!replaced && textNode.textContent?.trim()) {
                saved.push({ node: textNode, original: textNode.textContent });
                textNode.textContent = mask;
                replaced = true;
            } else if (replaced && textNode.textContent?.trim()) {
                saved.push({ node: textNode, original: textNode.textContent });
                textNode.textContent = '';
            }
        }
        return saved;
    }

    private static restoreTextContent(saved: { node: Text; original: string }[]): void {
        for (const { node, original } of saved) {
            node.textContent = original;
        }
    }

    private static hideFileLinks(listItem: Element): { el: HTMLElement; origDisplay: string; prevNode: Text | null; prevText: string }[] {
        const saved: { el: HTMLElement; origDisplay: string; prevNode: Text | null; prevText: string }[] = [];
        const links = Array.from(listItem.querySelectorAll<HTMLElement>('.internal-link'));
        for (const link of links) {
            const origDisplay = link.style.display;
            link.style.display = 'none';

            let prevNode: Text | null = null;
            let prevText = '';
            const prev = link.previousSibling;
            if (prev?.nodeType === Node.TEXT_NODE && prev.textContent?.includes(':')) {
                prevNode = prev as Text;
                prevText = prev.textContent;
                prev.textContent = '';
            }

            saved.push({ el: link, origDisplay, prevNode, prevText });
        }
        return saved;
    }

    private static restoreFileLinks(saved: { el: HTMLElement; origDisplay: string; prevNode: Text | null; prevText: string }[]): void {
        for (const { el, origDisplay, prevNode, prevText } of saved) {
            el.style.display = origDisplay;
            if (prevNode) prevNode.textContent = prevText;
        }
    }
}
