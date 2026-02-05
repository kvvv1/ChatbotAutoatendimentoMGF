import fs from 'fs';
import path from 'path';
function fileToDataUrl(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Arquivo não encontrado: ${filePath}`);
    }
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    return `data:audio/mpeg;base64,${base64}`;
}
function updateEnvVar(envContent, key, value) {
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
    const welcomePath = path.resolve(rootDir, 'assets', 'audio', 'welcome.mp3');
    const menuPath = path.resolve(rootDir, 'assets', 'audio', 'menu.mp3');
    console.log('Lendo arquivos de áudio:');
    console.log('WELCOME ->', welcomePath);
    console.log('MENU    ->', menuPath);
    const welcomeDataUrl = fileToDataUrl(welcomePath);
    const menuDataUrl = fileToDataUrl(menuPath);
    const envPath = path.resolve(rootDir, '.env');
    if (!fs.existsSync(envPath)) {
        throw new Error(`Arquivo .env não encontrado em ${envPath}`);
    }
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = updateEnvVar(envContent, 'WELCOME_AUDIO_URL', welcomeDataUrl);
    envContent = updateEnvVar(envContent, 'MENU_AUDIO_URL', menuDataUrl);
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log('Variáveis WELCOME_AUDIO_URL e MENU_AUDIO_URL atualizadas no .env.');
}
main();
