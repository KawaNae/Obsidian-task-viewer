/**
 * Timer Progress UI
 *
 * Draws the progress ring, the time and the repeat text from what
 * `progressOf` answers. The widget and the standalone view share it; the
 * classes are built from the block name (`timer-widget__progress-ring`,
 * `timer-view__progress-ring`, ...).
 */

import type { Progress, Tone } from './TimerProgress';

/** The ring's colour: a tone of the measure, or `suspended` while the widget's timer waits to resume. */
export type RingTone = Tone | 'suspended';

export type RingState = Omit<Progress, 'tone'> & { tone: RingTone };

export interface RingOptions {
    block: 'timer-widget' | 'timer-view';
    /** The SVG's view box side. */
    size: number;
    format: (seconds: number) => string;
}

const STROKE_WIDTH = 6;

export class TimerProgressUI {
    static render(container: HTMLElement, state: RingState, options: RingOptions): void {
        const { block, size } = options;
        const radius = (size - STROKE_WIDTH) / 2;
        const circumference = 2 * Math.PI * radius;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.setAttribute('class', `${block}__progress-ring`);

        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', (size / 2).toString());
        bgCircle.setAttribute('cy', (size / 2).toString());
        bgCircle.setAttribute('r', radius.toString());
        bgCircle.setAttribute('class', `${block}__progress-ring-bg`);
        bgCircle.setAttribute('stroke-width', STROKE_WIDTH.toString());
        svg.appendChild(bgCircle);

        const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        progressCircle.setAttribute('cx', (size / 2).toString());
        progressCircle.setAttribute('cy', (size / 2).toString());
        progressCircle.setAttribute('r', radius.toString());
        progressCircle.setAttribute('class', progressClass(block, state.tone));
        progressCircle.setAttribute('stroke-width', STROKE_WIDTH.toString());
        progressCircle.setAttribute('stroke-dasharray', circumference.toString());
        progressCircle.setAttribute('stroke-dashoffset', (circumference * (1 - state.ring)).toString());
        progressCircle.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
        svg.appendChild(progressCircle);

        container.appendChild(svg);

        const timeDisplay = container.createDiv(`${block}__time-display`);
        timeDisplay.setText(options.format(state.displaySeconds));
        if (state.countupLike) {
            timeDisplay.addClass(`${block}__time-display--countup`);
        }

        if (state.repeatText !== null) {
            const repeatInfo = container.createDiv(`${block}__repeat-info`);
            repeatInfo.dataset.repeatDisplay = 'ring';
            repeatInfo.setText(state.repeatText);
        }
    }

    /** Moves what `render` drew. The repeat text is updated or removed, never added. */
    static update(itemEl: HTMLElement, state: RingState, options: RingOptions): void {
        const { block, size } = options;
        const radius = (size - STROKE_WIDTH) / 2;
        const circumference = 2 * Math.PI * radius;

        const progressCircle = itemEl.querySelector(`.${block}__progress-ring-progress`) as SVGCircleElement | null;
        if (progressCircle) {
            progressCircle.setAttribute('stroke-dashoffset', (circumference * (1 - state.ring)).toString());
            progressCircle.setAttribute('class', progressClass(block, state.tone));
        }

        const timeDisplay = itemEl.querySelector(`.${block}__time-display`) as HTMLElement | null;
        if (timeDisplay) {
            timeDisplay.setText(options.format(state.displaySeconds));
            timeDisplay.toggleClass(`${block}__time-display--countup`, state.countupLike);
        }

        const repeatInfo = itemEl.querySelector('[data-repeat-display="ring"]') as HTMLElement | null;
        if (repeatInfo) {
            if (state.repeatText !== null) {
                repeatInfo.setText(state.repeatText);
            } else {
                repeatInfo.remove();
            }
        }
    }
}

function progressClass(block: string, tone: RingTone): string {
    return `${block}__progress-ring-progress ${block}__progress-ring-progress--${tone}`;
}
