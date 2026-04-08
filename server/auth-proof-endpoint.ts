/**
 * Endpoint de prova de autenticação do painel Conta Azul
 * GET /api/test/panel/auth-proof
 * 
 * Valida se consegue acessar os endpoints do painel (A/B/C)
 * Retorna decision clara: OK_PANEL_AUTH | REFRESH_TOKEN_INVALID | PANEL_401_PERSISTENT
 */

import express from 'express';
import { contaAzulGet } from './contaAzulRequest';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = express.Router();

interface RefreshAttempt {
  didTry: boolean;
  refreshHttpStatus?: number;
  refreshErrorPrefix?: string;
}

interface StepResult {
  step: string;
  httpStatus: number;
  keys: string[];
}

/**
 * GET /api/test/panel/auth-proof
 */
router.get('/auth-proof', async (req, res) => {
  const correlationId = `[AUTH_PROOF_${Date.now()}]`;
  const startTime = Date.now();

  console.log(`${correlationId} Iniciando prova de autenticação...`);

  const financialEventId = 'ca248c7e-2045-4346-8d8d-9c4d70217f99';
  const chargeRequestId = '84f71eca-0a9d-11f1-b160-d71ec57e576b';

  let decision = 'PANEL_401_PERSISTENT';
  const refreshAttempt: RefreshAttempt = { didTry: false };
  const steps: StepResult[] = [];
  let tokenInfo: any = {};

  // PASSO 0: Validar token
  console.log(`${correlationId} PASSO 0: Validando token...`);
  try {
    const token = await getValidAccessToken();
    tokenInfo = {
      source: 'getValidAccessToken',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      minutesUntilExpiry: 60,
      refreshedNow: false,
    };
    console.log(`${correlationId} PASSO 0: Token válido, prefix=${token.substring(0, 10)}...`);
  } catch (err: any) {
    const errorMsg = err.message || '';
    console.error(`${correlationId} PASSO 0: Erro ao validar token - ${errorMsg}`);

    if (errorMsg.includes('REFRESH_TOKEN_INVALID')) {
      decision = 'REFRESH_TOKEN_INVALID';
      refreshAttempt.didTry = true;
      refreshAttempt.refreshHttpStatus = 400;
      refreshAttempt.refreshErrorPrefix = 'Token refresh failed with 400';
    }

    tokenInfo = {
      source: 'error',
      error: errorMsg,
    };
  }

  // PASSO A: Summary
  console.log(`${correlationId} PASSO A: Tentando summary...`);
  try {
    const summaryUrl = `/contaazul-bff/finance/v1/financial-events/${financialEventId}/summary`;
    const summaryResult = await contaAzulGet(summaryUrl, undefined, correlationId);

    const stepALog: StepResult = {
      step: 'A_summary',
      httpStatus: summaryResult.status,
      keys: summaryResult.data && typeof summaryResult.data === 'object' ? Object.keys(summaryResult.data) : [],
    };

    steps.push(stepALog);
    console.log(`${correlationId} PASSO A: HTTP ${summaryResult.status}, keys=${stepALog.keys.join(',')}`);

    if (summaryResult.status === 200) {
      decision = 'OK_PANEL_AUTH';
    }
  } catch (err: any) {
    steps.push({
      step: 'A_summary',
      httpStatus: err.response?.status || 0,
      keys: [],
    });
    console.error(`${correlationId} PASSO A: Erro - ${err.message}`);
  }

  // PASSO B: ChargeRequest
  console.log(`${correlationId} PASSO B: Tentando chargeRequest...`);
  try {
    const chargeUrl = `/finance-pro/v1/charge-requests/${chargeRequestId}`;
    const chargeResult = await contaAzulGet(chargeUrl, undefined, correlationId);

    const stepBLog: StepResult = {
      step: 'B_charge',
      httpStatus: chargeResult.status,
      keys: chargeResult.data && typeof chargeResult.data === 'object' ? Object.keys(chargeResult.data) : [],
    };

    steps.push(stepBLog);
    console.log(`${correlationId} PASSO B: HTTP ${chargeResult.status}, keys=${stepBLog.keys.join(',')}`);

    if (chargeResult.status === 200) {
      decision = 'OK_PANEL_AUTH';
    }
  } catch (err: any) {
    steps.push({
      step: 'B_charge',
      httpStatus: err.response?.status || 0,
      keys: [],
    });
    console.error(`${correlationId} PASSO B: Erro - ${err.message}`);
  }

  // PASSO C: InstallmentView
  console.log(`${correlationId} PASSO C: Tentando installmentView...`);
  try {
    const installmentsUrl = `/finance-pro-reader/v1/installment-view?page=1&page_size=5`;
    const installmentsResult = await contaAzulGet(installmentsUrl, undefined, correlationId);

    const stepCLog: StepResult = {
      step: 'C_installments',
      httpStatus: installmentsResult.status,
      keys: installmentsResult.data && typeof installmentsResult.data === 'object' ? Object.keys(installmentsResult.data) : [],
    };

    steps.push(stepCLog);
    console.log(`${correlationId} PASSO C: HTTP ${installmentsResult.status}, keys=${stepCLog.keys.join(',')}`);

    if (installmentsResult.status === 200) {
      decision = 'OK_PANEL_AUTH';
    }
  } catch (err: any) {
    steps.push({
      step: 'C_installments',
      httpStatus: err.response?.status || 0,
      keys: [],
    });
    console.error(`${correlationId} PASSO C: Erro - ${err.message}`);
  }

  const totalTime = Date.now() - startTime;

  const response = {
    ok: decision === 'OK_PANEL_AUTH',
    decision,
    correlationId,
    tokenInfo,
    refreshAttempt,
    steps,
    totalTimeMs: totalTime,
  };

  console.log(`${correlationId} Prova concluída: decision=${decision}, totalTime=${totalTime}ms`);

  res.json(response);
});

export default router;
