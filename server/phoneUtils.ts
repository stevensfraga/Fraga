/**
 * 📱 Utilitários de Telefone para WhatsApp
 * 
 * Responsabilidades:
 * 1. Normalizar telefone para formato E.164
 * 2. Implementar fallback celular → comercial
 * 3. Validar formato BR (10 ou 11 dígitos)
 */

/**
 * Normalizar telefone para formato E.164
 * Entrada: "(61) 9246-1717" ou "61 9246-1717" ou "6192461717"
 * Saída: "+5561992461717" (11 dígitos com 9) ou "+556192461717" (10 dígitos)
 */
export function normalizePhoneToE164(phone: string | null | undefined): string | null {
  if (!phone || typeof phone !== 'string') {
    console.log(`[WASync] PHONE_PICK source=none raw=null e164=null valid=false`);
    return null;
  }

  try {
    // Remover todos os caracteres não-dígitos
    const cleaned = phone.replace(/\D/g, '');

    if (!cleaned) {
      console.log(`[WASync] PHONE_PICK source=invalid raw="${phone}" e164=null valid=false`);
      return null;
    }

    // Validar comprimento: 10 ou 11 dígitos BR
    if (cleaned.length === 10 || cleaned.length === 11) {
      // Se não começar com 55, prefixar
      let e164 = cleaned;
      if (!e164.startsWith('55')) {
        e164 = '55' + e164;
      }

      const result = `+${e164}`;
      console.log(`[WASync] PHONE_PICK source=normalized raw="${phone}" e164="${result}" valid=true`);
      return result;
    } else {
      console.log(
        `[WASync] PHONE_PICK source=invalid_length raw="${phone}" digits=${cleaned.length} e164=null valid=false`
      );
      return null;
    }
  } catch (error: any) {
    console.error(`[WASync] PHONE_PICK ERROR: ${error?.message}`);
    return null;
  }
}

/**
 * Selecionar telefone com fallback celular → comercial
 * Prioridade:
 * 1. phoneCellular (celular)
 * 2. phone (comercial)
 * 3. null (bloquear)
 */
export function selectPhoneWithFallback(
  phoneCellular: string | null | undefined,
  phoneCommercial: string | null | undefined
): { phone: string | null; source: 'cell' | 'commercial' | 'none'; raw: string | null } {
  // Tentar celular
  if (phoneCellular) {
    const normalized = normalizePhoneToE164(phoneCellular);
    if (normalized) {
      console.log(`[WASync] PHONE_PICK source=cell raw="${phoneCellular}" e164="${normalized}" valid=true`);
      return { phone: normalized, source: 'cell', raw: phoneCellular };
    }
  }

  // Fallback para comercial
  if (phoneCommercial) {
    const normalized = normalizePhoneToE164(phoneCommercial);
    if (normalized) {
      console.log(`[WASync] PHONE_PICK source=commercial raw="${phoneCommercial}" e164="${normalized}" valid=true`);
      return { phone: normalized, source: 'commercial', raw: phoneCommercial };
    }
  }

  // Nenhum válido
  console.log(
    `[WASync] PHONE_PICK source=none raw=null e164=null valid=false cell="${phoneCellular}" commercial="${phoneCommercial}"`
  );
  return { phone: null, source: 'none', raw: null };
}

/**
 * Validar se telefone é válido em formato E.164
 */
export function isValidE164(phone: string | null | undefined): boolean {
  if (!phone || typeof phone !== 'string') {
    return false;
  }

  // Padrão E.164: +55 (código país) + DD (2 dígitos) + 9 (1 dígito) + XXXXXXXX (8 dígitos)
  // Exemplos válidos:
  // +5561992461717 (11 dígitos com 9)
  // +556192461717 (10 dígitos)
  const e164Pattern = /^\+55\d{10,11}$/;
  return e164Pattern.test(phone);
}
