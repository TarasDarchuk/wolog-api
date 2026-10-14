export type UpdatedAtFilter = { gt: Date } | { equals: Date } | undefined;

/**
 * Cursor pagination for `updatedAt > since`. The cursor is the last row's
 * updatedAt (clients store and echo it, so its format can't change), which
 * means a page must never end inside a run of rows sharing one updatedAt:
 * the next pull asks for `> that timestamp`, and the rest of the run would
 * be skipped forever. Runs happen whenever one request bumps several rows
 * (bulk updates, folder moves, migrations). When the boundary falls inside
 * a run, the page grows to include the whole run.
 *
 * `find` must apply the caller's own filters (userId, …), order by
 * updatedAt then id, and honour `take` when given.
 */
export async function pullPage<T extends { updatedAt: Date }>(
  find: (updatedAt: UpdatedAtFilter, take?: number) => Promise<T[]>,
  since: string | undefined,
  limit: number,
): Promise<{ rows: T[]; hasMore: boolean }> {
  const rows = await find(
    since ? { gt: new Date(since) } : undefined,
    limit + 1,
  );
  if (rows.length <= limit) return { rows, hasMore: false };

  const boundary = rows[limit - 1].updatedAt;
  if (rows[limit].updatedAt.getTime() !== boundary.getTime()) {
    return { rows: rows.slice(0, limit), hasMore: true };
  }

  const before = rows
    .slice(0, limit)
    .filter((r) => r.updatedAt.getTime() < boundary.getTime());
  const run = await find({ equals: boundary });
  const rest = await find({ gt: boundary }, 1);
  return { rows: [...before, ...run], hasMore: rest.length > 0 };
}
