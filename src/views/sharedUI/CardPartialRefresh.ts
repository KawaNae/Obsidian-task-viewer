import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { TaskStyling } from './TaskStyling';
import { TaskReadService } from '../../services/data/TaskReadService';
import { TaskViewerSettings, DisplayTask } from '../../types';

export interface CardRefreshHooks {
    /**
     * 既定では readService.getDisplayTask(taskId) を返す。
     * timed split segment 等で segment-specific な DisplayTask が必要な
     * view はここで segment context を解決する（Phase 3+ で実装）。
     */
    resolveTaskForCard?: (card: HTMLElement, taskId: string) => DisplayTask | undefined;
    /**
     * 全カード再描画後に呼ばれる post-hook。selection / handle 再 attach 等の
     * view 固有の後始末がある場合のみ指定。
     */
    afterRefresh?: (refreshedCards: HTMLElement[]) => void;
}

/**
 * scope 内で taskId にマッチするカード全件（split segment 含む）を再描画する。
 * 1件以上見つかれば true を返す。RenderController の tryPartial 実装の核。
 *
 * 検索範囲は data-id 完全一致 ∪ data-split-original-id 完全一致。これにより
 * split segment（data-id="${taskId}##seg:date"）も同じ呼び出しで網羅される。
 *
 * 各 card には styling の再適用 (color/linestyle/readonly) と TaskCardRenderer の
 * rerender() を行う。renderer は冪等なので二重化は起きない。
 */
export function refreshCardsForTask(
    scope: HTMLElement,
    taskId: string,
    readService: TaskReadService,
    taskRenderer: TaskCardRenderer,
    settings: TaskViewerSettings,
    hooks: CardRefreshHooks = {},
): boolean {
    const escaped = CSS.escape(taskId);
    const cards = Array.from(scope.querySelectorAll<HTMLElement>(
        `.task-card[data-id="${escaped}"], .task-card[data-split-original-id="${escaped}"]`
    ));
    if (cards.length === 0) return false;

    const baseDt = readService.getDisplayTask(taskId);
    const refreshed: HTMLElement[] = [];
    for (const card of cards) {
        const dt = hooks.resolveTaskForCard?.(card, taskId) ?? baseDt;
        if (!dt) continue;
        TaskStyling.applyTaskColor(card, dt.color ?? null);
        TaskStyling.applyTaskLinestyle(card, dt.linestyle ?? null);
        TaskStyling.applyReadOnly(card, dt);
        void taskRenderer.rerender(card, dt, settings);
        refreshed.push(card);
    }
    if (refreshed.length === 0) return false;
    hooks.afterRefresh?.(refreshed);
    return true;
}
