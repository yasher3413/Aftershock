/** Fetch a server-drawn card (a share image under /api/og). */
export async function fetchCard(path: string): Promise<Blob> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} for ${path}`);
  return r.blob();
}
