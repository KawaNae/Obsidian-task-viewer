/**
 * Timer Progress UI
 *
 * Handles rendering and lightweight updates for circular progress indicators.
 */

import { TimerInstance } from './TimerInstance';

interface ProgressState {
    progress: number;
    displaySeconds: number;
    phaseClass: string;
    isCountupLike: boolean;
}

export class TimerProgressUI {
    static render(
        container: HTMLElement,
        timer: TimerInstance,
        formatTime: (seconds: number) => string,
        size: number = 120
    ): void {
        const strokeWidth = 6;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const state = this.getProgressState(timer);
        const offset = circumference * (1 - state.progress);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.setAttribute('class', 'timer-widget__progress-ring');

        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', (size / 2).toString());
        bgCircle.setAttribute('cy', (size / 2).toString());
        bgCircle.setAttribute('r', radius.toString());
        bgCircle.setAttribute('class', 'timer-widget__progress-ring-bg');
        bgCircle.setAttribute('stroke-width', strokeWidth.toString());
        svg.appendChild(bgCircle);

        const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        progressCircle.setAttribute('cx', (size / 2).toString());
        progressCircle.setAttribute('cy', (size / 2).toString());
        progressCircle.setAttribute('r', radius.toString());
        progressCircle.setAttribute(
            'class',
            `timer-widget__progress-ring-progress timer-widget__progress-ring-progress--${state.phaseClass}`
        );
        progressCircle.setAttribute('stroke-width', strokeWidth.toString());
        progressCircle.setAttribute('stroke-dasharray', circumference.toString());
        progressCircle.setAttribute('stroke-dashoffset', offset.toString());
        progressCircle.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
        svg.appendChild(progressCircle);

        container.appendChild(svg);

        const timeDisplay = container.createDiv('timer-widget__time-display');
        timeDisplay.setText(formatTime(state.displaySeconds));
        if (state.isCountupLike) {
            timeDisplay.addClass('timer-widget__time-display--countup');
        }
    }

    static updateDisplay(
        itemEl: HTMLElement,
        timer: TimerInstance,
        formatTime: (seconds: number) => string,
        size: number = 120
    ): void {
        const strokeWidth = 6;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const state = this.getProgressState(timer);
        const offset = circumference * (1 - state.progress);

        const progressCircle = itemEl.querySelector('.timer-widget__progress-ring-progress') as SVGCircleElement | null;
        if (progressCircle) {
            progressCircle.setAttribute('stroke-dashoffset', offset.toString());
            progressCircle.setAttribute(
                'class',
                `timer-widget__progress-ring-progress timer-widget__progress-ring-progress--${state.phaseClass}`
            );
        }

        const timeDisplay = itemEl.querySelector('.timer-widget__time-display') as HTMLElement | null;
        if (timeDisplay) {
            timeDisplay.setText(formatTime(state.displaySeconds));
            timeDisplay.toggleClass('timer-widget__time-display--countup', state.isCountupLike);
        }
    }

    private static getProgressState(timer: TimerInstance): ProgressState {
        switch (timer.timerType) {
            case 'pomodoro': {
                const progress = timer.totalTime > 0 ? timer.timeRemaining / timer.totalTime : 1;
                return {
                    progress: Math.max(0, Math.min(1, progress)),
                    displaySeconds: timer.timeRemaining,
                    phaseClass: timer.phase,
                    isCountupLike: false,
                };
            }
            case 'countup':
            case 'idle': {
                const fullRotation = 30 * 60;
                const progress = (timer.elapsedTime % fullRotation) / fullRotation;
                return {
                    progress: Math.max(0, Math.min(1, progress)),
                    displaySeconds: timer.elapsedTime,
                    phaseClass: timer.phase,
                    isCountupLike: true,
                };
            }
            case 'countdown': {
                const progress = timer.totalTime > 0 ? timer.timeRemaining / timer.totalTime : 0;
                return {
                    progress: Math.max(0, Math.min(1, progress)),
                    displaySeconds: timer.timeRemaining,
                    phaseClass: timer.phase,
                    isCountupLike: false,
                };
            }
            case 'interval': {
                const currentGroup = timer.groups[timer.currentGroupIndex];
                const currentSegment = currentGroup?.segments[timer.currentSegmentIndex];
                const segmentDuration = currentSegment?.durationSeconds ?? timer.segmentTimeRemaining;
                const progress = segmentDuration > 0
                    ? timer.segmentTimeRemaining / segmentDuration
                    : 0;
                return {
                    progress: Math.max(0, Math.min(1, progress)),
                    displaySeconds: timer.segmentTimeRemaining,
                    phaseClass: timer.phase,
                    isCountupLike: false,
                };
            }
            default:
                return {
                    progress: 0,
                    displaySeconds: 0,
                    phaseClass: 'idle',
                    isCountupLike: false,
                };
        }
    }
}
