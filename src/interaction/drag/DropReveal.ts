import { TRANSIENT_DRAG_CLASSES } from './constants';

/** ソースカードを見えなく/薄くしているクラス。ゲート判定の対象になる状態。 */
const CONCEALING_CLASSES = ['is-drag-hidden', 'is-drag-source-dimmed', 'is-drag-source-faint'] as const;

/**
 * ドロップ確定時にソースカードを再可視化してよいかを判定するゲート。
 *
 * ## 不変条件
 * > **ドロップ確定後、旧ジオメトリのソースカードが可視なフレームを 1 つも
 * > 作らない。**
 *
 * drag 中、ソースカードは `is-drag-hidden` で隠され、確定位置は ghost が
 * 描いている。commit 直後に無条件でクラスを剥がすと、ソースカードは
 * **旧ジオメトリのまま**再表示され、次の render が来るまでの間そのフレームが
 * 露出する。main window 内では「rAF は paint より前」の順序保証で偶然
 * アトミックに見えていたが、popout は自分の compositor で独立に描画するため
 * 必ず見える（実測 約75ms）。過去 c554f75 が「cleanup と同一 JS タスク内の
 * 同期 DOM 再構築」で塞ぎ、d97e38b の rAF 集約化がその暗黙の前提を壊した。
 *
 * ## 仕組み
 * 再可視化を **許可制** にする。ゲスチャは commit 経路に入るとき {@link gate}
 * を呼び、確定ジオメトリを反映できた要素だけ {@link markApplied} する。
 * {@link finish} は
 *
 *   - applied な要素 … transient class を全部落として可視化する。確定
 *     ジオメトリで描かれているので旧位置は出ない
 *   - それ以外       … `is-drag-hidden` を残して隠したままにする
 *
 * とする。隠したままの要素は次の render が回収する: `CardReconciler.acquire`
 * が再利用カードから transient class を剥がして authoritative に再配置し、
 * 生き残らないカード（日跨ぎが減った / 別 section へ移った）は detach されて
 * 消える。つまり **render の到達を待たずに不変条件を満たしつつ、render に
 * よる自己修復も効く**。
 *
 * gate されていない経路（閾値未満のクリック、pointercancel、commit 前の早期
 * return）では commit が起きておらず旧ジオメトリがそのまま正しいので、
 * 全要素をそのまま可視に戻す（従来どおりの挙動）。
 */
export class DropReveal {
    private gated = false;
    private readonly applied = new Set<HTMLElement>();

    /**
     * commit 経路に入ったことを宣言する。以後 {@link finish} は
     * {@link markApplied} された要素だけを可視化する。
     */
    gate(): void {
        this.gated = true;
    }

    /** 確定ジオメトリを反映済みとして記録する。再可視化の許可証。 */
    markApplied(el: HTMLElement): void {
        this.applied.add(el);
    }

    /**
     * drag 終了時の可視状態を確定させる。冪等 — 同じ要素に複数回呼んでよい
     * （dragEl は base と subclass の cleanup 双方から渡される）。
     *
     * 隠したままにするのは「gesture が既に隠している / 淡くしている」要素だけ。
     * ゲスチャによっては（Grid の同一週 resize のように）ソースカードを隠さず
     * 直接動かして確定させるので、そこに新しい隠蔽を発明してはいけない。
     */
    finish(elements: Iterable<HTMLElement>): void {
        for (const el of elements) {
            const concealed = CONCEALING_CLASSES.some(cls => el.classList.contains(cls));
            if (!this.gated || !concealed || this.applied.has(el)) {
                el.classList.remove(...TRANSIENT_DRAG_CLASSES);
                continue;
            }
            // 確定ジオメトリを持てなかった要素。可視にすると旧位置が出るので
            // 隠したまま次 render に渡す。
            el.classList.remove('is-dragging', 'is-drag-source-dimmed', 'is-drag-source-faint');
            el.classList.add('is-drag-hidden');
        }
    }

    /** その要素は可視化される状態か（inline z の据え置き判定などに使う）。 */
    isRevealable(el: HTMLElement): boolean {
        if (!this.gated || this.applied.has(el)) return true;
        return !CONCEALING_CLASSES.some(cls => el.classList.contains(cls));
    }
}
