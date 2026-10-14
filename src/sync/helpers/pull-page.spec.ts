import { pullPage, type UpdatedAtFilter } from './pull-page';

type Row = { id: string; updatedAt: Date };

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms);

/** In-memory stand-in for a Prisma findMany ordered by (updatedAt, id). */
function source(rows: Row[]) {
  const sorted = [...rows].sort(
    (a, b) =>
      a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id),
  );
  return jest.fn((filter: UpdatedAtFilter, take?: number) => {
    const matching = sorted.filter((r) => {
      if (!filter) return true;
      if ('gt' in filter) return r.updatedAt > filter.gt;
      return r.updatedAt.getTime() === filter.equals.getTime();
    });
    return Promise.resolve(take ? matching.slice(0, take) : matching);
  });
}

/** Drains every page the way a client does: echo the last updatedAt. */
async function drain(rows: Row[], limit: number) {
  const find = source(rows);
  const seen: string[] = [];
  let since: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await pullPage(find, since, limit);
    seen.push(...page.rows.map((r) => r.id));
    if (page.rows.length) {
      since = page.rows[page.rows.length - 1].updatedAt.toISOString();
    }
    if (!page.hasMore) break;
  }
  return seen;
}

describe('pullPage', () => {
  it('pages normally when timestamps are distinct', async () => {
    const rows = [0, 1, 2, 3, 4].map((i) => ({
      id: `r${i}`,
      updatedAt: at(i),
    }));
    const first = await pullPage(source(rows), undefined, 2);
    expect(first.rows.map((r) => r.id)).toEqual(['r0', 'r1']);
    expect(first.hasMore).toBe(true);
    expect(await drain(rows, 2)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });

  it('never splits a run of equal updatedAt across pages', async () => {
    // r1..r4 were bumped by one request: same timestamp.
    const rows = [
      { id: 'r0', updatedAt: at(0) },
      ...['r1', 'r2', 'r3', 'r4'].map((id) => ({ id, updatedAt: at(5) })),
      { id: 'r5', updatedAt: at(9) },
    ];
    const first = await pullPage(source(rows), undefined, 2);
    expect(first.rows.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(first.hasMore).toBe(true);
    expect(await drain(rows, 2)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
  });

  it('reports no more rows when the run reaches the end', async () => {
    const rows = ['a', 'b', 'c'].map((id) => ({ id, updatedAt: at(1) }));
    const page = await pullPage(source(rows), undefined, 2);
    expect(page.rows).toHaveLength(3);
    expect(page.hasMore).toBe(false);
  });
});
