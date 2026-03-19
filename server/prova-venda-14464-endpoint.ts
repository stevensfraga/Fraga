/**
 * Endpoint de prova técnica para debugar resolução de boleto Venda 14464
 * GET /api/test/panel/prova-venda-14464
 * 
 * Retorna logs brutos de cada PASSO (A, B, C) com:
 * - HTTP status, headers, keys, sample
 * - Sem silenciar 401/403
 * - Extração robusta
 * - Decision final
 */

import express from 'express';
import { contaAzulGet } from './contaAzulRequest';
import {
  extractFirstUrlByPatterns,
  extractPix,
  extractLinhaDigitavel,
} from './robust-payment-extraction';

const router = express.Router();

interface StepLog {
  step: string;
  finalUrl: string;
  httpStatus: number;
  responseHeaders?: {
    'content-type'?: string;
    'x-request-id'?: string;
  };
  keys: string[];
  sample?: string;
  timingMs: number;
  authError?: boolean;
  tokenRefreshed?: boolean;
  retryDone?: boolean;
  emptyPayload?: boolean;
  error?: string;
}

/**
 * GET /api/test/panel/prova-venda-14464
 */
router.get('/prova-venda-14464', async (req, res) => {
  const correlationId = `[PROVA_${Date.now()}]`;
  const startTime = Date.now();
  const steps: StepLog[] = [];

  const financialEventId = 'ca248c7e-2045-4346-8d8d-9c4d70217f99';
  const chargeRequestId = '84f71eca-0a9d-11f1-b160-d71ec57e576b';

  console.log(`${correlationId} Iniciando prova técnica...`);

  // PASSO A: Summary
  console.log(`${correlationId} PASSO A: Tentando summary...`);
  const stepAStart = Date.now();
  try {
    const summaryUrl = `/contaazul-bff/finance/v1/financial-events/${financialEventId}/summary`;
    const fullUrl = `https://services.contaazul.com${summaryUrl}`;

    const summaryResult = await contaAzulGet(summaryUrl, undefined, correlationId);

    const stepALog: StepLog = {
      step: 'A_summary',
      finalUrl: fullUrl,
      httpStatus: summaryResult.status,
      keys: summaryResult.data && typeof summaryResult.data === 'object' ? Object.keys(summaryResult.data) : [],
      timingMs: Date.now() - stepAStart,
    };

    // Sample
    if (summaryResult.data) {
      if (Array.isArray(summaryResult.data)) {
        stepALog.sample = JSON.stringify(summaryResult.data[0] || {}).substring(0, 1024);
      } else if (typeof summaryResult.data === 'object') {
        stepALog.sample = JSON.stringify(summaryResult.data).substring(0, 1024);
      }
    }

    // Auth check
    if (summaryResult.status === 401 || summaryResult.status === 403) {
      stepALog.authError = true;
      stepALog.error = summaryResult.error;
    }

    // Empty check
    if (summaryResult.status === 200 && (!summaryResult.data || Object.keys(summaryResult.data || {}).length === 0)) {
      stepALog.emptyPayload = true;
    }

    steps.push(stepALog);
    console.log(`${correlationId} PASSO A: ${JSON.stringify(stepALog)}`);
  } catch (err: any) {
    steps.push({
      step: 'A_summary',
      finalUrl: `https://services.contaazul.com/contaazul-bff/finance/v1/financial-events/${financialEventId}/summary`,
      httpStatus: 0,
      keys: [],
      timingMs: Date.now() - stepAStart,
      error: err.message,
    });
    console.error(`${correlationId} PASSO A: Erro - ${err.message}`);
  }

  // PASSO B: ChargeRequest
  console.log(`${correlationId} PASSO B: Tentando chargeRequest...`);
  const stepBStart = Date.now();
  try {
    const chargeUrl = `/finance-pro/v1/charge-requests/${chargeRequestId}`;
    const fullUrl = `https://services.contaazul.com${chargeUrl}`;

    const chargeResult = await contaAzulGet(chargeUrl, undefined, correlationId);

    const stepBLog: StepLog = {
      step: 'B_charge',
      finalUrl: fullUrl,
      httpStatus: chargeResult.status,
      keys: chargeResult.data && typeof chargeResult.data === 'object' ? Object.keys(chargeResult.data) : [],
      timingMs: Date.now() - stepBStart,
    };

    // Sample
    if (chargeResult.data) {
      if (Array.isArray(chargeResult.data)) {
        stepBLog.sample = JSON.stringify(chargeResult.data[0] || {}).substring(0, 1024);
      } else if (typeof chargeResult.data === 'object') {
        stepBLog.sample = JSON.stringify(chargeResult.data).substring(0, 1024);
      }
    }

    // Auth check
    if (chargeResult.status === 401 || chargeResult.status === 403) {
      stepBLog.authError = true;
      stepBLog.error = chargeResult.error;
    }

    // Empty check
    if (chargeResult.status === 200 && (!chargeResult.data || Object.keys(chargeResult.data || {}).length === 0)) {
      stepBLog.emptyPayload = true;
    }

    steps.push(stepBLog);
    console.log(`${correlationId} PASSO B: ${JSON.stringify(stepBLog)}`);
  } catch (err: any) {
    steps.push({
      step: 'B_charge',
      finalUrl: `https://services.contaazul.com/finance-pro/v1/charge-requests/${chargeRequestId}`,
      httpStatus: 0,
      keys: [],
      timingMs: Date.now() - stepBStart,
      error: err.message,
    });
    console.error(`${correlationId} PASSO B: Erro - ${err.message}`);
  }

  // PASSO C: InstallmentView
  console.log(`${correlationId} PASSO C: Tentando installmentView...`);
  const stepCStart = Date.now();
  try {
    const installmentsUrl = `/finance-pro-reader/v1/installment-view?page=1&page_size=50`;
    const fullUrl = `https://services.contaazul.com${installmentsUrl}`;

    const installmentsResult = await contaAzulGet(installmentsUrl, undefined, correlationId);

    const stepCLog: StepLog = {
      step: 'C_installments',
      finalUrl: fullUrl,
      httpStatus: installmentsResult.status,
      keys: installmentsResult.data && typeof installmentsResult.data === 'object' ? Object.keys(installmentsResult.data) : [],
      timingMs: Date.now() - stepCStart,
    };

    // Sample
    if (installmentsResult.data) {
      if (Array.isArray(installmentsResult.data)) {
        stepCLog.sample = JSON.stringify(installmentsResult.data[0] || {}).substring(0, 1024);
      } else if (typeof installmentsResult.data === 'object') {
        stepCLog.sample = JSON.stringify(installmentsResult.data).substring(0, 1024);
      }
    }

    // Auth check
    if (installmentsResult.status === 401 || installmentsResult.status === 403) {
      stepCLog.authError = true;
      stepCLog.error = installmentsResult.error;
    }

    // Empty check
    if (installmentsResult.status === 200 && (!installmentsResult.data || Object.keys(installmentsResult.data || {}).length === 0)) {
      stepCLog.emptyPayload = true;
    }

    steps.push(stepCLog);
    console.log(`${correlationId} PASSO C: ${JSON.stringify(stepCLog)}`);
  } catch (err: any) {
    steps.push({
      step: 'C_installments',
      finalUrl: `https://services.contaazul.com/finance-pro-reader/v1/installment-view?page=1&page_size=50`,
      httpStatus: 0,
      keys: [],
      timingMs: Date.now() - stepCStart,
      error: err.message,
    });
    console.error(`${correlationId} PASSO C: Erro - ${err.message}`);
  }

  // Decisão final
  let decision = 'NOT_FOUND';
  const extracted: any = {};

  // Verificar se houve erro de auth
  if (steps.some(s => s.authError)) {
    decision = 'PANEL_AUTH_FAILED';
  } else {
    // Tentar extrair dados de todos os steps
    for (const step of steps) {
      if (step.sample) {
        try {
          const data = JSON.parse(step.sample);
          const pdfUrl = extractFirstUrlByPatterns(data);
          const pix = extractPix(data);
          const linhaDigitavel = extractLinhaDigitavel(data);

          if (pdfUrl) {
            extracted.pdfCandidateUrl = pdfUrl;
            decision = 'SEND_PDF';
            break;
          }

          if (pix) extracted.pix = pix;
          if (linhaDigitavel) extracted.linhaDigitavel = linhaDigitavel;
        } catch {}
      }
    }

    // Se não tem PDF mas tem PIX/linha
    if (!extracted.pdfCandidateUrl && (extracted.pix || extracted.linhaDigitavel)) {
      decision = 'SEND_PIX_OR_LINE';
    }
  }

  const totalTime = Date.now() - startTime;

  const response = {
    ok: decision !== 'NOT_FOUND' && decision !== 'PANEL_AUTH_FAILED',
    correlationId,
    steps,
    extracted,
    decision,
    totalTimeMs: totalTime,
  };

  console.log(`${correlationId} Prova concluída: decision=${decision}, totalTime=${totalTime}ms`);

  res.json(response);
});

export default router;
