import { describe, expect, it } from 'vitest';

/**
 * タイマービューで「セッションが在るか」を表すのは `this.timer` だけ。
 *
 * `phase` は進捗リングの色の元で、カウントダウンが 0 を割ると `'idle'` になる。
 * これを未開始の判定に流用していたため、超過中に一時停止すると操作列が「開始」に
 * 戻り、70 秒計った走行中のセッションが再開できずに消えた（実機で採取）。
 * 判定を `this.timer` に寄せた形を、ここで固定する。
 *
 * ビューは ItemView なので単体で組み立てるには DOM が要る。振る舞いの検証は
 * 実機に譲り、ここでは「phase を判定に使っていない」ことだけを見る。
 */

describe('TimerView: session presence is not read from phase', () => {
    it('never branches on phase === idle', async () => {
        const { readFileSync } = await import('node:fs');
        const source = readFileSync('src/views/TimerView.ts', 'utf8');

        expect(source).not.toMatch(/phase === 'idle'/);
        expect(source).not.toMatch(/phase !== 'idle'/);
    });
});
