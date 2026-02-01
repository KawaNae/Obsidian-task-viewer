import { DateUtils } from '../utils/DateUtils';
import { createGhostElement, removeGhostElement } from './GhostFactory';

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
                ghost = createGhostElement(sourceEl, doc, { useCloneNode: true, initiallyVisible: true });
                this.ghosts.set(key, ghost);
            }

            // Find the day column to position against
            // We need to find the column for 'seg.date'
            // This relies on the DOM structure: .day-timeline-column[data-date="YYYY-MM-DD"]
            const dayCol = this.container.querySelector(`.day-timeline-column[data-date="${seg.date}"]`) as HTMLElement;

            if (dayCol) {
                const rect = dayCol.getBoundingClientRect();

                // Position relative to viewport since ghosts are fixed/absolute
                // If createGhostElement uses 'fixed', we add rect.left/top
                ghost.style.left = `${rect.left + 4}px`; // +4px for padding/margin adjustment
                ghost.style.top = `${rect.top + seg.top}px`;
                ghost.style.width = `${rect.width - 8}px`; // -8px for padding
                ghost.style.height = `${seg.height}px`;
                ghost.style.opacity = '0.8';
                ghost.style.display = 'block';
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
