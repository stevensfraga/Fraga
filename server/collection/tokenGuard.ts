/**
 * TOKEN GUARD — Verificar se token Conta Azul está válido antes de enviar mensagens
 * 
 * Objetivo: Abortar pipeline se REAUTH_REQUIRED para evitar falhas em cascata
 */

import axios from 'axios';
import { getValidAccessToken } from '../contaAzulOAuthManager';

export interface TokenHealthResult {
  ok: boolean;
  decision: 'TOKEN_OK' | 'REAUTH_REQUIRED' | 'FORBIDDEN' | 'ENDPOINT_WRONG' | 'ERROR';
  apiTestOk: boolean;
  apiTestStatus: number | null;
  endpointTested: string;
  baseUrlUsed: string;
  message: string;
}

/**
 * Verificar saúde do token OAuth Conta Azul
 * 
 * Testa:
 * 1. Token existe no banco
 * 2. Token não está expirado
 * 3. API Conta Azul responde 200 (GET /v1/pessoas?limit=1)
 * 
 * Retorna:
 * - OK: Token válido e API respondendo
 * - REAUTH_REQUIRED: Token inválido ou API retornando 401
 * - ERROR: Erro inesperado
 */
export async function checkTokenHealth(): Promise<TokenHealthResult> {
  try {
    console.log('[TokenGuard] Verificando saúde do token Conta Azul...');
    
    // 1. Tentar obter token válido (já faz refresh se necessário)
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
      console.log('[TokenGuard] ✅ Token obtido do banco');
    } catch (error: any) {
      console.error('[TokenGuard] ❌ Erro ao obter token:', error.message);
      return {
        ok: false,
        decision: 'REAUTH_REQUIRED',
        apiTestOk: false,
        apiTestStatus: null,
        endpointTested: 'N/A',
        baseUrlUsed: 'N/A',
        message: `Token não disponível: ${error.message}`,
      };
    }
    
    // 2. Testar API Conta Azul com endpoint de receivables (mesmo usado no sync)
    // CONTA_AZUL_API_BASE já contém /v1 no final
    const baseUrl = process.env.CONTA_AZUL_API_BASE || 'https://api-v2.contaazul.com/v1';
    
    // Gerar datas para query (hoje-7d até hoje+1d)
    const hoje = new Date();
    const seteDiasAtras = new Date(hoje);
    seteDiasAtras.setDate(hoje.getDate() - 7);
    const amanha = new Date(hoje);
    amanha.setDate(hoje.getDate() + 1);
    
    const dataVencimentoDe = seteDiasAtras.toISOString().split('T')[0]; // YYYY-MM-DD
    const dataVencimentoAte = amanha.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // NÃO adicionar /v1 novamente (já está no baseUrl)
    const testUrl = `${baseUrl}/financeiro/eventos-financeiros/contas-a-receber/buscar?data_vencimento_de=${dataVencimentoDe}&data_vencimento_ate=${dataVencimentoAte}`;
    
    try {
      console.log('[TokenGuard] Testando API Conta Azul...');
      const response = await axios.get(testUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 10000, // 10s timeout
      });
      
      if (response.status === 200) {
        console.log('[TokenGuard] ✅ API Conta Azul respondendo (200)');
        return {
          ok: true,
          decision: 'TOKEN_OK',
          apiTestOk: true,
          apiTestStatus: 200,
          endpointTested: testUrl,
          baseUrlUsed: baseUrl,
          message: 'Token válido e API respondendo',
        };
      }
      
      console.warn(`[TokenGuard] ⚠️ API Conta Azul retornou status inesperado: ${response.status}`);
      return {
        ok: false,
        decision: 'ERROR',
        apiTestOk: false,
        apiTestStatus: response.status,
        endpointTested: testUrl,
        baseUrlUsed: baseUrl,
        message: `API retornou status ${response.status}`,
      };
      
    } catch (error: any) {
      const status = error.response?.status;
      
      if (status === 401) {
        console.error('[TokenGuard] ❌ API retornou 401 (Unauthorized) - REAUTH_REQUIRED');
        return {
          ok: false,
          decision: 'REAUTH_REQUIRED',
          apiTestOk: false,
          apiTestStatus: 401,
          endpointTested: testUrl,
          baseUrlUsed: baseUrl,
          message: 'Token inválido (401) - Reautorização necessária',
        };
      }
      
      if (status === 403) {
        console.error('[TokenGuard] ❌ API retornou 403 (Forbidden) - Token válido mas sem permissão');
        return {
          ok: false,
          decision: 'FORBIDDEN',
          apiTestOk: false,
          apiTestStatus: 403,
          endpointTested: testUrl,
          baseUrlUsed: baseUrl,
          message: 'Token válido mas sem permissão (403) - Verificar escopo OAuth',
        };
      }
      
      if (status === 404) {
        console.error('[TokenGuard] ❌ API retornou 404 (Not Found) - Endpoint de teste inválido');
        return {
          ok: false,
          decision: 'ENDPOINT_WRONG',
          apiTestOk: false,
          apiTestStatus: 404,
          endpointTested: testUrl,
          baseUrlUsed: baseUrl,
          message: 'Endpoint de teste inválido (404) - Verificar baseURL ou endpoint',
        };
      }
      
      console.error(`[TokenGuard] ❌ Erro ao testar API: ${error.message}`);
      return {
        ok: false,
        decision: 'ERROR',
        apiTestOk: false,
        apiTestStatus: status || null,
        endpointTested: testUrl,
        baseUrlUsed: baseUrl,
        message: `Erro ao testar API: ${error.message}`,
      };
    }
    
  } catch (error: any) {
    console.error('[TokenGuard] ❌ Erro inesperado:', error.message);
    return {
      ok: false,
      decision: 'ERROR',
      apiTestOk: false,
      apiTestStatus: null,
      endpointTested: 'N/A',
      baseUrlUsed: 'N/A',
      message: `Erro inesperado: ${error.message}`,
    };
  }
}
