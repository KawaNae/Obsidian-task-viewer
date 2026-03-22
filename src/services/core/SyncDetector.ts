/**
 * 同期検出クラス
 * ローカル編集とリモート同期を区別するためのフラグ管理
 */
export class SyncDetector {
    private pendingLocalEdit: Map<string, boolean> = new Map();

    /**
     * ファイルパスをローカル編集としてマーク
     * @param filePath ファイルパス
     */
    markLocalEdit(filePath: string): void {
        this.pendingLocalEdit.set(filePath, true);
    }

    /**
     * ファイルパスがローカル編集かどうかをチェック
     * @param filePath ファイルパス
     * @returns ローカル編集の場合true
     */
    isLocalEdit(filePath: string): boolean {
        return this.pendingLocalEdit.get(filePath) || false;
    }

    /**
     * ローカル編集フラグをクリア
     * @param filePath ファイルパス
     */
    clearLocalEditFlag(filePath: string): void {
        this.pendingLocalEdit.delete(filePath);
    }
}
