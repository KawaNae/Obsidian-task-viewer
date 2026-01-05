/**
 * Audio Utilities
 * 
 * Web Audio APIを使用して通知音を生成するユーティリティ
 * 
 * 【重要な設計上の考慮点】
 * AudioContextはresume()直後に「running」状態になりますが、
 * 内部のオーディオスレッドが完全に安定するまで時間がかかります。
 * そのため、音の再生は currentTime + 0.2秒 でスケジュールし、
 * 最初の音がクリップ（欠け）しないようにしています。
 */

export class AudioUtils {
    private static audioContext: AudioContext | null = null;

    /**
     * AudioContextを取得し、必要に応じてresumeする
     */
    private static async getReadyContext(): Promise<AudioContext> {
        if (!this.audioContext) {
            this.audioContext = new AudioContext();
        }

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        return this.audioContext;
    }

    /**
     * ビープ音を再生
     * @param frequency - 周波数 (Hz)
     * @param duration - 再生時間 (秒)
     * @param volume - 音量 (0.0 - 1.0)
     */
    static async playBeep(frequency = 800, duration = 0.2, volume = 0.3): Promise<void> {
        try {
            const ctx = await this.getReadyContext();

            // AudioContext安定化のため、少し先の時刻でスケジュール
            const startTime = ctx.currentTime + 0.2;

            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            oscillator.frequency.value = frequency;
            oscillator.type = 'sine';

            // クリック音防止のためフェードイン/アウト
            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01);
            gainNode.gain.setValueAtTime(volume, startTime + duration - 0.01);
            gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

            oscillator.start(startTime);
            oscillator.stop(startTime + duration);
        } catch (e) {
            console.warn('Failed to play beep:', e);
        }
    }

    /**
     * ポモドーロ完了時のチャイム音（上昇音）
     */
    static playWorkCompleteChime(): void {
        const notes = [523, 659, 784]; // C5, E5, G5 (Major chord)
        notes.forEach((freq, i) => {
            setTimeout(() => this.playBeep(freq, 0.3, 0.25), i * 150);
        });
    }

    /**
     * 休憩完了時のチャイム音（下降音）
     */
    static playBreakCompleteChime(): void {
        const notes = [784, 659, 523]; // G5, E5, C5 (Descending)
        notes.forEach((freq, i) => {
            setTimeout(() => this.playBeep(freq, 0.3, 0.25), i * 150);
        });
    }

    /**
     * タイマー開始時の短い音
     */
    static async playStartSound(): Promise<void> {
        await this.playBeep(660, 0.15, 0.2);
    }
}
