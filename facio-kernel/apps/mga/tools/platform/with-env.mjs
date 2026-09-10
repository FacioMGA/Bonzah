import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// Private local credentials are deliberately outside the imported application.
const privateEnv = fileURLToPath(new URL('../../../../.local/gen2.env', import.meta.url));
loadEnvFile(privateEnv);
const args = process.argv.slice(2);
if (args[0] === '--migrate') {
  args.shift();
  if (!process.env.DIRECT_DATABASE_URL) throw new Error('Migration connection is not configured');
  process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
}
const command = args.shift();
if (!command) throw new Error('Supply a command to execute with the isolated environment');
const child = spawn(command, args, { stdio: 'inherit', env: process.env });
child.once('error', () => { process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
