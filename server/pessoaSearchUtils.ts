/**
 * 🔧 Utilitários para busca de pessoa no Conta Azul
 * Normaliza documento e nome, pagina até encontrar
 */

import axios from 'axios';

/**
 * 🔧 Normalizar documento (CNPJ/CPF): extrair apenas dígitos
 */
export function onlyDigits(str: string): string {
  return (str || '').replace(/\D/g, '');
}

/**
 * 🔍 Normalizar nome: lowercase + remover acentos
 */
export function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * 🎯 Buscar pessoa por documento (com fallback para nome)
 * Pagina até achar match
 */
export async function findPessoaByDocumento(
  targetDocumento: string,
  targetNome?: string,
  token?: string
): Promise<{
  found: boolean;
  pessoa?: any;
  stats: {
    pagesScanned: number;
    matchesByDoc: number;
    matchesByName: number;
    totalProcessed: number;
  };
  logs: string[];
}> {
  const logs: string[] = [];
  const stats = {
    pagesScanned: 0,
    matchesByDoc: 0,
    matchesByName: 0,
    totalProcessed: 0,
  };

  const targetDigits = onlyDigits(targetDocumento);
  const targetNameNorm = normalizeName(targetNome || '');

  logs.push(`[FindPessoa] Buscando por documento: ${targetDocumento} (digits: ${targetDigits})`);
  if (targetNome) {
    logs.push(`[FindPessoa] Buscando também por nome: ${targetNome} (norm: ${targetNameNorm})`);
  }

  try {
    // Paginar até encontrar
    for (let page = 1; page <= 10; page++) {
      logs.push(`[FindPessoa] Página ${page}...`);
      stats.pagesScanned++;

      const response = await axios.get(
        `${process.env.CONTA_AZUL_API_BASE}/pessoas?pagina=${page}&tamanho_pagina=100`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const pessoas = response.data.items || response.data.data || [];
      if (pessoas.length === 0) {
        logs.push(`[FindPessoa] Página ${page} vazia, parando busca`);
        break;
      }

      for (const p of pessoas) {
        stats.totalProcessed++;
        const nomeDigits = onlyDigits(p.nome || '');
        const docDigits = onlyDigits(p.documento || '');
        const effectiveDocDigits = docDigits || nomeDigits;
        const nomeNorm = normalizeName(p.nome || '');

        // Match por documento
        if (effectiveDocDigits === targetDigits) {
          logs.push(`[FindPessoa] ✅ MATCH por documento: ${p.nome} (${effectiveDocDigits})`);
          stats.matchesByDoc++;
          return {
            found: true,
            pessoa: p,
            stats,
            logs,
          };
        }

        // Match por nome (contains)
        if (targetNameNorm && nomeNorm.includes(targetNameNorm)) {
          logs.push(`[FindPessoa] ✅ MATCH por nome: ${p.nome}`);
          stats.matchesByName++;
          return {
            found: true,
            pessoa: p,
            stats,
            logs,
          };
        }

        // Log de exemplo (primeiros 5)
        if (stats.totalProcessed <= 5) {
          logs.push(
            `[FindPessoa] Ex ${stats.totalProcessed}: nome="${p.nome}" | doc="${p.documento}" | effectiveDoc="${effectiveDocDigits}"`
          );
        }
      }
    }

    logs.push(`[FindPessoa] ❌ Não encontrado após ${stats.pagesScanned} páginas (${stats.totalProcessed} registros)`);
    return {
      found: false,
      stats,
      logs,
    };
  } catch (error: any) {
    // Logging detalhado do erro
    logs.push(`[FindPessoa] ERRO: ${error?.message}`);
    
    if (error?.response) {
      logs.push(`[FindPessoa] HTTP Status: ${error.response.status}`);
      logs.push(`[FindPessoa] Response Data: ${JSON.stringify(error.response.data)}`);
      logs.push(`[FindPessoa] Request URL: ${error.config?.url}`);
      logs.push(`[FindPessoa] Request Method: ${error.config?.method}`);
      if (error.response.headers['x-request-id']) {
        logs.push(`[FindPessoa] Request-ID: ${error.response.headers['x-request-id']}`);
      }
    }
    
    return {
      found: false,
      stats,
      logs,
    };
  }
}
