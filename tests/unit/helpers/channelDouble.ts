import type { WriteChannel } from '../../../src/utils/FileLines';

/**
 * A channel for a write made without an index: `landed` and `refused` as the
 * test hands them, a reading nobody made, and no row of a reading followed.
 */
export function channelDouble(parts: Partial<Pick<WriteChannel, 'landed' | 'refused'>>): WriteChannel {
    return {
        landed: parts.landed ?? (() => { }),
        refused: parts.refused ?? (() => { }),
        follow: () => null,
        reading: () => ({ n: 0, key: undefined }),
    };
}
