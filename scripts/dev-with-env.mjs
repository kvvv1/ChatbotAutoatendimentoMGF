import { readFileSync } from 'fs';
import { spawn } from 'child_process';

const envFile = process.argv[2];
if (!envFile) { console.error('Uso: node scripts/dev-with-env.mjs <arquivo.env>'); process.exit(1); }

const lines = readFileSync(envFile, 'utf8').split('\n');
for (const line of lines) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const child = spawn(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'watch', 'src/server.ts'],
  { stdio: 'inherit', env: process.env }
);

child.on('exit', code => process.exit(code ?? 0));
