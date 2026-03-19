/**
 * Parser de mensagens do WhatsApp para extrair dados de NFS-e
 * Extrai: descrição, valor, CNPJ
 */

export interface ParsedNfseData {
  descricao?: string;
  valor?: number;
  cnpj?: string;
  confidence: number; // 0-100, indica confiança da extração
  rawMessage: string;
  extractedFields: {
    descricao: boolean;
    valor: boolean;
    cnpj: boolean;
  };
}

/**
 * Normalizar CNPJ removendo caracteres especiais
 */
function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/[^\d]/g, '');
}

/**
 * Normalizar valor monetário
 * Aceita: "1,00", "1.00", "1", "R$ 1,00", etc.
 */
function normalizeValue(valueStr: string): number | null {
  try {
    // Remover "R$" e espaços
    let cleaned = valueStr.replace(/R\$\s*/gi, '').trim();
    
    // Converter vírgula para ponto (formato brasileiro)
    cleaned = cleaned.replace(',', '.');
    
    const parsed = parseFloat(cleaned);
    
    if (isNaN(parsed) || parsed <= 0) {
      return null;
    }
    
    return parsed;
  } catch (error) {
    return null;
  }
}

/**
 * Extrair CNPJ da mensagem
 * Aceita: "21918918000194", "21.918.918/0001-94", etc.
 */
function extractCnpj(message: string): string | null {
  // Padrão: 14 dígitos ou CNPJ formatado
  const cnpjPattern = /(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{14})/g;
  const matches = message.match(cnpjPattern);
  
  if (!matches) {
    return null;
  }
  
  // Normalizar e validar o CNPJ
  for (const match of matches) {
    const normalized = normalizeCnpj(match);
    
    // Validar se tem 14 dígitos
    if (normalized.length === 14) {
      return normalized;
    }
  }
  
  return null;
}

/**
 * Extrair valor monetário da mensagem
 * Procura por padrões como "valor 1,00", "R$ 1.00", etc.
 */
function extractValue(message: string): number | null {
  // Padrões: "valor 1,00", "valor: 1.00", "R$ 1,00", etc.
  const valuePatterns = [
    /valor\s*:?\s*([\d.,]+)/gi,
    /r\$\s*([\d.,]+)/gi,
    /^[\d.,]+/gm, // Número no início da linha
  ];
  
  for (const pattern of valuePatterns) {
    const matches = message.match(pattern);
    
    if (matches) {
      for (const match of matches) {
        // Extrair apenas a parte numérica
        const numericPart = match.replace(/[^\d.,]/g, '');
        const normalized = normalizeValue(numericPart);
        
        if (normalized !== null) {
          return normalized;
        }
      }
    }
  }
  
  return null;
}

/**
 * Extrair descrição do serviço
 * Remove palavras-chave conhecidas e retorna o texto restante
 */
function extractDescription(message: string): string | null {
  // Remover palavras-chave e normalizar
  let cleaned = message
    .replace(/descri[çc]ao\s*:?\s*/gi, '')
    .replace(/valor\s*:?\s*[\d.,]+/gi, '')
    .replace(/cnpj\s*:?\s*[\d.\/-]+/gi, '')
    .replace(/r\$\s*[\d.,]+/gi, '')
    .trim();
  
  // Se ficou vazio, retornar null
  if (!cleaned || cleaned.length < 3) {
    return null;
  }
  
  // Limitar a 255 caracteres
  return cleaned.substring(0, 255);
}

/**
 * Parser principal de mensagem do WhatsApp
 * Extrai descrição, valor e CNPJ
 */
export function parseNfseMessage(message: string): ParsedNfseData {
  const rawMessage = message.trim();
  
  if (!rawMessage || rawMessage.length < 5) {
    return {
      confidence: 0,
      rawMessage,
      extractedFields: {
        descricao: false,
        valor: false,
        cnpj: false,
      },
    };
  }
  
  const cnpj = extractCnpj(rawMessage);
  const valor = extractValue(rawMessage);
  const descricao = extractDescription(rawMessage);
  
  // Calcular confiança
  let confidence = 0;
  const extractedCount = [cnpj, valor, descricao].filter(Boolean).length;
  
  // Cada campo extraído com sucesso = 33% de confiança
  confidence = extractedCount * 33;
  
  // Se extraiu todos os 3 campos, aumentar confiança
  if (cnpj && valor && descricao) {
    confidence = 95;
  }
  
  return {
    descricao: descricao || undefined,
    valor: valor || undefined,
    cnpj: cnpj || undefined,
    confidence,
    rawMessage,
    extractedFields: {
      descricao: !!descricao,
      valor: !!valor,
      cnpj: !!cnpj,
    },
  };
}

/**
 * Validar se os dados extraídos são suficientes para emissão
 */
export function isNfseDataComplete(data: ParsedNfseData): boolean {
  return !!(data.descricao && data.valor && data.cnpj && data.valor > 0);
}

/**
 * Gerar mensagem de erro com campos faltantes
 */
export function getMissingFieldsMessage(data: ParsedNfseData): string[] {
  const missing: string[] = [];
  
  if (!data.extractedFields.descricao) {
    missing.push("Descrição do serviço");
  }
  
  if (!data.extractedFields.valor) {
    missing.push("Valor do serviço");
  }
  
  if (!data.extractedFields.cnpj) {
    missing.push("CNPJ");
  }
  
  return missing;
}
