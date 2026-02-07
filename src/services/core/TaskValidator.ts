import type { ValidationError } from './TaskIndex';

/**
 * バリデーションエラーの管理クラス
 * タスクのスキャン時に発生したバリデーションエラーを収集・管理
 */
export class TaskValidator {
    private validationErrors: ValidationError[] = [];

    /**
     * バリデーションエラーを追加
     */
    addError(error: ValidationError): void {
        this.validationErrors.push(error);
    }

    /**
     * 全てのバリデーションエラーをクリア
     */
    clearErrors(): void {
        this.validationErrors = [];
    }

    /**
     * 現在のバリデーションエラーを取得
     */
    getValidationErrors(): ValidationError[] {
        return this.validationErrors;
    }
}
