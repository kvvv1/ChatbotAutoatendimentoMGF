import fs from 'fs';
import path from 'path';

function fileToDataUrl(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  
  // Detecta extensão para determinar MIME type
  const ext = path.extname(filePath).toLowerCase();
  let mimeType = 'video/mp4';
  if (ext === '.webm') mimeType = 'video/webm';
  else if (ext === '.avi') mimeType = 'video/x-msvideo';
  else if (ext === '.mov') mimeType = 'video/quicktime';
  else if (ext === '.mkv') mimeType = 'video/x-matroska';
  
  return `data:${mimeType};base64,${base64}`;
}

function updateEnvVar(envContent: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key}=.*$`, 'm');

  if (regex.test(envContent)) {
    return envContent.replace(regex, line);
  }

  const trimmed = envContent.endsWith('\n') ? envContent : envContent + '\n';
  return trimmed + line + '\n';
}

function main() {
  const rootDir = process.cwd();
  const videoDir = path.resolve(rootDir, 'assets', 'video');
  
  // Procura por arquivo de vídeo na pasta assets/video
  const supportedExtensions = ['.mp4', '.webm', '.avi', '.mov', '.mkv'];
  let videoPath: string | null = null;
  
  if (fs.existsSync(videoDir)) {
    const files = fs.readdirSync(videoDir);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (supportedExtensions.includes(ext)) {
        // Prioriza arquivo chamado 'tutorial' ou 'video'
        if (file.toLowerCase().includes('tutorial') || file.toLowerCase().includes('video')) {
          videoPath = path.resolve(videoDir, file);
          break;
        }
        // Se não encontrou um específico, usa o primeiro encontrado
        if (!videoPath) {
          videoPath = path.resolve(videoDir, file);
        }
      }
    }
  }
  
  if (!videoPath) {
    console.error('❌ Nenhum arquivo de vídeo encontrado em assets/video/');
    console.log('');
    console.log('Coloque seu vídeo tutorial na pasta assets/video/');
    console.log('Formatos suportados: .mp4, .webm, .avi, .mov, .mkv');
    console.log('');
    console.log('Exemplo:');
    console.log('  assets/video/tutorial.mp4');
    console.log('');
    process.exit(1);
  }
  
  // Verifica tamanho do arquivo (WhatsApp limite ~16MB)
  const stats = fs.statSync(videoPath);
  const fileSizeMB = stats.size / (1024 * 1024);
  
  console.log('📹 Lendo arquivo de vídeo:');
  console.log(`   Caminho: ${videoPath}`);
  console.log(`   Tamanho: ${fileSizeMB.toFixed(2)} MB`);
  
  if (fileSizeMB > 16) {
    console.warn('');
    console.warn('⚠️  ATENÇÃO: O arquivo tem mais de 16MB!');
    console.warn('   O WhatsApp pode rejeitar vídeos muito grandes.');
    console.warn('   Recomendado: Comprima o vídeo para menos de 16MB.');
    console.warn('');
  }
  
  if (fileSizeMB > 50) {
    console.error('');
    console.error('❌ Arquivo muito grande para converter em base64!');
    console.error('   Use uma URL externa para vídeos maiores que 50MB.');
    console.error('');
    process.exit(1);
  }

  console.log('');
  console.log('🔄 Convertendo para base64...');
  
  const videoDataUrl = fileToDataUrl(videoPath);
  
  console.log(`   Base64 gerado: ${(videoDataUrl.length / 1024 / 1024).toFixed(2)} MB`);

  const envPath = path.resolve(rootDir, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(`Arquivo .env não encontrado em ${envPath}`);
  }

  let envContent = fs.readFileSync(envPath, 'utf8');

  envContent = updateEnvVar(envContent, 'VIDEO_TUTORIAL_URL', videoDataUrl);

  fs.writeFileSync(envPath, envContent, 'utf8');

  console.log('');
  console.log('✅ Variável VIDEO_TUTORIAL_URL atualizada no .env');
  console.log('');
  console.log('💡 Dica: Configure também no .env:');
  console.log('   VIDEO_TUTORIAL_CAPTION="Seu texto aqui"');
  console.log('   VIDEO_TUTORIAL_INTRO="Mensagem de introdução"');
}

main();
