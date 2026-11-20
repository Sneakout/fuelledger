// Neon direct and pooled endpoints use the same credentials and database.
// Migrations need session continuity; application traffic keeps its pooled URL.
export function migrationConnection(environment) {
  if (environment.DIRECT_URL) return { url: environment.DIRECT_URL, source: 'DIRECT_URL' };
  const original = environment.DATABASE_URL;
  if (!original) return { url: original, source: 'DATABASE_URL' };
  try {
    const url = new URL(original);
    const labels = url.hostname.split('.');
    if (['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname.endsWith('.neon.tech') && labels[0].endsWith('-pooler')) {
      labels[0] = labels[0].slice(0, -7);
      url.hostname = labels.join('.');
      url.searchParams.delete('pgbouncer');
      return { url: url.toString(), source: 'Neon direct endpoint' };
    }
  } catch { /* Let Prisma report invalid configuration without logging credentials. */ }
  return { url: original, source: 'DATABASE_URL' };
}
