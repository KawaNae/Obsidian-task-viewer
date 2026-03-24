import type { FrontmatterTaskKeys, PropertyValue } from '../../../types';
import { VALID_LINE_STYLES } from '../../../constants/style';

export interface ExtractedProperties {
    color?: string;
    linestyle?: string;
    mask?: string;
    properties: Record<string, PropertyValue>;
}

/**
 * Record<string, PropertyValue> から組み込みキー（tv-color 等）を
 * 専用フィールドに分離し、残りをカスタムプロパティとして返す。
 *
 * FrontmatterTaskBuilder / TaskScanner / SectionPropertyResolver で共通使用。
 */
export class BuiltinPropertyExtractor {
    static extract(
        rawProperties: Record<string, PropertyValue>,
        keys: FrontmatterTaskKeys
    ): ExtractedProperties {
        const result: ExtractedProperties = { properties: {} };

        for (const [key, pv] of Object.entries(rawProperties)) {
            if (key === keys.color) {
                const trimmed = pv.value.trim();
                if (trimmed) result.color = trimmed;
            } else if (key === keys.linestyle) {
                const val = pv.value.trim().toLowerCase();
                if (VALID_LINE_STYLES.has(val)) result.linestyle = val;
            } else if (key === keys.mask) {
                const trimmed = pv.value.trim();
                if (trimmed) result.mask = trimmed;
            } else {
                result.properties[key] = pv;
            }
        }

        return result;
    }
}
