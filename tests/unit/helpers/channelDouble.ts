import type { WriteChannel } from '../../../src/utils/FileLines';

/**
 * A channel for a write made without an index: what the test hands it, a
 * reading nobody made, and, unless the test says otherwise, no row of a
 * reading followed.
 */
export function channelDouble(parts: Partial<Pick<WriteChannel, 'landed' | 'refused' | 'follow'>>): WriteChannel {
    return {
        landed: parts.landed ?? (() => { }),
        refused: parts.refused ?? (() => { }),
        follow: parts.follow ?? (() => null),
        reading: () => ({ n: 0, key: undefined }),
    };
}
