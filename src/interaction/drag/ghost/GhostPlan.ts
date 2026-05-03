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

export interface FixedGhostPlan {
    layout: 'fixed';
    left: number;
    top: number;
    width: number;
    height: number;
    splitClasses: string[];
}
