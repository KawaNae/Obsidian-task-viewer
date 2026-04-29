import { DateUtils } from '../../../utils/DateUtils';
import { createGhostElement, removeGhostElement } from './GhostFactory';
import { toDisplayHeightPx, toDisplayTopPx } from '../../../views/sharedLogic/TimelineCardPosition';

export interface GhostSegment {
    date: string;       // YYYY-MM-DD
    top: number;        // pixels relative to column top
    height: number;     // pixels
}

/**
 * Manages multiple ghost elements for split task visualization during drag.
 */
export class GhostManager {
    private ghosts: Map<string, HTMLElement> = new Map();
    private container: HTMLElement;

    constructor(container: HTMLElement) {
        this.container = container;
    }

    /**
     * Update ghosts based on calculated segments.
     * @param segments List of segments to display
     * @param sourceEl Original element to clone styles from
     */
    update(segments: GhostSegment[], sourceEl: HTMLElement) {
        const neededKeys = new Set<string>();

        segments.forEach((seg, index) => {
            const key = `ghost-${index}`; // Simple indexing for now
            neededKeys.add(key);

            let ghost = this.ghosts.get(key);

            if (!ghost) {
                // Create new ghost if doesn't exist
                const doc = this.container.ownerDocument || document;
                ghost = createGhostElement(
                    sourceEl,
                    doc,
                    { useCloneNode: true, initiallyVisible: true },
                    this.container
                );
                this.ghosts.set(key, ghost);
            }

            // Find the day column to position against
            // We need to find the column for 'seg.date'
            // This relies on the DOM structure: .day-timeline-column[data-date="YYYY-MM-DD"]
            const dayCol = this.container.querySelector(`.day-timeline-column[data-date="${seg.date}"]`) as HTMLElement;

            if (dayCol) {
                // Account for border-top of day-timeline-column
                // For absolute-positioned ghosts in .timeline-grid (the scroll container),
                // use container-relative offsets.
                const computedStyle = window.getComputedStyle(dayCol);
                const borderTop = parseFloat(computedStyle.borderTopWidth || '0');

                // Position relative to .timeline-grid (the scroll container).
                // seg.top/seg.height are logical values and converted to display values here.
                // left/width はソースカードの cascade レイアウト (TimelineSectionRenderer の
                // calc((100% - 8px) * widthFraction) / calc(4px + (100% - 8px) * leftFraction))
                // に揃える。dayCol 全幅で出すと level≥2 の重なりカードと右端が合わず、
                // drag 開始時に「右に伸びる」見た目になる。
                // sourceEl.offsetLeft/Width は drag-hidden (opacity:0) でも layout 値を返す。
                ghost.style.left = `${dayCol.offsetLeft + sourceEl.offsetLeft}px`;
                ghost.style.top = `${dayCol.offsetTop + borderTop + toDisplayTopPx(seg.top)}px`;
                ghost.style.width = `${sourceEl.offsetWidth}px`;
                ghost.style.height = `${toDisplayHeightPx(seg.height)}px`;
                ghost.classList.remove('drag-hidden');
                ghost.style.display = 'block';

                // --- Manage Split Classes and Inline Styles Dynamically ---
                // Remove relevant classes inherited from sourceEl
                ghost.classList.remove('task-card--split', 'task-card--split-continues-before', 'task-card--split-continues-after');

                // Reset split-related inline styles (GhostFactory sets these, which override CSS classes)
                ghost.style.borderTop = '';
                ghost.style.borderBottom = '';
                ghost.style.borderTopLeftRadius = '';
                ghost.style.borderTopRightRadius = '';
                ghost.style.borderBottomLeftRadius = '';
                ghost.style.borderBottomRightRadius = '';

                if (segments.length > 1) {
                    ghost.classList.add('task-card--split');

                    // Get accent color for dashed border
                    const accentColor = getComputedStyle(sourceEl).getPropertyValue('--file-accent').trim()
                        || getComputedStyle(document.documentElement).getPropertyValue('--interactive-accent').trim()
                        || '#7c3aed';

                    const isFirst = index === 0;
                    const isLast = index === segments.length - 1;

                    if (!isFirst) {
                        // Continues before (top cut)
                        ghost.classList.add('task-card--split-continues-before');
                        ghost.style.borderTop = `2px dashed ${accentColor}`;
                        ghost.style.borderTopLeftRadius = '0';
                        ghost.style.borderTopRightRadius = '0';
                    }
                    if (!isLast) {
                        // Continues after (bottom cut)
                        ghost.classList.add('task-card--split-continues-after');
                        ghost.style.borderBottom = `2px dashed ${accentColor}`;
                        ghost.style.borderBottomLeftRadius = '0';
                        ghost.style.borderBottomRightRadius = '0';
                    }
                }
            } else {
                // Column not found (e.g. scrolled out of view or not rendered)
                // Hide ghost for now
                ghost.style.display = 'none';
            }
        });

        // Cleanup unused ghosts
        for (const key of this.ghosts.keys()) {
            if (!neededKeys.has(key)) {
                const ghost = this.ghosts.get(key);
                removeGhostElement(ghost || null);
                this.ghosts.delete(key);
            }
        }
    }

    /**
     * Clear all ghosts
     */
    clear() {
        this.ghosts.forEach(ghost => removeGhostElement(ghost));
        this.ghosts.clear();
    }
}
