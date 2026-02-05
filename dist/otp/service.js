import { getSupabaseAdmin } from '../supabase/client.js';
import { sendOtpEmail } from '../email/smtp.js';
import { logAudit } from '../supabase/audit.js';
function generateOtpCode() {
    const n = Math.floor(100000 + Math.random() * 900000);
    return String(n);
}
export async function createAndSendOtp(config, params) {
    // Modo mock: não envia e-mail nem grava OTP, apenas registra auditoria
    if (config.otpMock) {
        await logAudit(config, {
            whatsappPhone: params.phone ?? '',
            cpf: params.cpf,
            action: 'otp_sent_mock',
            payload: { email: params.email }
        });
        return;
    }
    const supabase = getSupabaseAdmin(config);
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + config.otpExpiresMinutes * 60 * 1000).toISOString();
    const { error } = await supabase.from('otp_codes').insert({
        phone: params.phone ?? null,
        cpf: params.cpf,
        email: params.email,
        code,
        expires_at: expiresAt
    });
    if (error)
        throw error;
    await sendOtpEmail(config, { to: params.email, code, cpf: params.cpf });
    await logAudit(config, {
        whatsappPhone: params.phone ?? '',
        cpf: params.cpf,
        action: 'otp_sent',
        payload: { email: params.email }
    });
}
export async function verifyOtp(config, params) {
    // Modo mock: sempre considera o código válido para facilitar testes
    if (config.otpMock) {
        await logAudit(config, {
            whatsappPhone: '',
            cpf: params.cpf,
            action: 'otp_verified_mock',
            payload: { email: params.email, code: params.code }
        });
        return true;
    }
    const supabase = getSupabaseAdmin(config);
    // Busca o último OTP gerado para o CPF/e-mail
    const { data, error } = await supabase
        .from('otp_codes')
        .select('id, code, expires_at, used_at, attempts')
        .eq('cpf', params.cpf)
        .eq('email', params.email)
        .order('created_at', { ascending: false })
        .limit(1);
    if (error)
        throw error;
    if (!data || data.length === 0)
        return false;
    const record = data[0];
    const now = new Date();
    // Expirado ou já usado
    if (record.used_at)
        return false;
    if (new Date(record.expires_at).getTime() < now.getTime())
        return false;
    if ((record.attempts ?? 0) >= config.otpMaxAttempts)
        return false;
    const isValid = String(record.code) === String(params.code);
    if (isValid) {
        const { error: updErr } = await supabase
            .from('otp_codes')
            .update({ used_at: now.toISOString(), attempts: (record.attempts ?? 0) + 1 })
            .eq('id', record.id);
        if (updErr)
            throw updErr;
        await logAudit(config, { whatsappPhone: '', cpf: params.cpf, action: 'otp_verified', payload: { email: params.email } });
        return true;
    }
    else {
        const { error: incErr } = await supabase
            .from('otp_codes')
            .update({ attempts: (record.attempts ?? 0) + 1 })
            .eq('id', record.id);
        if (incErr)
            throw incErr;
        return false;
    }
}
