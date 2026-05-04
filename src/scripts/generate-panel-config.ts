import fs from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
  const apiBaseUrl = (process.env.PANEL_API_BASE_URL || '').trim();
  const filePath = path.join(process.cwd(), 'painel-atendimento', 'config.js');
  const content = [
    'window.APP_CONFIG = Object.freeze({',
    '  apiBaseUrl: ' + JSON.stringify(apiBaseUrl),
    '});',
    ''
  ].join('\n');

  await fs.writeFile(filePath, content, 'utf8');
  console.log('[panel-config] config.js gerado com PANEL_API_BASE_URL=' + (apiBaseUrl || '<vazio>'));
}

main().catch((err) => {
  console.error('[panel-config] erro ao gerar config.js', err);
  process.exit(1);
});
