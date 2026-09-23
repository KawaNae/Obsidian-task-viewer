import type { TaskScanner } from '../../../src/services/core/TaskScanner';
import type { ReadPlace } from '../../../src/services/core/identity/WriteClaims';

/**
 * How many committing scans took their rows from a write's record — the read
 * was, whole, a state a write of ours left, and nothing says it may be a
 * change after it (I1: a record adopted; before I1, a claim settled with
 * `consumed > 0`). Counted where a scan commits (`WriteClaims.forget` with
 * what it read), so a write's `locate`, which reads the same way, is not
 * counted.
 */
export function watchAdoptions(scanner: TaskScanner): { adopted: number; places: ReadPlace[] } {
    const claims = scanner.getWriteClaims();
    const seen = { adopted: 0, places: [] as ReadPlace[] };
    const forget = claims.forget.bind(claims);
    claims.forget = (path, read) => {
        if (read) {
            seen.places.push(read.place);
            if (!read.place.after && read.place.states.some(state => state !== 'ledger')) seen.adopted++;
        }
        forget(path, read);
    };
    return seen;
}
