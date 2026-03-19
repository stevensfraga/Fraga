/**
 * Extração robusta de dados de boleto do Conta Azul services
 * - Logging bruto de todas as respostas
 * - Extração recursiva de URLs/PIX/linha
 * - Fallback completo (summary → charge → installments)
 */

interface ExtractionResult {
  pdfUrl?: string;
  pix?: string;
  linhaDigitavel?: string;
  nossoNumero?: string;
  status?: string;
  source?: 'summary' | 'chargeRequest' | 'installmentView';
  confidence?: number;
}

interface RawSnapshot {
  endpoint: string;
  httpStatus: number;
  keys: string[];
  length: number;
  error?: string;
}

const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
};

/**
 * Extrair URLs procurando por padrões comuns
 */
function extractFirstUrlByPatterns(obj: any, depth = 0, maxDepth = 10): string | null {
  if (depth > maxDepth) return null;
  if (!obj) return null;

  const urlPatterns = [
    'pdfUrl', 'pdf_url', 'url_pdf', 'boletoUrl', 'boleto_url', 'boleto',
    'pdf', 'linkPdf', 'link_pdf', 'downloadUrl', 'download_url', 'arquivo',
    'file', 'signedUrl', 'signed_url', 'links', 'url', 'link', 'href'
  ];

  // Se é string, verificar se parece URL
  if (typeof obj === 'string') {
    if (obj.includes('.pdf') || obj.includes('/storage/') || obj.includes('boleto')) {
      return obj;
    }
    return null;
  }

  // Se é array, procurar em cada item
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = extractFirstUrlByPatterns(item, depth + 1, maxDepth);
      if (result) return result;
    }
    return null;
  }

  // Se é objeto, procurar em chaves conhecidas
  if (typeof obj === 'object') {
    // Primeiro, procurar em chaves conhecidas
    for (const pattern of urlPatterns) {
      const value = obj[pattern];
      if (typeof value === 'string' && (value.includes('.pdf') || value.includes('/storage/') || value.includes('boleto'))) {
        return value;
      }
    }

    // Se não encontrou, varrer recursivamente
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && (value.includes('.pdf') || value.includes('/storage/') || value.includes('boleto'))) {
        return value;
      }
      if (typeof value === 'object') {
        const result = extractFirstUrlByPatterns(value, depth + 1, maxDepth);
        if (result) return result;
      }
    }
  }

  return null;
}

/**
 * Extrair PIX procurando por padrões
 */
function extractPix(obj: any, depth = 0, maxDepth = 5): string | null {
  if (depth > maxDepth) return null;
  if (!obj) return null;

  const pixPatterns = ['pix', 'pixCopiaECola', 'copiaECola', 'copia_cola', 'qrCode', 'qr_code', 'qr', 'copiaecola'];

  if (typeof obj === 'string') {
    if (obj.length > 50 && obj.length < 300) return obj; // PIX é geralmente longo
    return null;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = extractPix(item, depth + 1, maxDepth);
      if (result) return result;
    }
    return null;
  }

  if (typeof obj === 'object') {
    for (const pattern of pixPatterns) {
      const value = obj[pattern];
      if (typeof value === 'string' && value.length > 50) {
        return value;
      }
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase().includes('pix') && typeof value === 'string' && value.length > 50) {
        return value;
      }
      if (typeof value === 'object') {
        const result = extractPix(value, depth + 1, maxDepth);
        if (result) return result;
      }
    }
  }

  return null;
}

/**
 * Extrair linha digitável
 */
function extractLinhaDigitavel(obj: any, depth = 0, maxDepth = 5): string | null {
  if (depth > maxDepth) return null;
  if (!obj) return null;

  const patterns = ['linhaDigitavel', 'linha_digitavel', 'barcode', 'codigoBarras', 'codigo_barras', 'linha', 'line'];

  if (typeof obj === 'string') {
    // Linha digitável tem ~47 caracteres, todos números
    if (/^\d{47}$/.test(obj.replace(/\s/g, ''))) {
      return obj;
    }
    return null;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = extractLinhaDigitavel(item, depth + 1, maxDepth);
      if (result) return result;
    }
    return null;
  }

  if (typeof obj === 'object') {
    for (const pattern of patterns) {
      const value = obj[pattern];
      if (typeof value === 'string' && /^\d{47}$/.test(value.replace(/\s/g, ''))) {
        return value;
      }
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase().includes('linha') || key.toLowerCase().includes('barcode')) {
        if (typeof value === 'string' && /^\d{47}$/.test(value.replace(/\s/g, ''))) {
          return value;
        }
      }
      if (typeof value === 'object') {
        const result = extractLinhaDigitavel(value, depth + 1, maxDepth);
        if (result) return result;
      }
    }
  }

  return null;
}

/**
 * Logar snapshot bruto da resposta
 */
function logRawSnapshot(endpoint: string, response: any, status: number, error?: string): RawSnapshot {
  const snapshot: RawSnapshot = {
    endpoint,
    httpStatus: status,
    keys: response && typeof response === 'object' ? Object.keys(response) : [],
    length: JSON.stringify(response).length,
    error,
  };

  logger.info(`[SNAPSHOT] ${endpoint}: HTTP ${status}, keys=${snapshot.keys.join(',')}, size=${snapshot.length}B`);

  return snapshot;
}

export {
  ExtractionResult,
  RawSnapshot,
  extractFirstUrlByPatterns,
  extractPix,
  extractLinhaDigitavel,
  logRawSnapshot,
};
