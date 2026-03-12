import { App, MarkdownView } from 'obsidian';

/**
 * 既に開いているタブを検索し、あればフォーカスを移動する。
 * なければ null を返す。全ウィンドウ（ポップアウト含む）を検索対象とする。
 */
function revealExistingTab(app: App, filePath: string): boolean {
    const leaves = app.workspace.getLeavesOfType('markdown');
    const existing = leaves.find(leaf => {
        const view = leaf.view;
        return view instanceof MarkdownView && view.file?.path === filePath;
    });

    if (existing) {
        app.workspace.setActiveLeaf(existing, { focus: true });
        return true;
    }
    return false;
}

/**
 * ファイルパスを指定して既存タブに移動、なければ新規タブで開く。
 */
export function openFileInExistingOrNewTab(app: App, filePath: string): void {
    if (!revealExistingTab(app, filePath)) {
        void app.workspace.openLinkText(filePath, '', true);
    }
}

/**
 * リンクテキスト（wikilink等）を解決して既存タブに移動、なければ新規タブで開く。
 */
export function openLinkInExistingOrNewTab(app: App, linktext: string, sourcePath: string): void {
    const linkPath = linktext.split('#')[0].split('|')[0];
    const resolved = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    if (resolved && revealExistingTab(app, resolved.path)) {
        return;
    }
    void app.workspace.openLinkText(linktext, sourcePath, true);
}

/**
 * ファイルを開いて指定行を選択・フォーカスする。
 */
export function openFileAndSelectLine(app: App, filePath: string, lineNumber: number, reuseTab: boolean): void {
    if (reuseTab) {
        openFileInExistingOrNewTab(app, filePath);
    } else {
        void app.workspace.openLinkText(filePath, '', true);
    }

    setTimeout(() => {
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
            const editor = view.editor;
            const lineText = editor.getLine(lineNumber);
            editor.setSelection(
                { line: lineNumber, ch: 0 },
                { line: lineNumber, ch: lineText.length }
            );
            editor.focus();
        }
    }, 100);
}
