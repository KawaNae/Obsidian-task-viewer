/**
 * Audio Utilities
 *
 * Web Audio APIを使用して通知音を生成するユーティリティ
 *
 * 【設計上の考慮点】
 * - getReadyContext() は Promise でシリアライズされ、並行 resume() 競合を防止
 * - コンテキスト初回起動時のみサイレントパルスでオーディオスレッド稼働を確認
 * - チャイムは単一セッションで全音をスケジュールし、setTimeout を使わない
 *
 * 【音パターン一覧】
 * - 開始音 (playStartSound):        長×2    — タイマー開始・再開
 * - 予告ビープ (playWarningBeep):      短×1/tick — 残り3,2,1秒で毎秒再生
 * - 切替確認音 (playTransitionConfirm): 長×2 — セグメント切替直後
 * - 完全終了音 (playFinishSound):    C-E-G上昇3音 — 全interval完了/countdown満了
 * - 一時停止音 (playPauseSound):     G-E-C下降3音 — ユーザー一時停止操作
 * - 手動停止音: playFinishSound と共用（上昇3音）
 *
 * 短音 = 0.25s発音 (660Hz) — tick毎に1回再生
 * 長音 = 0.35s発音 (660Hz) — 2音連続で0.7s
 */

const FREQ = 660;
const SHORT_DUR = 0.25;
const LONG_DUR = 0.35;
const VOLUME = 0.25;

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
     * タイマー開始・再開時の音（長×2）
     */
    static playStartSound(): void {
        void this.playChime([
            { frequency: FREQ, delay: 0, duration: LONG_DUR, volume: VOLUME },
            { frequency: FREQ, delay: LONG_DUR, duration: LONG_DUR, volume: VOLUME },
        ]);
    }

    /**
     * 予告ビープ（短×1、残り3,2,1秒で毎tick呼び出し）
     */
    static playWarningBeep(): void {
        void this.playChime([
            { frequency: FREQ, delay: 0, duration: SHORT_DUR, volume: VOLUME },
        ]);
    }

    /**
     * セグメント切替確認音（長×2、切替直後）
     */
    static playTransitionConfirm(): void {
        void this.playChime([
            { frequency: FREQ, delay: 0, duration: LONG_DUR, volume: VOLUME },
            { frequency: FREQ, delay: LONG_DUR, duration: LONG_DUR, volume: VOLUME },
        ]);
    }

    /**
     * 完全終了音（C-E-G上昇3音）
     * interval全完了、countdown満了時に使用
     */
    static playFinishSound(): void {
        void this.playChime([
            { frequency: 523, delay: 0,    duration: 0.3, volume: VOLUME }, // C5
            { frequency: 659, delay: 0.15, duration: 0.3, volume: VOLUME }, // E5
            { frequency: 784, delay: 0.30, duration: 0.3, volume: VOLUME }, // G5
        ]);
    }

    /**
     * 一時停止音（G-E-C下降3音）
     */
    static playPauseSound(): void {
        void this.playChime([
            { frequency: 784, delay: 0,    duration: 0.3, volume: VOLUME }, // G5
            { frequency: 659, delay: 0.15, duration: 0.3, volume: VOLUME }, // E5
            { frequency: 523, delay: 0.30, duration: 0.3, volume: VOLUME }, // C5
        ]);
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
