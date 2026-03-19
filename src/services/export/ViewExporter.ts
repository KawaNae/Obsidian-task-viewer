import { Notice } from 'obsidian';
import type { TaskIndex } from '../core/TaskIndex';
import { TaskIdGenerator } from '../../utils/TaskIdGenerator';

export interface ViewExportOptions {
    container: HTMLElement;
    taskIndex: TaskIndex;
    filename: string;
}

export class ViewExporter {
    static async exportAsPng(options: ViewExportOptions): Promise<void> {
        const { container, taskIndex, filename } = options;

        const progress = new Notice('Exporting image…', 0);
        const restoreFns: (() => void)[] = [];

        try {
            this.tempExpandScrollAreas(container, restoreFns);
            this.tempApplyMasking(container, taskIndex, restoreFns);

            const { toBlob } = await import('html-to-image');
            const blob = await toBlob(container, {
                pixelRatio: 2,
                backgroundColor: undefined,
                filter: (node: Element) => {
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
                    // Remove selection state from cloned nodes
                    if (node.classList?.contains('selected') && node.classList?.contains('task-card')) {
                        node.classList.remove('selected');
                    }
                    return true;
                },
            });

            if (!blob) throw new Error('Failed to create blob');
            this.downloadBlob(blob, filename);
            progress.hide();
            new Notice('Image exported.');
        } catch (err) {
            console.error('[ViewExporter] Export failed:', err);
            progress.hide();
            new Notice('Export failed. See console for details.');
        } finally {
            for (const restore of restoreFns) restore();
        }
    }

    /** Temporarily expand scroll containers so full content is captured. */
    private static tempExpandScrollAreas(container: HTMLElement, restoreFns: (() => void)[]): void {
        // スクロール領域を展開（Schedule 側セレクタ修正: .schedule-scroll-area → .schedule-view__body-scroll）
        const scrollAreas = Array.from(
            container.querySelectorAll<HTMLElement>('.timeline-scroll-area, .schedule-view__body-scroll')
        );
        for (const area of scrollAreas) {
            const origOverflow = area.style.overflow;
            const origHeight = area.style.height;
            area.style.overflow = 'visible';
            area.style.height = `${area.scrollHeight}px`;
            restoreFns.push(() => {
                area.style.overflow = origOverflow;
                area.style.height = origHeight;
            });
        }

        // 親コンテナチェーンの overflow: hidden と高さ制約を一時解除
        const overflowParents = Array.from(
            container.querySelectorAll<HTMLElement>(
                '.timeline-view, .timeline-grid, .schedule-view, .schedule-view__body-scroll'
            )
        );
        const targets = new Set([...overflowParents, container]);

        for (const el of targets) {
            const computed = getComputedStyle(el);
            if (computed.overflow === 'hidden' || computed.overflowY === 'hidden' || computed.overflowY === 'scroll' || computed.overflowY === 'auto') {
                const origOverflow = el.style.overflow;
                const origHeight = el.style.height;
                el.style.overflow = 'visible';
                el.style.height = 'auto';
                restoreFns.push(() => {
                    el.style.overflow = origOverflow;
                    el.style.height = origHeight;
                });
            }
        }
    }

    /** Temporarily replace task content with mask text for masking. */
    private static tempApplyMasking(container: HTMLElement, taskIndex: TaskIndex, restoreFns: (() => void)[]): void {
        const cards = Array.from(container.querySelectorAll<HTMLElement>('.task-card'));
        for (const card of cards) {
            const taskId = card.dataset.id;
            if (!taskId) continue;

            const segment = TaskIdGenerator.parseSegmentId(taskId);
            const resolvedId = segment ? segment.baseId : taskId;
            const task = taskIndex.getTask(resolvedId);
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

    /**
     * Replace text nodes in a list item with mask text.
     * Returns saved state for restoration.
     */
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

    /** Hide file links and return saved state for restoration. */
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

    private static downloadBlob(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}
