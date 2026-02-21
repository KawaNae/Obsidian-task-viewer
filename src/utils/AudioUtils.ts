/**
 * Audio Utilities
 *
 * Web Audio APIを使用して通知音を生成するユーティリティ
 *
 * 【設計上の考慮点】
 * - getReadyContext() は Promise でシリアライズされ、並行 resume() 競合を防止
 * - コンテキスト初回起動時のみサイレントパルスでオーディオスレッド稼働を確認
 * - チャイムは単一セッションで全音をスケジュールし、setTimeout を使わない
 */

export class AudioUtils {
    private static audioContext: AudioContext | null = null;
    private static contextReady: Promise<AudioContext> | null = null;

    /**
     * AudioContextを取得し、必要に応じてresumeする。
     * 同時呼び出しは同一Promiseを共有し、resume()競合を防止。
     */
    private static getReadyContext(): Promise<AudioContext> {
        if (!this.contextReady) {
            this.contextReady = this.ensureHealthyContext().finally(() => {
                this.contextReady = null;
            });
        }
        return this.contextReady;
    }

    private static async ensureHealthyContext(): Promise<AudioContext> {
        if (!this.audioContext || this.audioContext.state === 'closed') {
            this.audioContext = new AudioContext();
        }

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        // ゾンビ検出: resume後もcurrentTimeが0ならオーディオスレッド未起動
        if (this.audioContext.currentTime === 0) {
            await this.playSilentPulse(this.audioContext);
        }

        return this.audioContext;
    }

    /**
     * 無音パルスを再生してオーディオスレッドの稼働を確認する。
     * onendedイベントで実際にハードウェアが処理したことを保証。
     */
    private static playSilentPulse(ctx: AudioContext): Promise<void> {
        return new Promise<void>((resolve) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0;
            osc.connect(gain);
            gain.connect(ctx.destination);

            const now = ctx.currentTime;
            osc.start(now);
            osc.stop(now + 0.05);
            osc.onended = () => resolve();
        });
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

            // スケジューリングマージン（ウォームアップはgetReadyContext側で保証済み）
            const startTime = ctx.currentTime + 0.05;

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
     * 複数音を単一セッションでスケジュールする。
     * setTimeout不使用、Web Audioスケジューラで精密配置。
     */
    private static async playChime(
        notes: { frequency: number; delay: number; duration: number; volume: number }[]
    ): Promise<void> {
        try {
            const ctx = await this.getReadyContext();
            const baseTime = ctx.currentTime + 0.05;

            for (const note of notes) {
                const oscillator = ctx.createOscillator();
                const gainNode = ctx.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(ctx.destination);

                oscillator.frequency.value = note.frequency;
                oscillator.type = 'sine';

                const t = baseTime + note.delay;
                gainNode.gain.setValueAtTime(0, t);
                gainNode.gain.linearRampToValueAtTime(note.volume, t + 0.01);
                gainNode.gain.setValueAtTime(note.volume, t + note.duration - 0.01);
                gainNode.gain.linearRampToValueAtTime(0, t + note.duration);

                oscillator.start(t);
                oscillator.stop(t + note.duration);
            }
        } catch (e) {
            console.warn('Failed to play chime:', e);
        }
    }

    /**
     * ポモドーロ完了時のチャイム音（上昇音）
     */
    static playWorkCompleteChime(): void {
        void this.playChime([
            { frequency: 523, delay: 0,    duration: 0.3, volume: 0.25 }, // C5
            { frequency: 659, delay: 0.15, duration: 0.3, volume: 0.25 }, // E5
            { frequency: 784, delay: 0.30, duration: 0.3, volume: 0.25 }, // G5
        ]);
    }

    /**
     * 休憩完了時のチャイム音（下降音）
     */
    static playBreakCompleteChime(): void {
        void this.playChime([
            { frequency: 784, delay: 0,    duration: 0.3, volume: 0.25 }, // G5
            { frequency: 659, delay: 0.15, duration: 0.3, volume: 0.25 }, // E5
            { frequency: 523, delay: 0.30, duration: 0.3, volume: 0.25 }, // C5
        ]);
    }

    /**
     * タイマー開始時の短い音
     */
    static async playStartSound(): Promise<void> {
        await this.playBeep(660, 0.15, 0.2);
    }

    /**
     * AudioContextを閉じてリソースを解放する。
     * プラグインonunload()から呼び出す。
     */
    static dispose(): void {
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
        this.audioContext = null;
        this.contextReady = null;
    }
}
