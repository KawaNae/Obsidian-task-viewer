/**
 * Pomodoro Timer Service
 * 
 * タイマーロジックを管理するサービス。
 * 将来のタスク連携を前提とした設計。
 */

export type PomodoroMode = 'work' | 'break' | 'idle';

export interface PomodoroState {
    mode: PomodoroMode;
    isRunning: boolean;
    timeRemaining: number;  // seconds
    totalTime: number;      // seconds (for progress calculation)
    taskId?: string;        // 将来のタスク連携用
}

export interface PomodoroSettings {
    workMinutes: number;
    breakMinutes: number;
}

type StateListener = (state: PomodoroState) => void;
type CompleteListener = (mode: PomodoroMode, taskId?: string) => void;

export class PomodoroService {
    private state: PomodoroState;
    private settings: PomodoroSettings;
    private intervalId: number | null = null;
    private stateListeners: StateListener[] = [];
    private completeListeners: CompleteListener[] = [];

    constructor(settings: PomodoroSettings) {
        this.settings = settings;
        this.state = this.createIdleState();
    }

    private createIdleState(): PomodoroState {
        return {
            mode: 'idle',
            isRunning: false,
            timeRemaining: this.settings.workMinutes * 60,
            totalTime: this.settings.workMinutes * 60,
            taskId: undefined,
        };
    }

    updateSettings(settings: PomodoroSettings): void {
        this.settings = settings;
        if (this.state.mode === 'idle') {
            this.state.timeRemaining = settings.workMinutes * 60;
            this.state.totalTime = settings.workMinutes * 60;
            this.notifyStateChange();
        }
    }

    getState(): PomodoroState {
        return { ...this.state };
    }

    /**
     * タイマーを開始
     * @param taskId 将来のタスク連携用（オプション）
     */
    start(taskId?: string): void {
        if (this.state.isRunning) return;

        if (this.state.mode === 'idle') {
            this.state.mode = 'work';
            this.state.timeRemaining = this.settings.workMinutes * 60;
            this.state.totalTime = this.settings.workMinutes * 60;
        }

        this.state.taskId = taskId;
        this.state.isRunning = true;
        this.startInterval();
        this.notifyStateChange();
    }

    pause(): void {
        if (!this.state.isRunning) return;

        this.state.isRunning = false;
        this.stopInterval();
        this.notifyStateChange();
    }

    resume(): void {
        if (this.state.isRunning || this.state.mode === 'idle') return;

        this.state.isRunning = true;
        this.startInterval();
        this.notifyStateChange();
    }

    reset(): void {
        this.stopInterval();
        this.state = this.createIdleState();
        this.notifyStateChange();
    }

    /**
     * 作業セッション完了後、休憩に移行
     */
    startBreak(): void {
        this.stopInterval();
        this.state.mode = 'break';
        this.state.timeRemaining = this.settings.breakMinutes * 60;
        this.state.totalTime = this.settings.breakMinutes * 60;
        this.state.isRunning = true;
        this.startInterval();
        this.notifyStateChange();
    }

    onStateChange(callback: StateListener): () => void {
        this.stateListeners.push(callback);
        return () => {
            this.stateListeners = this.stateListeners.filter(l => l !== callback);
        };
    }

    onComplete(callback: CompleteListener): () => void {
        this.completeListeners.push(callback);
        return () => {
            this.completeListeners = this.completeListeners.filter(l => l !== callback);
        };
    }

    private startInterval(): void {
        if (this.intervalId !== null) return;

        this.intervalId = window.setInterval(() => {
            this.tick();
        }, 1000);
    }

    private stopInterval(): void {
        if (this.intervalId !== null) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    private tick(): void {
        if (this.state.timeRemaining > 0) {
            this.state.timeRemaining--;
            this.notifyStateChange();
        } else {
            this.handleComplete();
        }
    }

    private handleComplete(): void {
        this.stopInterval();
        const completedMode = this.state.mode;
        const taskId = this.state.taskId;

        // Notify completion
        for (const listener of this.completeListeners) {
            listener(completedMode, taskId);
        }

        // Auto-transition: work -> auto start break, break -> idle
        if (completedMode === 'work') {
            // Work completed - automatically start break
            this.startBreak();
        } else {
            // Break completed - return to idle
            this.state = this.createIdleState();
            this.notifyStateChange();
        }
    }

    private notifyStateChange(): void {
        const stateCopy = this.getState();
        for (const listener of this.stateListeners) {
            listener(stateCopy);
        }
    }

    destroy(): void {
        this.stopInterval();
        this.stateListeners = [];
        this.completeListeners = [];
    }
}
