import axios from 'axios';

/**
 * Formata CNPJ para padrão ##.###.###/####-##
 * Ex: 21918918000194 → 21.918.918/0001-94
 */
export function formatCnpj(cnpjDigits: string): string {
  const digits = cnpjDigits.replace(/\D/g, '');
  if (digits.length !== 14) return digits;
  return `${digits.substring(0, 2)}.${digits.substring(2, 5)}.${digits.substring(5, 8)}/${digits.substring(8, 12)}-${digits.substring(12)}`;
}

/**
 * Normaliza string para comparação (lowercase, sem acentos, sem espaços extras)
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calcula score de match entre nome esperado e nome candidato
 * Retorna 0-100
 */
function calculateNameMatchScore(expected: string, candidate: string): number {
  const exp = normalizeString(expected);
  const cand = normalizeString(candidate);
  
  if (exp === cand) return 100;
  if (cand.includes(exp) || exp.includes(cand)) return 80;
  
  // Verificar palavras-chave
  const expWords = exp.split(' ');
  const candWords = cand.split(' ');
  const matchedWords = expWords.filter(w => candWords.includes(w)).length;
  const score = Math.round((matchedWords / expWords.length) * 100);
  
  return Math.max(0, score);
}

/**
 * Busca pessoa por documento com múltiplas estratégias + fallback por razão social
 * Ordem de tentativa:
 * 1. GET /v1/pessoas?documentos=<CNPJ_DIGITS>
 * 2. GET /v1/pessoas?busca=<CNPJ_DIGITS>
 * 3. GET /v1/pessoas?busca=<CNPJ_FORMATADO>
 * 4. GET /v1/pessoas?busca=<RAZAO_SOCIAL> (fallback)
 */
export async function findPessoaByDocumentoV2(
  targetDocumento: string,
  token: string,
  baseUrl: string = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com/v1',
  nomeFallback?: string
): Promise<{
  found: boolean;
  pessoa?: any;
  strategy?: string;
  fullUrl?: string;
  attempts?: Array<{ strategy: string; url: string; status: number; totalItems: number; top3?: any[] }>;
  logs: string[];
}> {
  const logs: string[] = [];
  const attempts: Array<{ strategy: string; url: string; status: number; totalItems: number; top3?: any[] }> = [];
  const targetDigits = targetDocumento.replace(/\D/g, '');
  
  logs.push(`[FindPessoa] Buscando por documento: ${targetDocumento} (digits: ${targetDigits}), fallback: ${nomeFallback || 'none'}`);

  // Estratégia 1: documentos com CNPJ digits
  try {
    const url1 = `${baseUrl}/pessoas?documentos=${encodeURIComponent(targetDigits)}&pagina=1&tamanho_pagina=50`;
    logs.push(`[FindPessoa] Estratégia 1: GET ${url1}`);
    
    const response1 = await axios.get(url1, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      validateStatus: () => true,
    });
    
    const totalItems = response1.data?.totalItems || response1.data?.items?.length || 0;
    const top3 = response1.data?.items?.slice(0, 3).map((p: any) => ({
      id: p.id,
      nome: p.nome,
      documento: p.documento || p.cnpj || p.cpf || '(vazio)',
    })) || [];
    
    attempts.push({
      strategy: 'documentos-digits',
      url: url1,
      status: response1.status,
      totalItems,
      top3,
    });
    
    logs.push(`[FindPessoa] Status: ${response1.status}, totalItems: ${totalItems}`);
    if (top3.length > 0) {
      logs.push(`[FindPessoa] Top 3: ${JSON.stringify(top3)}`);
    }
    
    if (response1.status === 200 && response1.data?.items?.length > 0) {
      const pessoa = response1.data.items[0];
      logs.push(`[FindPessoa] ✅ ENCONTRADO (estratégia 1): id=${pessoa.id}, nome=${pessoa.nome}`);
      return {
        found: true,
        pessoa,
        strategy: 'documentos-digits',
        fullUrl: url1,
        attempts,
        logs,
      };
    }
  } catch (error: any) {
    logs.push(`[FindPessoa] Estratégia 1 erro: ${error?.message}`);
  }

  // Estratégia 2: busca por CNPJ (digits)
  try {
    const url2 = `${baseUrl}/pessoas?busca=${encodeURIComponent(targetDigits)}&pagina=1&tamanho_pagina=50`;
    logs.push(`[FindPessoa] Estratégia 2: GET ${url2}`);
    
    const response2 = await axios.get(url2, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      validateStatus: () => true,
    });
    
    const totalItems = response2.data?.totalItems || response2.data?.items?.length || 0;
    const top3 = response2.data?.items?.slice(0, 3).map((p: any) => ({
      id: p.id,
      nome: p.nome,
      documento: p.documento || p.cnpj || p.cpf || '(vazio)',
    })) || [];
    
    attempts.push({
      strategy: 'busca-digits',
      url: url2,
      status: response2.status,
      totalItems,
      top3,
    });
    
    logs.push(`[FindPessoa] Status: ${response2.status}, totalItems: ${totalItems}`);
    if (top3.length > 0) {
      logs.push(`[FindPessoa] Top 3: ${JSON.stringify(top3)}`);
    }
    
    if (response2.status === 200 && response2.data?.items?.length > 0) {
      const pessoa = response2.data.items[0];
      logs.push(`[FindPessoa] ✅ ENCONTRADO (estratégia 2): id=${pessoa.id}, nome=${pessoa.nome}`);
      return {
        found: true,
        pessoa,
        strategy: 'busca-digits',
        fullUrl: url2,
        attempts,
        logs,
      };
    }
  } catch (error: any) {
    logs.push(`[FindPessoa] Estratégia 2 erro: ${error?.message}`);
  }

  // Estratégia 3: busca por CNPJ formatado
  try {
    const cnpjFormatado = formatCnpj(targetDigits);
    const url3 = `${baseUrl}/pessoas?busca=${encodeURIComponent(cnpjFormatado)}&pagina=1&tamanho_pagina=50`;
    logs.push(`[FindPessoa] Estratégia 3: GET ${url3}`);
    
    const response3 = await axios.get(url3, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      validateStatus: () => true,
    });
    
    const totalItems = response3.data?.totalItems || response3.data?.items?.length || 0;
    const top3 = response3.data?.items?.slice(0, 3).map((p: any) => ({
      id: p.id,
      nome: p.nome,
      documento: p.documento || p.cnpj || p.cpf || '(vazio)',
    })) || [];
    
    attempts.push({
      strategy: 'busca-formatted',
      url: url3,
      status: response3.status,
      totalItems,
      top3,
    });
    
    logs.push(`[FindPessoa] Status: ${response3.status}, totalItems: ${totalItems}`);
    if (top3.length > 0) {
      logs.push(`[FindPessoa] Top 3: ${JSON.stringify(top3)}`);
    }
    
    if (response3.status === 200 && response3.data?.items?.length > 0) {
      const pessoa = response3.data.items[0];
      logs.push(`[FindPessoa] ✅ ENCONTRADO (estratégia 3): id=${pessoa.id}, nome=${pessoa.nome}`);
      return {
        found: true,
        pessoa,
        strategy: 'busca-formatted',
        fullUrl: url3,
        attempts,
        logs,
      };
    }
  } catch (error: any) {
    logs.push(`[FindPessoa] Estratégia 3 erro: ${error?.message}`);
  }

  // Estratégia 4: busca por Razão Social (fallback forte)
  if (nomeFallback) {
    try {
      const url4 = `${baseUrl}/pessoas?busca=${encodeURIComponent(nomeFallback)}&pagina=1&tamanho_pagina=50`;
      logs.push(`[FindPessoa] Estratégia 4 (fallback): GET ${url4}`);
      
      const response4 = await axios.get(url4, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
        validateStatus: () => true,
      });
      
      const totalItems = response4.data?.totalItems || response4.data?.items?.length || 0;
      const top3 = response4.data?.items?.slice(0, 3).map((p: any) => ({
        id: p.id,
        nome: p.nome,
        documento: p.documento || p.cnpj || p.cpf || '(vazio)',
      })) || [];
      
      attempts.push({
        strategy: 'busca-razao-social',
        url: url4,
        status: response4.status,
        totalItems,
        top3,
      });
      
      logs.push(`[FindPessoa] Status: ${response4.status}, totalItems: ${totalItems}`);
      if (top3.length > 0) {
        logs.push(`[FindPessoa] Top 3: ${JSON.stringify(top3)}`);
      }
      
      if (response4.status === 200 && response4.data?.items?.length > 0) {
        // Desambiguação: priorizar por match de nome
        let bestMatch = response4.data.items[0];
        let bestScore = calculateNameMatchScore(nomeFallback, bestMatch.nome);
        
        for (const item of response4.data.items.slice(1)) {
          const score = calculateNameMatchScore(nomeFallback, item.nome);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = item;
          }
        }
        
        logs.push(`[FindPessoa] ✅ ENCONTRADO (estratégia 4, score=${bestScore}): id=${bestMatch.id}, nome=${bestMatch.nome}`);
        return {
          found: true,
          pessoa: bestMatch,
          strategy: 'busca-razao-social',
          fullUrl: url4,
          attempts,
          logs,
        };
      }
    } catch (error: any) {
      logs.push(`[FindPessoa] Estratégia 4 erro: ${error?.message}`);
    }
  }

  logs.push(`[FindPessoa] ❌ Não encontrado em nenhuma estratégia`);
  return {
    found: false,
    attempts,
    logs,
  };
}
