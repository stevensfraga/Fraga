/**
 * Normalização centralizada de números de WhatsApp para formato E.164
 * 
 * REGRAS:
 * 1. Remover espaços, traços, parênteses, pontos
 * 2. Se começar com 0, remover
 * 3. Se não começar com 55, adicionar 55
 * 4. Garantir formato E.164 final: +55XXXXXXXXXXX
 * 5. Validar 10 ou 11 dígitos após DDD (55)
 * 6. Se inválido → retornar null
 * 
 * EXEMPLOS:
 * - "27992052149" → "+5527992052149"
 * - "+55 27 99971-1752" → "+5527999711752"
 * - "0 27 9 9971-1752" → "+5527999711752"
 * - "(27) 99971-1752" → "+5527999711752"
 * - "invalid" → null
 * - "123" → null
 */

export function normalizeWhatsApp(phone: string | null | undefined): string | null {
  if (!phone) return null;

  // 1. Remover todos os caracteres não-numéricos
  let clean = phone.replace(/\D/g, '');

  // 2. Se começar com 0, remover
  if (clean.startsWith('0')) {
    clean = clean.substring(1);
  }

  // 3. Se não começar com 55, adicionar 55
  if (!clean.startsWith('55')) {
    clean = '55' + clean;
  }

  // 4. Validar comprimento: deve ter 12 ou 13 dígitos (55 + DDD + 8-9 dígitos)
  // 55 + 2 dígitos DDD + 8 ou 9 dígitos = 12 ou 13
  if (clean.length < 12 || clean.length > 13) {
    console.warn(`[normalizeWhatsApp] Invalid length: ${clean.length} (input: ${phone})`);
    return null;
  }

  // 5. Validar DDD (primeiros 2 dígitos após 55)
  const ddd = clean.substring(2, 4);
  const dddInt = parseInt(ddd, 10);
  
  // DDDs válidos no Brasil: 11-99 (exceto alguns não usados)
  if (dddInt < 11 || dddInt > 99) {
    console.warn(`[normalizeWhatsApp] Invalid DDD: ${ddd} (input: ${phone})`);
    return null;
  }

  // 6. Validar número após DDD (8 ou 9 dígitos)
  const numero = clean.substring(4);
  if (numero.length < 8 || numero.length > 9) {
    console.warn(`[normalizeWhatsApp] Invalid number length: ${numero.length} (input: ${phone})`);
    return null;
  }

  // 7. Adicionar prefixo + e retornar
  return '+' + clean;
}

/**
 * Validar se um número de WhatsApp está no formato E.164 correto
 */
export function isValidWhatsAppE164(phone: string | null | undefined): boolean {
  if (!phone) return false;
  
  // Deve começar com +55
  if (!phone.startsWith('+55')) return false;
  
  // Deve ter 13 ou 14 caracteres (+55 + 10 ou 11 dígitos)
  if (phone.length < 13 || phone.length > 14) return false;
  
  // Deve ter apenas dígitos após +55
  const digits = phone.substring(3);
  if (!/^\d+$/.test(digits)) return false;
  
  return true;
}

/**
 * Log de validação para números inválidos
 */
export function logInvalidWhatsApp(clientId: number, rawInput: string, reason: string): void {
  console.warn(`[WhatsAppInvalid] clientId=${clientId} rawInput="${rawInput}" reason="${reason}"`);
}
