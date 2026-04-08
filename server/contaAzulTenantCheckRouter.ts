/**
 * 🏢 Conta Azul Tenant Check Router
 * Verificar qual empresa/tenant está conectada ao token OAuth
 * Retorna: companyName, companyCnpj, organizationId
 * 
 * CRÍTICO: Validar se CNPJ = 07.838.084/0001-86 (Fraga Contabilidade)
 * 
 * GET /api/test/conta-azul/tenant-check
 */

import { Router } from 'express';
import * as crypto from 'crypto';
import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = Router();
const CONTA_AZUL_API_BASE = 'https://api-v2.contaazul.com';

function devOnly(req: any, res: any): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  const devSecret = process.env.DEV_SECRET;
  if (!devSecret) {
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
  }

  const headerSecret = req.headers['x-dev-secret'];
  let isValidSecret = false;
  try {
    const headerBuf = Buffer.from(headerSecret || '');
    const devSecretBuf = Buffer.from(devSecret);
    if (headerBuf.length === devSecretBuf.length) {
      isValidSecret = crypto.timingSafeEqual(headerBuf, devSecretBuf);
    }
  } catch (e) {
    isValidSecret = false;
  }

  if (!isValidSecret) {
    return res.status(403).json({ success: false, error: 'FORBIDDEN' });
  }

  return true;
}

/**
 * Tentar múltiplos endpoints para descobrir dados da empresa
 */
async function discoverTenantInfo(accessToken: string): Promise<{
  endpoint: string;
  httpStatus: number;
  success: boolean;
  companyName?: string;
  companyCnpj?: string;
  organizationId?: string;
  raw?: any;
  error?: string;
}[]> {
  const attempts: any[] = [];

  // Tentativa 1: GET /empresa (endpoint mais comum)
  try {
    console.log('[TenantCheck] Tentando GET /empresa');
    const response = await axios.get(`${CONTA_AZUL_API_BASE}/empresa`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const data = response.data;
    console.log('[TenantCheck] GET /empresa sucesso:', data);

    attempts.push({
      endpoint: 'GET /v1/empresa',
      httpStatus: response.status,
      success: true,
      companyName: data?.nome || data?.name || data?.razao_social,
      companyCnpj: data?.cnpj || data?.document || data?.cpf_cnpj,
      organizationId: data?.id || data?.uuid || data?.organization_id,
      raw: data,
    });
  } catch (err: any) {
    const status = err.response?.status || 0;
    console.log('[TenantCheck] GET /empresa falhou:', status, err.message);
    attempts.push({
      endpoint: 'GET /v1/empresa',
      httpStatus: status,
      success: false,
      error: err.message,
    });
  }

  // Tentativa 2: GET /organizacao
  try {
    console.log('[TenantCheck] Tentando GET /organizacao');
    const response = await axios.get(`${CONTA_AZUL_API_BASE}/organizacao`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const data = response.data;
    console.log('[TenantCheck] GET /organizacao sucesso:', data);

    attempts.push({
      endpoint: 'GET /v1/organizacao',
      httpStatus: response.status,
      success: true,
      companyName: data?.nome || data?.name || data?.razao_social,
      companyCnpj: data?.cnpj || data?.document || data?.cpf_cnpj,
      organizationId: data?.id || data?.uuid || data?.organization_id,
      raw: data,
    });
  } catch (err: any) {
    const status = err.response?.status || 0;
    console.log('[TenantCheck] GET /organizacao falhou:', status, err.message);
    attempts.push({
      endpoint: 'GET /v1/organizacao',
      httpStatus: status,
      success: false,
      error: err.message,
    });
  }

  // Tentativa 3: GET /me (endpoint de perfil do usuário)
  try {
    console.log('[TenantCheck] Tentando GET /me');
    const response = await axios.get(`${CONTA_AZUL_API_BASE}/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const data = response.data;
    console.log('[TenantCheck] GET /me sucesso:', data);

    attempts.push({
      endpoint: 'GET /v1/me',
      httpStatus: response.status,
      success: true,
      companyName: data?.company?.nome || data?.empresa?.nome || data?.organization?.name,
      companyCnpj: data?.company?.cnpj || data?.empresa?.cnpj || data?.organization?.cnpj,
      organizationId: data?.company?.id || data?.empresa?.id || data?.organization?.id,
      raw: data,
    });
  } catch (err: any) {
    const status = err.response?.status || 0;
    console.log('[TenantCheck] GET /me falhou:', status, err.message);
    attempts.push({
      endpoint: 'GET /v1/me',
      httpStatus: status,
      success: false,
      error: err.message,
    });
  }

  // Tentativa 4: GET /conta (dados da conta)
  try {
    console.log('[TenantCheck] Tentando GET /conta');
    const response = await axios.get(`${CONTA_AZUL_API_BASE}/conta`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const data = response.data;
    console.log('[TenantCheck] GET /conta sucesso:', data);

    attempts.push({
      endpoint: 'GET /v1/conta',
      httpStatus: response.status,
      success: true,
      companyName: data?.nome || data?.name || data?.razao_social,
      companyCnpj: data?.cnpj || data?.document || data?.cpf_cnpj,
      organizationId: data?.id || data?.uuid || data?.account_id,
      raw: data,
    });
  } catch (err: any) {
    const status = err.response?.status || 0;
    console.log('[TenantCheck] GET /conta falhou:', status, err.message);
    attempts.push({
      endpoint: 'GET /v1/conta',
      httpStatus: status,
      success: false,
      error: err.message,
    });
  }

  // Tentativa 5: GET /clientes?limit=1 (para extrair info do header ou resposta)
  try {
    console.log('[TenantCheck] Tentando GET /clientes?limit=1');
    const response = await axios.get(`${CONTA_AZUL_API_BASE}/clientes?limit=1`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const data = response.data;
    console.log('[TenantCheck] GET /clientes sucesso (headers):', response.headers);

    attempts.push({
      endpoint: 'GET /v1/clientes?limit=1',
      httpStatus: response.status,
      success: true,
      companyName: response.headers['x-company-name'] || response.headers['x-organization-name'],
      companyCnpj: response.headers['x-company-cnpj'] || response.headers['x-organization-cnpj'],
      organizationId: response.headers['x-organization-id'] || response.headers['x-company-id'],
      raw: {
        dataCount: data?.data?.length || 0,
        headers: response.headers,
      },
    });
  } catch (err: any) {
    const status = err.response?.status || 0;
    console.log('[TenantCheck] GET /clientes falhou:', status, err.message);
    attempts.push({
      endpoint: 'GET /v1/clientes?limit=1',
      httpStatus: status,
      success: false,
      error: err.message,
    });
  }

  return attempts;
}

router.get('/tenant-check', async (req, res) => {
  if (!devOnly(req, res)) return;

  try {
    console.log('[TenantCheck] INICIANDO VERIFICAÇÃO DE TENANT');

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
      console.log('[TenantCheck] TOKEN_OBTIDO');
    } catch (err: any) {
      console.error('[TenantCheck] TOKEN_ERROR:', err?.message);
      return res.status(401).json({
        success: false,
        httpStatus: 401,
        error: 'OAUTH_TOKEN_INVALID',
        message: err?.message,
        companyName: null,
        companyCnpj: null,
        organizationId: null,
        nextAction: 'Reautorizar OAuth no painel Conta Azul',
      });
    }

    // Descobrir informações do tenant
    const attempts = await discoverTenantInfo(accessToken);
    console.log('[TenantCheck] DESCOBERTA_COMPLETA:', attempts.length, 'tentativas');

    // Extrair primeira tentativa bem-sucedida
    const successAttempt = attempts.find((a) => a.success);

    if (!successAttempt) {
      console.error('[TenantCheck] NENHUMA_TENTATIVA_SUCESSO');
      return res.status(500).json({
        success: false,
        httpStatus: 0,
        error: 'NO_TENANT_INFO_FOUND',
        message: 'Nenhum endpoint retornou informações da empresa',
        attempts,
        companyName: null,
        companyCnpj: null,
        organizationId: null,
        nextAction: 'Verificar permissões do token OAuth',
      });
    }

    console.log('[TenantCheck] SUCESSO:', {
      companyName: successAttempt.companyName,
      companyCnpj: successAttempt.companyCnpj,
      organizationId: successAttempt.organizationId,
    });

    // Validar CNPJ esperado
    const expectedCnpj = '07.838.084/0001-86';
    const actualCnpj = successAttempt.companyCnpj;
    const isCnpjCorrect = actualCnpj === expectedCnpj || actualCnpj?.replace(/\D/g, '') === expectedCnpj.replace(/\D/g, '');

    console.log('[TenantCheck] VALIDAÇÃO_CNPJ:', {
      expected: expectedCnpj,
      actual: actualCnpj,
      match: isCnpjCorrect,
    });

    return res.json({
      success: true,
      httpStatus: successAttempt.httpStatus,
      companyName: successAttempt.companyName || 'DESCONHECIDO',
      companyCnpj: successAttempt.companyCnpj || 'NÃO_ENCONTRADO',
      organizationId: successAttempt.organizationId || null,
      isCnpjCorrect,
      expectedCnpj,
      endpoint: successAttempt.endpoint,
      timestamp: new Date().toISOString(),
      raw: successAttempt.raw,
      allAttempts: attempts,
      recommendation: isCnpjCorrect
        ? '✅ Token conectado na empresa correta (Fraga Contabilidade)'
        : '❌ Token conectado em OUTRA empresa. Refazer OAuth com credenciais corretas.',
    });
  } catch (error: any) {
    console.error('[TenantCheck] FATAL_ERROR:', error?.message);
    return res.status(500).json({
      success: false,
      httpStatus: 500,
      error: 'INTERNAL_ERROR',
      message: error?.message,
      companyName: null,
      companyCnpj: null,
      organizationId: null,
    });
  }
});

export default router;
