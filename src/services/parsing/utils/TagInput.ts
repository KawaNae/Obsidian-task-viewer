import type { FieldCodec, Read } from '../../../utils/values/Read';
import { readFail, readOk } from '../../../utils/values/Read';
import { TagRule } from './TagRule';

/**
 * Tags typed in a field to add to a task: words parted by space, each with
 * or without its `#` (`#仕事 急ぎ`). A word that is not one tag's word
 * (`TagRule.fault`) is refused: with the characters that end a tag
 * (`foo.bar`, `a#b`, `a,b`), or as digits alone (`123`), which Obsidian
 * takes for no tag. Read as the list of tags, without `#`.
 */
export const TagInput: FieldCodec<string[]> = {
    read(text: string): Read<string[]> {
        const words = text.split(/\s+/).map(word => word.replace(/^#/, '')).filter(word => word.length > 0);
        if (words.length === 0) return readFail({ code: 'empty' });
        const bad = new Set<string>();
        let digitsOnly = false;
        for (const word of words) {
            const fault = TagRule.fault(word);
            if (fault?.kind === 'chars') fault.chars.forEach(ch => bad.add(ch));
            else if (fault?.kind === 'digitsOnly') digitsOnly = true;
        }
        if (bad.size > 0) return readFail({ code: 'chars', chars: [...bad].join(' ') });
        if (digitsOnly) return readFail({ code: 'digitsOnly' });
        return readOk(words);
    },
    show: (tags) => tags.map(tag => `#${tag}`).join(' '),
};
