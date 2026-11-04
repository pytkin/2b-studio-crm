export const pageSize = 200;
export async function collectPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  size = pageSize,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += size) {
    const batch = await fetchPage(offset, offset + size - 1);
    rows.push(...batch);
    if (batch.length < size) return rows;
  }
}
