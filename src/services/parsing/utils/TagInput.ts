import type { FieldCodec, Read } from '../../../utils/values/Read';
import { readFail, readOk } from '../../../utils/values/Read';
import { TagExtractor } from './TagExtractor';

/**
 * The characters a tag cannot hold: `#` ends one (`#a#b` is two), and `,`
 * splits a list written with commas (`tags:: a, b`), the other form a
 * task's tags line takes (`ChildPropertyLineEditor.formatValue`).
 */
const NOT_IN_TAG = /[#,]/g;

/**
 * Tags typed in a field to add to a task: words parted by space, each with
 * or without its `#` (`#仕事 急ぎ`). A word the notation would not read back
 * as one tag (`TagExtractor`) is refused with the characters that break it.
 * Read as the list of tags, without `#`.
 */
export const TagInput: FieldCodec<string[]> = {
    read(text: string): Read<string[]> {
        const words = text.split(/\s+/).map(word => word.replace(/^#/, '')).filter(word => word.length > 0);
        if (words.length === 0) return readFail({ code: 'empty' });
        const bad = new Set<string>();
        for (const word of words) {
            for (const ch of word.match(NOT_IN_TAG) ?? []) bad.add(ch);
        }
        if (bad.size > 0) return readFail({ code: 'chars', chars: [...bad].join(' ') });
        // The notation reads each back as the one tag it is.
        const misread = words.find(word => TagExtractor.fromContent(`#${word}`).join() !== word);
        if (misread !== undefined) return readFail({ code: 'chars', chars: misread });
        return readOk(words);
    },
    show: (tags) => tags.map(tag => `#${tag}`).join(' '),
};
