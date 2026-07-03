import { t } from '../../i18n';
import { attachMoonPhase } from './AstronomyCellAdorner';

/**
 * Timeline-specific grid row renderer for the moon phase strip. Sits below
 * the date header. Calendar / Schedule reach the same
 * underlying SVG by calling `attachMoonPhase` directly on their own day cells
 * — only Timeline benefits from a dedicated axis row, so this renderer stays
 * Timeline-only.
 */
export class MoonPhaseRenderer {
    /**
     * @param container `tv-grid-row moon-section` div created by GridRenderer.
     * @param dates Visible date columns (YYYY-MM-DD[]).
     */
    public render(container: HTMLElement, dates: string[]): void {
        const axisCell = container.createDiv('moon-section__cell moon-section__axis');
        axisCell.createEl('span', { cls: 'moon-section__label', text: t('moonPhase.label') });

        dates.forEach((date, i) => {
            const cell = container.createDiv('moon-section__cell');
            if (i === 0) cell.addClass('is-first-cell');
            if (i === dates.length - 1) cell.addClass('is-last-cell');
            cell.dataset.date = date;
            attachMoonPhase(cell, date, { size: 16, modifier: 'moon-phase-inline--row' });
        });
    }
}
