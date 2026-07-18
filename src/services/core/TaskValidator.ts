export interface ValidationError {
    file: string;
    line: number;
    taskId: string;
    error: string;
}

/**
 * バリデーションエラーの管理クラス
 * タスクのスキャン時に発生したバリデーションエラーを収集・管理。
 * ファイル単位で差し替え可能にし、増分スキャン時の重複蓄積を防ぐ。
 */
export class TaskValidator {
    private errorsByFile: Map<string, ValidationError[]> = new Map();

    addError(error: ValidationError): void {
        const list = this.errorsByFile.get(error.file);
        if (list) {
            list.push(error);
        } else {
            this.errorsByFile.set(error.file, [error]);
        }
    }

    clearErrorsForFile(file: string): void {
        this.errorsByFile.delete(file);
    }

    clearErrors(): void {
        this.errorsByFile.clear();
    }

    getValidationErrors(): ValidationError[] {
        const result: ValidationError[] = [];
        for (const errors of this.errorsByFile.values()) {
            result.push(...errors);
        }
        return result;
    }
}
