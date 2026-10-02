/**
 * Timer Progress UI
 *
 * Draws the progress ring, the time and the repeat text from what
 * `progressOf` answers. The widget and the standalone view share it; the
 * classes are built from the block name (`timer-widget__progress-ring`,
 * `timer-view__progress-ring`, ...).
 */

import type { Progress, Tone } from './TimerProgress';
import type { TimerInstance } from './TimerInstance';
import { repeatText } from './IntervalMath';

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

/**
 * The widget's timer read as a ring state. removed in stage 8 step 3, when the
 * widget's timers carry a measure and a clock and call `progressOf`.
 */
export function legacyProgress(timer: TimerInstance): RingState {
    const fullRotation = 30 * 60;
    if (timer.runState === 'suspended') {
        return {
            ring: Math.max(0, Math.min(1, (timer.recordedElapsedTime % fullRotation) / fullRotation)),
            displaySeconds: timer.recordedElapsedTime,
            tone: 'suspended',
            countupLike: true,
            repeatText: null,
        };
    }

    const tone: RingTone = timer.phase !== 'idle'
        ? timer.phase
        : timer.timerType === 'countdown' && timer.timeRemaining < 0 ? 'overtime' : 'plain';

    switch (timer.timerType) {
        case 'countup':
        case 'idle':
            return {
                ring: Math.max(0, Math.min(1, (timer.elapsedTime % fullRotation) / fullRotation)),
                displaySeconds: timer.elapsedTime,
                tone,
                countupLike: true,
                repeatText: null,
            };
        case 'countdown':
            if (timer.timeRemaining >= 0) {
                return {
                    ring: Math.min(1, timer.totalTime > 0 ? timer.timeRemaining / timer.totalTime : 0),
                    displaySeconds: timer.timeRemaining,
                    tone,
                    countupLike: false,
                    repeatText: null,
                };
            }
            return {
                ring: Math.max(0, Math.min(1, (-timer.timeRemaining % fullRotation) / fullRotation)),
                displaySeconds: timer.timeRemaining,
                tone,
                countupLike: true,
                repeatText: null,
            };
        case 'interval': {
            const segment = timer.groups[timer.currentGroupIndex]?.segments[timer.currentSegmentIndex];
            const segmentDuration = segment?.durationSeconds ?? timer.segmentTimeRemaining;
            return {
                ring: Math.max(0, Math.min(1, segmentDuration > 0 ? timer.segmentTimeRemaining / segmentDuration : 0)),
                displaySeconds: timer.segmentTimeRemaining,
                tone,
                countupLike: false,
                repeatText: repeatText(timer.groups, {
                    group: timer.currentGroupIndex,
                    repeat: timer.currentRepeatIndex,
                    segment: timer.currentSegmentIndex,
                }),
            };
        }
    }
}
