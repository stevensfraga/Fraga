/**
 * PADRONIZAR LINK DE PAGAMENTO (SEM PDF)
 * 
 * Resolve o link canônico de pagamento com prioridade:
 * A) fatura_url (Conta Azul público) - PREFERIDO
 * B) boleto_url / linha_digitavel / código_barras
 * C) null (bloquear envio)
 */

export interface PaymentLinkSource {
  fatura_url?: string | null;
  boleto_url?: string | null;
  linha_digitavel?: string | null;
  codigo_barras?: string | null;
  link?: string | null; // Campo do DB local
}

export interface PaymentLinkResult {
  canonical: string | null;
  source: 'fatura_url' | 'boleto_url' | 'linha_digitavel' | 'link_db' | 'none';
  reason?: string;
}

/**
 * Resolve o link canônico de pagamento
 * 
 * PRIORIDADE:
 * 1. fatura_url da API Conta Azul (link público da fatura)
 * 2. link do DB local se contém "faturas.contaazul.com"
 * 3. boleto_url da API
 * 4. linha_digitavel (retorna como "linha:XXXXX")
 * 5. null (sem link disponível)
 * 
 * @param receivable - Dados do receivable (DB local ou API)
 * @param apiData - Dados da API Conta Azul (opcional, prioridade sobre DB)
 */
export function resolvePaymentLink(
  receivable: PaymentLinkSource,
  apiData?: PaymentLinkSource
): PaymentLinkResult {
  // 1. Prioridade MÁXIMA: fatura_url da API
  if (apiData?.fatura_url && apiData.fatura_url.includes('faturas.contaazul.com')) {
    return {
      canonical: apiData.fatura_url,
      source: 'fatura_url',
    };
  }

  // 2. Se não tem API, mas tem link do DB que é fatura Conta Azul
  if (receivable.link && receivable.link.includes('faturas.contaazul.com')) {
    return {
      canonical: receivable.link,
      source: 'link_db',
    };
  }

  // 3. Fallback: boleto_url da API ou DB
  const boletoUrl = apiData?.boleto_url || receivable.boleto_url;
  if (boletoUrl && boletoUrl.startsWith('http')) {
    return {
      canonical: boletoUrl,
      source: 'boleto_url',
    };
  }

  // 4. Fallback: linha digitável (não é link, mas pode ser usado)
  const linhaDigitavel = apiData?.linha_digitavel || receivable.linha_digitavel;
  if (linhaDigitavel && linhaDigitavel.length > 40) {
    return {
      canonical: `linha:${linhaDigitavel}`,
      source: 'linha_digitavel',
      reason: 'Linha digitável disponível (não é link HTTP)',
    };
  }

  // 5. Sem link disponível
  return {
    canonical: null,
    source: 'none',
    reason: 'Nenhum link de pagamento disponível (fatura_url, boleto_url ou linha_digitavel)',
  };
}

/**
 * Valida se um link canônico é válido para envio
 */
export function isValidPaymentLink(canonical: string | null): boolean {
  if (!canonical) return false;
  
  // Links HTTP válidos
  if (canonical.startsWith('http://') || canonical.startsWith('https://')) {
    return true;
  }
  
  // Linha digitável (não é link, mas é válido para envio manual)
  if (canonical.startsWith('linha:')) {
    return true;
  }
  
  return false;
}

/**
 * Formata o link canônico para exibição na mensagem
 */
export function formatPaymentLinkForMessage(canonical: string | null): string {
  if (!canonical) {
    return 'Link não disponível';
  }
  
  // Se é linha digitável, formatar para exibição
  if (canonical.startsWith('linha:')) {
    const linha = canonical.replace('linha:', '');
    return `Linha digitável:\n${linha}`;
  }
  
  // Link HTTP normal
  return canonical;
}
