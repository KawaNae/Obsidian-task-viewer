/**
 * Timer Progress UI
 * 
 * Handles rendering of circular progress indicator for timers.
 */

import { TimerInstance } from './TimerInstance';

export class TimerProgressUI {
    /**
     * Render circular progress ring with time display
     */
    static render(
        container: HTMLElement,
        timer: TimerInstance,
        formatTime: (seconds: number) => string
    ): void {
        const size = 120;
        const strokeWidth = 6;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;

        // Calculate progress based on timer type
        let progress: number;
        let displayTime: number;
        if (timer.timerType === 'countup') {
            // Countup: ring fills up over time (1 full rotation = 30 minutes)
            const COUNTUP_FULL_ROTATION_SECONDS = 30 * 60; // 30 minutes
            progress = (timer.elapsedTime % COUNTUP_FULL_ROTATION_SECONDS) / COUNTUP_FULL_ROTATION_SECONDS;
            displayTime = timer.elapsedTime;
        } else {
            // Pomodoro: show countdown progress
            progress = timer.totalTime > 0 ? timer.timeRemaining / timer.totalTime : 1;
            displayTime = timer.timeRemaining;
        }
        const offset = circumference * (1 - progress);

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
        progressCircle.setAttribute('class', `timer-widget__progress-ring-progress timer-widget__progress-ring-progress--${timer.mode}`);
        progressCircle.setAttribute('stroke-width', strokeWidth.toString());
        progressCircle.setAttribute('stroke-dasharray', circumference.toString());
        progressCircle.setAttribute('stroke-dashoffset', offset.toString());
        progressCircle.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
        svg.appendChild(progressCircle);

        container.appendChild(svg);

        const timeDisplay = container.createDiv('timer-widget__time-display');
        timeDisplay.setText(formatTime(displayTime));

        // Add type indicator for countup
        if (timer.timerType === 'countup') {
            timeDisplay.addClass('timer-widget__time-display--countup');
        }
    }

    /**
     * Update timer display without full re-render
     */
    static updateDisplay(
        itemEl: HTMLElement,
        timer: TimerInstance,
        formatTime: (seconds: number) => string
    ): void {
        const size = 120;
        const strokeWidth = 6;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;

        // Calculate progress and display time
        let progress: number;
        let displayTime: number;
        if (timer.timerType === 'countup') {
            const COUNTUP_FULL_ROTATION_SECONDS = 30 * 60;
            progress = (timer.elapsedTime % COUNTUP_FULL_ROTATION_SECONDS) / COUNTUP_FULL_ROTATION_SECONDS;
            displayTime = timer.elapsedTime;
        } else {
            progress = timer.totalTime > 0 ? timer.timeRemaining / timer.totalTime : 1;
            displayTime = timer.timeRemaining;
        }
        const offset = circumference * (1 - progress);

        // Update progress ring
        const progressCircle = itemEl.querySelector('.timer-widget__progress-ring-progress') as SVGCircleElement | null;
        if (progressCircle) {
            progressCircle.setAttribute('stroke-dashoffset', offset.toString());
            // Update mode class
            progressCircle.setAttribute('class', `timer-widget__progress-ring-progress timer-widget__progress-ring-progress--${timer.mode}`);
        }

        // Update time display
        const timeDisplay = itemEl.querySelector('.timer-widget__time-display') as HTMLElement | null;
        if (timeDisplay) {
            timeDisplay.setText(formatTime(displayTime));
        }
    }
}
