import { Menu } from 'obsidian';
import { menuShown } from './MenusOnScreen';

/**
 * メニューを開くアンカー指定。caller の都合に合わせて 3 形式から選択。
 */
export type MenuAnchor =
    | { kind: 'position'; x: number; y: number }
    | { kind: 'mouseEvent'; event: MouseEvent }
    | { kind: 'belowRect'; rect: DOMRect };

/**
 * プラグイン内で開く全ての自前メニューの lifecycle を所有する singleton。
 *
 * Obsidian Menu の auto-close は mousedown / contextmenu のグローバルリスナで動作するが、
 * iPad の OS 合成 contextmenu はこの経路を発火させないため、自前で前メニューを必ず閉じる。
 *
 * 不変条件: プラグイン内で同時に開いている自前メニューは最大 1 つ。
 *
 * Each menu shown is told to the menus on the screen (`MenusOnScreen`), and
 * told gone as Obsidian tells it has gone (`onHide`), which a sheet tells
 * only once its slide has ended: a focus put on a field waits for it. The
 * menu is not handed back to the caller, so `onHide`, which keeps one
 * callback only, is the presenter's alone.
 */
export class MenuPresenter {
    private currentMenu: Menu | null = null;

    /**
     * 新しいメニューを構築して表示する。直前のメニューがあれば閉じる。
     * 項目が1つも無いメニューは表示しない。
     *
     * @param build メニューに addItem / addSeparator する callback
     * @param anchor 表示位置
     */
    present(build: (menu: Menu) => void, anchor: MenuAnchor): void {
        this.currentMenu?.hide();

        const menu = new Menu();

        // addItem を wrap して item count を取り、空メニューを表示しない
        let itemCount = 0;
        const origAddItem = menu.addItem.bind(menu);
        menu.addItem = (cb) => {
            itemCount++;
            return origAddItem(cb);
        };

        build(menu);

        if (itemCount === 0) return;

        this.currentMenu = menu;
        const gone = menuShown();
        menu.onHide(() => {
            gone();
            if (this.currentMenu === menu) this.currentMenu = null;
        });

        switch (anchor.kind) {
            case 'position':
                menu.showAtPosition({ x: anchor.x, y: anchor.y });
                break;
            case 'mouseEvent':
                menu.showAtMouseEvent(anchor.event);
                break;
            case 'belowRect':
                menu.showAtPosition({ x: anchor.rect.left, y: anchor.rect.bottom });
                break;
        }
    }

    /** 現在開いているメニューを閉じる。無ければ no-op。 */
    dismiss(): void {
        this.currentMenu?.hide();
    }
}
