import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';

/** Fetch a bounded public image, pinning DNS to the address that was checked. */
export async function fetchPublicImageDataUri(raw: string): Promise<string> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Logo must use public HTTPS');
  const records = await dns.lookup(url.hostname, { all: true, family: 4 });
  const allowed = (address: string) => {
    if (net.isIP(address) !== 4) return false;
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
      || (a === 198 && (b === 18 || b === 19)));
  };
  if (!records.length || records.some(({ address }) => !allowed(address))) throw new Error('Logo destination is not public');
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      agent: false,
      lookup: (_host, _options, done) => done(null, records[0].address, 4),
      timeout: 5000,
      headers: { Accept: 'image/png,image/jpeg,image/webp' },
    }, (response) => {
      const type = String(response.headers['content-type'] || '').split(';')[0];
      if (response.statusCode !== 200 || !['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
        response.resume(); reject(new Error('Logo must be a PNG, JPEG or WebP image')); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) response.destroy(new Error('Logo exceeds 2 MB'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve(`data:${type};base64,${Buffer.concat(chunks).toString('base64')}`));
    });
    request.on('timeout', () => request.destroy(new Error('Logo request timed out')));
    request.on('error', reject);
  });
}
