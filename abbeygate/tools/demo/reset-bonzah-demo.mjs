const baseUrl = process.env.BONZAH_DEMO_BASE_URL || 'http://localhost:3000';
const token = process.env.BONZAH_DEMO_RESET_TOKEN || 'bonzah-demo-reset-local';
const response = await fetch(`${baseUrl}/api/public/bonzah/demo/reset`, { method: 'POST', headers: { 'X-Demo-Reset-Token': token } });
const body = await response.text();
if (!response.ok) throw new Error(`Bonzah demo reset failed (${response.status}): ${body}`);
process.stdout.write(`${body}\n`);
