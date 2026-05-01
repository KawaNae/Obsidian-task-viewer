import type { TvFileKeys, PropertyValue } from '../../../types';
import { VALID_LINE_STYLES } from '../../../constants/style';
import { normalizeColor } from '../../../utils/ColorUtils';
import { TagExtractor } from '../utils/TagExtractor';

export interface ExtractedProperties {
    color?: string;
    linestyle?: string;
    mask?: string;
    tags?: string[];
    properties: Record<string, PropertyValue>;
}

/**
 * Record<string, PropertyValue> から組み込みキー（tv-color 等）を
 * 専用フィールドに分離し、残りをカスタムプロパティとして返す。
 *
 * TVFileBuilder / TaskScanner / SectionPropertyResolver で共通使用。
 */
export class BuiltinPropertyExtractor {
    static extract(
        rawProperties: Record<string, PropertyValue>,
        keys: TvFileKeys
    ): ExtractedProperties {
        const result: ExtractedProperties = { properties: {} };

        for (const [key, pv] of Object.entries(rawProperties)) {
            if (key === keys.color) {
                if (pv.value.trim()) result.color = normalizeColor(pv.value);
            } else if (key === keys.linestyle) {
                const val = pv.value.trim().toLowerCase();
                if (VALID_LINE_STYLES.has(val)) result.linestyle = val;
            } else if (key === keys.mask) {
                const trimmed = pv.value.trim();
                if (trimmed) result.mask = trimmed;
            } else if (key === 'tags') {
                const tags = TagExtractor.fromPropertyValue(pv.value);
                if (tags.length > 0) result.tags = tags;
            } else {
                result.properties[key] = pv;
            }
        }

        return result;
    }
}
