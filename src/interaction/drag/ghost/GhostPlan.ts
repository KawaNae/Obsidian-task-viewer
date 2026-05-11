/**
 * Drag-preview ghost 1 個分の配置プラン。Surface (Calendar/AllDay/Timeline) や
 * 用途 (split preview / cascade / cross-view floating) を超えて GhostRenderer が
 * 一律に処理するための共通形式。
 *
 * layout 別:
 *   - 'grid'     : 親 grid container 直下の grid item として配置 (Calendar/AllDay の split preview)
 *   - 'absolute' : 親 container を基準とした絶対配置 (Timeline cascade ghost)
 *   - 'fixed'    : viewport 基準の固定配置 (cross-view drop で pointer 追従する floating ghost)
 *
 * `splitClasses` は task-card のサワトゥース (split-continues-before / -after) の
 * CSS modifier 群。
 */
export type GhostPlan = GridGhostPlan | AbsoluteGhostPlan | FixedGhostPlan;

export interface GridGhostPlan {
    layout: 'grid';
    parent: HTMLElement;
    /** "{col} / span {n}" 形式に解決済み */
    gridColumn: string;
    /** "{row}" 形式に解決済み */
    gridRow: string;
    splitClasses: string[];
}

export interface AbsoluteGhostPlan {
    layout: 'absolute';
    parent: HTMLElement;
    left: number;
    top: number;
    width: number;
    height: number;
    splitClasses: string[];
}

/**
 * Viewport 固定配置の ghost (cross-view drop で pointer 追従する floating ghost
 * 用)。`left` / `top` は viewport 座標 (px)。
 *
 * 重要: GhostPlan は **位置の最終値** だけを持つ。pointer 追従と grab offset の
 * 保持は **caller の責任**。typical な使い方:
 *
 *     left: clientX - grabOffsetX,
 *     top:  clientY - grabOffsetY,
 *
 * これにより ghost 内の掴み位置と pointer の相対関係が drag 開始時と同じに
 * 保たれる。`clientX + 10` のような pointer 無関係オフセットは ghost を
 * pointer から飛び離して見せるので避ける (履歴 issue: timeline 移動ハンドル
 * ずれ 2026-05-11)。
 */
export interface FixedGhostPlan {
    layout: 'fixed';
    left: number;
    top: number;
    width: number;
    height: number;
    splitClasses: string[];
}
