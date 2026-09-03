import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
const EXCLUDED = new Set(['.env.example', '.env.demo']);
export function loadInstances() {
    const root = process.cwd();
    let files;
    try {
        files = readdirSync(root).filter(f => /^\.env\.\S+$/.test(f) && !EXCLUDED.has(f));
    }
    catch {
        return [];
    }
    const instances = [];
    for (const file of files) {
        try {
            const env = parse(readFileSync(path.join(root, file)));
            if (!env.ZAPI_INSTANCE_ID)
                continue;
            instances.push({
                slug: env.MUNICIPIO || file.replace('.env.', ''),
                envFile: file,
                nomeAbreviado: env.ENTIDADE_NOME || file.replace('.env.', ''),
                nomeCompleto: env.ENTIDADE_NOME_COMPLETO || env.ENTIDADE_NOME || '',
                port: Number(env.PORT || 3000),
                phoneNumber: env.ENTIDADE_PHONE_NUMBER || '',
                zapiBaseUrl: (env.ZAPI_BASE_URL || 'https://api.z-api.io').replace(/\/+$/, ''),
                zapiInstanceId: env.ZAPI_INSTANCE_ID,
                zapiToken: env.ZAPI_TOKEN || '',
                zapiClientToken: env.ZAPI_CLIENT_TOKEN || '',
                linkApiBaseUrl: env.LINK_API_BASE_URL || '',
                linkApiToken: env.LINK_API_TOKEN || '',
                linkApiExternalUrl: env.LINK_API_EXTERNAL_URL || '',
                linkApiExternalToken: env.LINK_API_EXTERNAL_TOKEN || '',
                smtpHost: env.SMTP_HOST || '',
                smtpPort: Number(env.SMTP_PORT || 587),
                dbHost: env.DB_SERVER || '',
                dbPort: Number(env.DB_PORT || 3306),
                dbUser: env.DB_USER || '',
                dbPassword: env.DB_PASSWORD || '',
                dbDatabase: env.DB_DATABASE || '',
            });
        }
        catch {
            // skip malformed env files
        }
    }
    return instances.sort((a, b) => a.slug.localeCompare(b.slug));
}
export function getInstance(slug) {
    return loadInstances().find(i => i.slug === slug);
}
