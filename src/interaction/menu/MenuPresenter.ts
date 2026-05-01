import { Menu } from 'obsidian';

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
 */
export class MenuPresenter {
    private currentMenu: Menu | null = null;

    /**
     * 新しいメニューを構築して表示する。直前のメニューがあれば閉じる。
     *
     * @param build メニューに addItem / addSeparator する callback
     * @param anchor 表示位置
     * @returns 表示されたメニュー (空メニューだった場合は null)
     */
    present(build: (menu: Menu) => void, anchor: MenuAnchor): Menu | null {
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

        if (itemCount === 0) return null;

        this.currentMenu = menu;
        menu.onHide(() => {
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

        return menu;
    }

    /** 現在開いているメニューを閉じる。無ければ no-op。 */
    dismiss(): void {
        this.currentMenu?.hide();
    }
}
