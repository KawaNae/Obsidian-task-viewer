/**
 * プロパティタイトルのUI部品を生成
 * 暗黙的な部分はグレー+イタリックで表示
 */
export class PropertyFormatter {
    /**
     * プロパティタイトルをDocumentFragmentとして生成
     * 
     * @example
     * // Start: 2026-02-06T13:00 (date=explicit, time=implicit)
     * // Result: "Start: 2026-02-06T" (normal) + "13:00" (gray italic)
     */
    createPropertyTitle(
        label: string,
        parts: {
            date?: string;
            time?: string;
            dateImplicit: boolean;
            timeImplicit: boolean;
            isUnset?: boolean;
        }
    ): DocumentFragment {
        const frag = document.createDocumentFragment();
        const container = document.createElement('span');

        // Label
        container.appendChild(document.createTextNode(label));

        if (parts.isUnset) {
            container.appendChild(document.createTextNode('-'));
            frag.appendChild(container);
            return frag;
        }

        const mutedColor = 'var(--text-muted)';

        // Date part
        if (parts.date) {
            const dateSpan = this.createStyledSpan(
                parts.date,
                parts.dateImplicit,
                mutedColor
            );
            container.appendChild(dateSpan);
        }

        // Space separator
        if (parts.date && parts.time) {
            const separatorSpan = this.createStyledSpan(
                ' ',
                parts.dateImplicit,
                mutedColor
            );
            container.appendChild(separatorSpan);
        }

        // Time part
        if (parts.time) {
            const timeSpan = this.createStyledSpan(
                parts.time,
                parts.timeImplicit,
                mutedColor
            );
            container.appendChild(timeSpan);
        }

        frag.appendChild(container);
        return frag;
    }

    /**
     * スタイル付きspanを作成
     */
    private createStyledSpan(
        text: string,
        isImplicit: boolean,
        mutedColor: string
    ): HTMLSpanElement {
        const span = document.createElement('span');
        span.textContent = text;
        if (isImplicit) {
            span.style.setProperty('color', mutedColor, 'important');
            span.style.setProperty('font-style', 'italic', 'important');
        }
        return span;
    }
}
