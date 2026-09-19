/**
 * Ordering shared by every value suggest (colors, line styles).
 *
 * The candidate lists are kept in the order their authors chose — alphabetical
 * for CSS colors, meaning-ordered for line styles — and a plain substring
 * filter hands that order straight back. That put `aliceblue` ahead of `blue`
 * for the query `blu`, so Enter on the first candidate picked a colour the
 * user had not typed.
 *
 * Ranking by how the query matched fixes that without discarding the authored
 * order: the sort is stable, so candidates that match the same way stay in
 * their list order.
 */
const enum Rank {
    Exact = 0,
    Prefix = 1,
    Substring = 2,
}

function rankOf(candidate: string, query: string): Rank | null {
    if (candidate === query) return Rank.Exact;
    if (candidate.startsWith(query)) return Rank.Prefix;
    if (candidate.includes(query)) return Rank.Substring;
    return null;
}

/**
 * Candidates that contain `query`, best match first.
 *
 * An empty query matches everything as a prefix, so the list comes back in its
 * own order — the "show me what there is" case.
 *
 * @param candidates lower-case candidate values, in their authored order
 * @param limit      maximum number of candidates to return
 */
export function rankCandidates(candidates: readonly string[], query: string, limit?: number): string[] {
    const q = query.toLowerCase().trim();

    const ranked: Array<{ value: string; rank: Rank }> = [];
    for (const candidate of candidates) {
        const rank = rankOf(candidate.toLowerCase(), q);
        if (rank !== null) ranked.push({ value: candidate, rank });
    }
    // Stable by specification (ES2019+), which is what keeps the authored
    // order inside each rank.
    ranked.sort((a, b) => a.rank - b.rank);

    const values = ranked.map(r => r.value);
    return limit ? values.slice(0, limit) : values;
}
