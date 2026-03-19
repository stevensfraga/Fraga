/**
 * 🚀 Reactivation Batch Router
 * Executa lote de reativação de clientes com 90+ dias de atraso
 * 
 * Suporta DRY_RUN para teste sem envio real
 */

import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import axios from 'axios';
import { getDb } from './db';
import { clients, receivables, collectionMessages } from '../drizzle/schema';
import { desc } from 'drizzle-orm';
import { and, eq, gt, lte, isNull, ne, isNotNull } from 'drizzle-orm';
import { getValidAccessToken } from './contaAzulOAuthManager';
import { uploadPdfToR2, isPdfAccessible } from './r2-storage';
import { uploadPdfWithFallback } from './worker-storage';
import { selectPhoneWithFallback, isValidE164 } from './phoneUtils';
import { validatePublicUrlWithRetry, validatePdfUrl } from './link-validation';
import { findPessoaByDocumento, onlyDigits, normalizeName } from './pessoaSearchUtils';
import { findPessoaByDocumentoV2 } from './pessoaSearchV2';
import { tenantCheckMultiStrategy, validatePessoasEndpoint } from './contaAzulTenantCheckMultiStrategy';
import { probeContaAzulEndpoints, testPessoasEndpoint } from './contaAzulProbe';

const router = Router();

/**
 * ✅ CORRIGIDO: Normalizar valor monetário
 * Detecta se valor está em centavos (integer > 100) ou reais (decimal)
 * Exemplos:
 * - 24000 (centavos) → 240.00 (reais)
 * - 240.00 (reais) → 240.00 (reais)
 * - 240 (reais) → 240.00 (reais)
 */
/**
 * 🔍 Validar se URL é publicamente acessível
 * Faz HEAD request sem Authorization
 * Retorna true se status 200/302, false caso contrário
 */
async function isPublicUrl(url: string): Promise<boolean> {
  if (!url || typeof url !== 'string') {
    console.log(`[IsPublicUrl] URL inválida: ${url}`);
    return false;
  }

  try {
    // 🔧 CORRIGIDO: Usar GET em vez de HEAD (alguns Workers não suportam HEAD)
    // Não incluir Authorization header - testar acesso público
    const response = await axios.get(url, {
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400, // 2xx e 3xx são OK
      // Limitar resposta para não baixar arquivo inteiro
      responseType: 'stream',
      maxContentLength: 1024, // Apenas 1KB para teste
    });
    
    console.log(`[IsPublicUrl] ✅ URL pública: ${url} (status=${response.status})`);
    return true;
  } catch (error: any) {
    const status = error?.response?.status;
    console.log(`[IsPublicUrl] ❌ URL privada/inválida: ${url} (status=${status || 'timeout'})`);
    return false;
  }
}

/**
 * 🔍 Validar formato de linha digitável/código de barras
 * Linha digitável: 47 dígitos (ignorando espaços/pontos)
 * Código de barras: 44 dígitos numéricos
 * Retorna true se válido, false caso contrário
 */
function isValidBarcode(barcode: string): boolean {
  if (!barcode || typeof barcode !== 'string') {
    console.log(`[ValidateBarcode] Código inválido: ${barcode}`);
    return false;
  }

  // Remover espaços e pontos
  const cleaned = barcode.replace(/[\s.]/g, '');
  
  // Validar se tem apenas dígitos
  if (!/^\d+$/.test(cleaned)) {
    console.log(`[ValidateBarcode] Código contém caracteres não-numéricos: ${barcode}`);
    return false;
  }

  // Validar comprimento: 44 ou 47 dígitos
  const length = cleaned.length;
  if (length !== 44 && length !== 47) {
    console.log(`[ValidateBarcode] ❌ Código inválido (${length} dígitos, esperado 44 ou 47): ${barcode}`);
    return false;
  }

  console.log(`[ValidateBarcode] ✅ Código válido (${length} dígitos): ${barcode}`);
  return true;
}

function normalizarValorMoeda(valor: number): number {
  if (valor <= 0) {
    console.warn(`[NormalizarValor] Valor inválido: ${valor}`);
    return 0;
  }

  // Se valor é muito grande (> 10000), provavelmente está em centavos
  // Exemplo: 24000 centavos = 240 reais
  if (valor > 10000) {
    const valorEmReais = valor / 100;
    console.log(`[NormalizarValor] Convertendo centavos: ${valor} → R$ ${valorEmReais.toFixed(2)}`);
    return valorEmReais;
  }

  // Se valor é pequeno (< 100), provavelmente está em reais
  // Exemplo: 240 reais = 240 reais
  return valor;
}

/**
 * 📱 Normalizar telefone para formato E.164 (+55DDDNÚMERO)
 * Regras:
 * 1) Limpar tudo que não é dígito
 * 2) Se já começa com "55" e tem 12-13 dígitos -> prefixar "+"
 * 3) Se tem 10-11 dígitos (DDD+num BR) -> prefixar "+55"
 * 4) Se tem 12-13 com "+" já, manter
 * 5) Se após normalizar não ficar em +55 + (10 ou 11 dígitos), retornar null (erro)
 */
function normalizePhoneE164(phoneRaw: string | null | undefined): { phoneE164: string | null; error: string | null } {
  if (!phoneRaw || typeof phoneRaw !== 'string') {
    return { phoneE164: null, error: 'PHONE_EMPTY' };
  }

  // 1) Limpar tudo que não é dígito
  let cleaned = phoneRaw.replace(/[^0-9]/g, '');

  // 2) Se tem 10 dígitos (DDD+8num BR), prefixar +55
  if (cleaned.length === 10) {
    return { phoneE164: `+55${cleaned}`, error: null };
  }

  // 3) Se tem 11 dígitos (DDD+9num BR), prefixar +55
  if (cleaned.length === 11) {
    return { phoneE164: `+55${cleaned}`, error: null };
  }

  // 4) Se tem 12 dígitos e começa com 55, prefixar +
  if (cleaned.length === 12 && cleaned.startsWith('55')) {
    return { phoneE164: `+${cleaned}`, error: null };
  }

  // 5) Se tem 13 dígitos e começa com 55, prefixar +
  if (cleaned.length === 13 && cleaned.startsWith('55')) {
    return { phoneE164: `+${cleaned}`, error: null };
  }

  // 6) Qualquer outro formato, erro
  return { phoneE164: null, error: 'INVALID_PHONE_E164' };
}

// Middleware: Dev-only access
const devOnly = (req: any, res: any, next: any) => {
  // ✅ BYPASS: Permitir dryRun=1 ou dryRun=true sem secret (preview apenas)
  const isDryRun = req.query?.dryRun === "1" || req.query?.dryRun === "true";
  const isSendPrecharge = req.method === "POST" &&
    /^\/api\/test\/reactivation\/send-precharge-manual\/\d+/.test(req.originalUrl);
  if (isSendPrecharge && isDryRun) {
    console.log("[ReactivationBatch] dryRun detected - PREVIEW MODE (no secret required)");
    return next();
  }
  
  const devSecret = process.env.DEV_SECRET;
  if (!devSecret) {
    console.error('[ReactivationBatch] DEV_SECRET not configured');
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
  
  const headerSecret = req.headers['x-dev-secret'];
  
  // Timing-safe comparison
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
    console.warn('[ReactivationBatch] Invalid X-Dev-Secret header');
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  next();
};

router.use(devOnly);

interface ReactivationResult {
  clientId: number;
  receivableId: number;
  name: string;
  whatsappNumber: string;
  messageTemplate: string;
  status: 'SIMULATED' | 'SENT' | 'BLOCKED' | 'ERROR';
  reason?: string;
  messageId?: string;
}

/**
 * GET /api/test/reactivation/run-reactivation-batch?dryRun=true&limit=50
 * 
 * Executa lote de reativação com fallback de telefone
 * dryRun=true: não envia, apenas simula
 * dryRun=false: envia de verdade
 */
router.post('/run-reactivation-batch', async (req: Request, res: Response) => {
  try {
    const dryRun = req.query.dryRun === 'true';
    const limit = parseInt(req.query.limit as string) || 50;

    console.log(`[ReactivationBatch] START dryRun=${dryRun} limit=${limit}`);

    // Validar token
    const accessToken = await getValidAccessToken();
    console.log(`[OAuth] TOKEN_USED accessToken=${accessToken.substring(0, 20)}...`);

    const db = await getDb();
    if (!db) throw new Error('Database not available');

    // Buscar receivables com 90+ dias de atraso
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const overdueReceivables = await db
      .select({
        receivableId: receivables.id,
        clientId: receivables.clientId,
        dueDate: receivables.dueDate,
        amount: receivables.amount,
        documento: receivables.documento,
        linhaDigitavel: receivables.linhaDigitavel,
        link: receivables.link,
        pdfStorageUrl: receivables.pdfStorageUrl,
        clientName: clients.name,
        phoneCellular: clients.phoneCellular,
        phoneCommercial: clients.phone,
        whatsappNumber: clients.whatsappNumber,
        whatsappSource: clients.whatsappSource,
      })
      .from(receivables)
      .innerJoin(clients, eq(receivables.clientId, clients.id))
      .where(
        and(
          lte(receivables.dueDate, ninetyDaysAgo),
          eq(receivables.status, 'pending')
        )
      )
      .limit(limit);

    console.log(`[ReactivationBatch] FOUND ${overdueReceivables.length} receivables com 90+ dias`);

    const results: ReactivationResult[] = [];

    for (const receivable of overdueReceivables) {
      try {
        // NOVA: Selecionar telefone com fallback celular -> comercial
        const phoneSelection = selectPhoneWithFallback(
          receivable.phoneCellular,
          receivable.phoneCommercial
        );

        if (!phoneSelection.phone) {
          console.log(
            `[ReactivationValidation] BLOCKED receivableId=${receivable.receivableId} reason=NO_VALID_PHONE`
          );
          results.push({
            clientId: receivable.clientId,
            receivableId: receivable.receivableId,
            name: receivable.clientName,
            whatsappNumber: '',
            messageTemplate: 'reactivation_90plus',
            status: 'BLOCKED',
            reason: 'NO_VALID_PHONE',
          });
          continue;
        }

        console.log(
          `[ReactivationBatch] PHONE e164=${phoneSelection.phone} source=${phoneSelection.source}`
        );

        if (receivable.whatsappSource !== 'conta-azul') {
          console.log(
            `[ReactivationValidation] BLOCKED receivableId=${receivable.receivableId} reason=INVALID_WHATSAPP_SOURCE`
          );
          results.push({
            clientId: receivable.clientId,
            receivableId: receivable.receivableId,
            name: receivable.clientName,
            whatsappNumber: phoneSelection.phone || '',
            messageTemplate: 'reactivation_90plus',
            status: 'BLOCKED',
            reason: 'INVALID_WHATSAPP_SOURCE',
          });
          continue;
        }

        console.log(`[ReactivationValidation] APROVADO receivableId=${receivable.receivableId}`);

        // 🔍 NOVA: Validar dados de pagamento com regras duras
        console.log(`[PaymentInfo] receivableId=${receivable.receivableId} source=conta-azul`);
        
        // Validar linha digitável (se existir, deve ser válida)
        let hasValidLinhaDigitavel = false;
        if (receivable.linhaDigitavel && receivable.linhaDigitavel.trim()) {
          hasValidLinhaDigitavel = isValidBarcode(receivable.linhaDigitavel);
          if (!hasValidLinhaDigitavel) {
            console.log(`[PaymentInfo] INVALID_BARCODE receivableId=${receivable.receivableId}`);
          }
        }
        const linhaDigits = receivable.linhaDigitavel ? receivable.linhaDigitavel.replace(/[\s.]/g, '').length : 0;
        console.log(`[PaymentInfo] hasLinha=${hasValidLinhaDigitavel} linhaDigits=${linhaDigits}`);
        
        // 🔍 Validar se link é PUBLICAMENTE acessível
        let hasPublicLink = false;
        let hasPdfUrl = false;
        if (receivable.link && receivable.link.trim()) {
          // ✅ CORRIGIDO: Validar TODOS os links com HEAD 200 (PDFs e URLs)
          const isAccessible = await isPublicUrl(receivable.link);
          
          if (receivable.link.includes('.pdf')) {
            hasPdfUrl = isAccessible; // Só marca como true se HTTP 200
            console.log(`[PaymentInfo] hasPdf=${hasPdfUrl} url=${receivable.link}`);
            if (!hasPdfUrl) {
              console.log(`[PaymentInfo] ❌ PDF NÃO ACESSÍVEL (HTTP não 200): ${receivable.link}`);
            }
          } else {
            // Validar se link é público (sem Authorization)
            hasPublicLink = isAccessible;
            console.log(`[PaymentInfo] hasLink=${hasPublicLink} isPublic=${hasPublicLink}`);
            if (!hasPublicLink) {
              console.log(`[ReactivationValidation] Link não é público: ${receivable.link}`);
            }
          }
        } else {
          console.log(`[PaymentInfo] hasLink=false isPublic=false`);
        }
        
        // 🔍 Validar pdfStorageUrl (URL do Worker)
        let hasPdfStorageUrl = false;
        if (receivable.pdfStorageUrl && receivable.pdfStorageUrl.trim()) {
          const isAccessible = await isPublicUrl(receivable.pdfStorageUrl);
          hasPdfStorageUrl = isAccessible;
          console.log(`[PaymentInfo] hasPdfStorageUrl=${hasPdfStorageUrl} url=${receivable.pdfStorageUrl}`);
          if (!hasPdfStorageUrl) {
            console.log(`[PaymentInfo] ❌ PDF STORAGE NÃO ACESSÍVEL (HTTP não 200): ${receivable.pdfStorageUrl}`);
          }
        }
        
        const hasAnyPaymentInfo = hasValidLinhaDigitavel || hasPdfUrl || hasPublicLink || hasPdfStorageUrl;

        // 🚫 BLOQUEIO: Se não tem dados de pagamento, não enviar
        if (!hasAnyPaymentInfo) {
          console.log(
            `[ReactivationValidation] BLOCKED receivableId=${receivable.receivableId} reason=MISSING_PAYMENT_INFO`
          );
          results.push({
            clientId: receivable.clientId,
            receivableId: receivable.receivableId,
            name: receivable.clientName,
            whatsappNumber: phoneSelection.phone || '',
            messageTemplate: 'reactivation_90plus',
            status: 'BLOCKED',
            reason: 'MISSING_PAYMENT_INFO',
          });
          continue;
        }

        // Gerar preview da mensagem
        // ✅ CORRIGIDO: Detectar se valor está em centavos ou reais
        const amountRaw = typeof receivable.amount === 'string' ? parseFloat(receivable.amount) : (receivable.amount || 0);
        const amountValue = normalizarValorMoeda(amountRaw);
        const valorFormatado = new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        }).format(amountValue);

        // ✅ NOVA: Bloquear se documento for nulo ou N/A (REGRA OBRIGATÓRIA)
        if (!receivable.documento || receivable.documento === 'N/A' || !receivable.documento.trim()) {
          console.log(
            `[ReactivationValidation] BLOCKED receivableId=${receivable.receivableId} reason=MISSING_DOCUMENT`
          );
          results.push({
            clientId: receivable.clientId,
            receivableId: receivable.receivableId,
            name: receivable.clientName,
            whatsappNumber: phoneSelection.phone || '',
            messageTemplate: 'reactivation_90plus',
            status: 'BLOCKED',
            reason: 'MISSING_DOCUMENT',
          });
          continue;
        }

        // ✅ NOVA: Montar mensagem com link/código (se existir)
        let messagePreview = `⚠️ Aviso de Boleto em Aberto\n\nOlá! 👋\n\nIdentificamos um boleto em aberto em seu cadastro.\n\nSegue abaixo os dados para conferência e regularização:\n\n📄 Documento: ${receivable.documento}\n💰 Valor: ${valorFormatado}\n📅 Vencimento: ${new Date(receivable.dueDate).toLocaleDateString('pt-BR')}`;

        // Adicionar linha digitável se existir E for válida
        if (hasValidLinhaDigitavel) {
          messagePreview += `\n\n📌 Código de barras (linha digitável):\n${receivable.linhaDigitavel}`;
          console.log(`[ReactivationValidation] paymentInfo hasLinhaDigitavel=true (validated) receivableId=${receivable.receivableId}`);
        }

        // Adicionar link PDF se existir
        if (hasPdfUrl) {
          messagePreview += `\n\n📎 2ª via (PDF):\n${receivable.link}`;
          console.log(`[ReactivationValidation] paymentInfo hasPdfUrl=true receivableId=${receivable.receivableId}`);
        }

        // Adicionar link público se existir E for acessível
        if (hasPublicLink) {
          messagePreview += `\n\n🔗 Link para pagamento:\n${receivable.link}`;
          console.log(`[ReactivationValidation] paymentInfo hasPublicLink=true (validated) receivableId=${receivable.receivableId}`);
        } else if (receivable.link && !receivable.link.includes('.pdf')) {
          // Link existe mas não é público - não incluir na mensagem
          console.log(`[ReactivationValidation] Link privado não incluído: ${receivable.link}`);
        }

        messagePreview += `\n\nCaso prefira, o boleto em PDF segue anexado nesta mensagem.\n\nSe já houve pagamento, por favor desconsidere este aviso.\n\nEm caso de dúvidas, estou à disposição 🙂\n\nObrigado!`;

        if (dryRun) {
          // DRY_RUN: apenas simular
          console.log(
            `[ReactivationDispatch] DRY_RUN receivableId=${receivable.receivableId} whatsapp=${receivable.whatsappNumber}`
          );
          console.log(`[ReactivationDispatch] MESSAGE_PREVIEW (com link/código): ${messagePreview.substring(0, 80)}...`);

          // Registrar como simulated
          await db.insert(collectionMessages).values({
            receivableId: receivable.receivableId,
            clientId: receivable.clientId,
            cnpj: '', // TODO: get from client
            messageTemplate: 'reactivation_90plus',
            messageType: 'friendly',
            messageSent: messagePreview,
            status: 'sent',
            outcome: 'pending',
          });

            results.push({
              clientId: receivable.clientId,
              receivableId: receivable.receivableId,
              name: receivable.clientName,
              whatsappNumber: phoneSelection.phone || '',
              messageTemplate: 'reactivation_90plus',
              status: 'SIMULATED',
              messageId: 'DRY_RUN_SIMULATED',
            });
        } else {
          // REAL SEND: chamar ZapContabil API
          console.log(
            `[ReactivationDispatch] SENDING receivableId=${receivable.receivableId} whatsapp=${receivable.whatsappNumber}`
          );

          try {
            // Chamar Zappy API
            const zapApiUrl = process.env.ZAP_CONTABIL_API_URL;
            const zapApiKey = process.env.ZAP_CONTABIL_API_KEY;

            if (!zapApiUrl || !zapApiKey) {
              throw new Error('ZAP_CONTABIL_API_URL ou ZAP_CONTABIL_API_KEY não configurados');
            }

            // Formatar número para Zappy (remover caracteres especiais)
            const phoneFormatted = phoneSelection.phone!.replace(/\D/g, '');
            if (!phoneFormatted.startsWith('55')) {
              throw new Error(`Número inválido: ${phoneSelection.phone}`);
            }

            // Instrumentacao: correlationId para rastreamento
            const correlationId = `reactivation_${Date.now()}_${receivable.receivableId}`;
            console.log(`[ZappyDispatch] REQUEST correlationId=${correlationId} to=${phoneFormatted} template=reactivation_90plus`);

            // Chamar API do Zappy
            const zapResponse = await axios.post(
              `${zapApiUrl}/api/send/${phoneFormatted}`,
              {
                body: messagePreview,
                connectionFrom: 0,
              },
              {
                headers: {
                  'Authorization': `Bearer ${zapApiKey}`,
                  'Content-Type': 'application/json',
                  'accept': 'application/json',
                  'X-Correlation-Id': correlationId,
                },
                timeout: 10000,
              }
            );

            // Extrair providerMessageId da resposta
            const providerMessageId = zapResponse.data?.id || zapResponse.data?.messageId || zapResponse.data?.msg_id;
            const providerStatus = zapResponse.data?.status || 'sent';
            
            console.log(`[ZappyDispatch] RESPONSE httpStatus=${zapResponse.status} providerMessageId=${providerMessageId} providerStatus=${providerStatus}`);
            console.log(`[ZappyDispatch] Raw response:`, JSON.stringify(zapResponse.data).substring(0, 300));

            // Gerar messageId único
            const messageId = `msg_${Date.now()}_${receivable.receivableId}`;

            // Registrar no banco COM dados do provedor
            await db.insert(collectionMessages).values({
              receivableId: receivable.receivableId,
              clientId: receivable.clientId,
              cnpj: '',
              messageTemplate: 'reactivation_90plus',
              messageType: 'friendly',
              messageSent: messagePreview,
              whatsappMessageId: messageId,
              status: 'sent',
              outcome: 'pending',
              sentAt: new Date(),
              providerMessageId: providerMessageId || null,
              providerStatus: (providerStatus || 'sent') as any,
              providerRawStatus: JSON.stringify(zapResponse.data),
            });

            console.log(`[ReactivationDispatch] SUCCESS receivableId=${receivable.receivableId} messageId=${messageId} providerMessageId=${providerMessageId}`);

            results.push({
              clientId: receivable.clientId,
              receivableId: receivable.receivableId,
              name: receivable.clientName,
              whatsappNumber: phoneSelection.phone || '',
              messageTemplate: 'reactivation_90plus',
              status: 'SENT',
              messageId,
            });
          } catch (sendError: any) {
            console.error(`[ReactivationDispatch] SEND_FAILED receivableId=${receivable.receivableId} error=${sendError?.message}`);
            console.error(`[ReactivationDispatch] Zappy error details:`, sendError?.response?.data || sendError?.message);

            // Registrar como failed
            await db.insert(collectionMessages).values({
              receivableId: receivable.receivableId,
              clientId: receivable.clientId,
              cnpj: '', // TODO: get from client
              messageTemplate: 'reactivation_90plus',
              messageType: 'friendly',
              messageSent: messagePreview,
              status: 'failed',
              outcome: 'pending',
              lastError: sendError?.message || 'Unknown error',
            });

            results.push({
              clientId: receivable.clientId,
              receivableId: receivable.receivableId,
              name: receivable.clientName,
              whatsappNumber: phoneSelection.phone || '',
              messageTemplate: 'reactivation_90plus',
              status: 'ERROR',
              reason: sendError?.message,
            });
          }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error: any) {
        console.error(`[ReactivationDispatch] ERROR receivableId=${receivable.receivableId} error=${error?.message}`);
        results.push({
          clientId: receivable.clientId,
          receivableId: receivable.receivableId,
          name: receivable.clientName,
          whatsappNumber: receivable.whatsappNumber || '',
          messageTemplate: 'reactivation_90plus',
          status: 'ERROR',
          reason: error?.message,
        });
      }
    }

    // Resumo
    const simulated = results.filter(r => r.status === 'SIMULATED').length;
    const sent = results.filter(r => r.status === 'SENT').length;
    const blocked = results.filter(r => r.status === 'BLOCKED').length;
    const errors = results.filter(r => r.status === 'ERROR').length;

    console.log(
      `[ReactivationBatch] CONCLUÍDO dryRun=${dryRun} simulated=${simulated} sent=${sent} blocked=${blocked} errors=${errors}`
    );

    res.json({
      success: true,
      dryRun,
      results: {
        total: results.length,
        simulated,
        sent,
        blocked,
        errors,
      },
      details: results,
    });
  } catch (error: any) {
    console.error(`[ReactivationBatch] ERRO GERAL: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

/**
 * 🔍 INSPEÇÃO: Verificar dados de pagamento de um receivable
 * GET /api/test/receivables/payment-info/{receivableId}
 */
router.get('/payment-info/:receivableId', devOnly, async (req: Request, res: Response) => {
  try {
    const { receivableId } = req.params;
    const db = await getDb();

    if (!db) {
      return res.status(500).json({ success: false, error: 'DATABASE_ERROR' });
    }

    // Buscar receivable
    const receivable = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, parseInt(receivableId)))
      .limit(1);

    if (!receivable.length) {
      return res.status(404).json({
        success: false,
        error: 'RECEIVABLE_NOT_FOUND',
        receivableId,
      });
    }

    const rec = receivable[0];

    // Verificar dados de pagamento
    const hasLinhaDigitavel = !!(rec.linhaDigitavel && rec.linhaDigitavel.trim());
    const hasPdfUrl = !!(rec.link && rec.link.trim() && rec.link.includes('.pdf'));
    const hasPublicLink = !!(rec.link && rec.link.trim() && !rec.link.includes('.pdf'));

    // Mascarar linha digitável (mostrar apenas últimos 4 dígitos)
    const linhaDigitavelMasked = hasLinhaDigitavel 
      ? rec.linhaDigitavel!.substring(0, 5) + '...' + rec.linhaDigitavel!.substring(rec.linhaDigitavel!.length - 4)
      : null;

    res.json({
      success: true,
      receivableId: rec.id,
      hasLinhaDigitavel,
      linhaDigitavelMasked,
      linhaDigitavelFull: hasLinhaDigitavel ? rec.linhaDigitavel : null,
      hasPdfUrl,
      pdfUrl: hasPdfUrl ? rec.link : null,
      hasPublicLink,
      publicLink: hasPublicLink ? rec.link : null,
      paymentInfoPublic: rec.paymentInfoPublic,
      // Status geral
      hasAnyPaymentInfo: hasLinhaDigitavel || hasPdfUrl || hasPublicLink,
      status: (hasLinhaDigitavel || hasPdfUrl || hasPublicLink) ? 'OK' : 'MISSING_PAYMENT_INFO',
    });
  } catch (error: any) {
    console.error(`[PaymentInfo] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

// Endpoint para consultar status da mensagem no provedor
router.get('/message-status/:providerMessageId', devOnly, async (req: Request, res: Response) => {
  try {
    const { providerMessageId } = req.params;
    const db = await getDb();

    if (!db) {
      return res.status(500).json({ success: false, error: 'DATABASE_ERROR' });
    }

    // Buscar mensagem no banco
    const message = await db
      .select()
      .from(collectionMessages)
      .where(eq(collectionMessages.providerMessageId, providerMessageId))
      .limit(1);

    if (!message.length) {
      return res.status(404).json({
        success: false,
        error: 'MESSAGE_NOT_FOUND',
        providerMessageId,
      });
    }

    const msg = message[0];

    res.json({
      success: true,
      providerMessageId: msg.providerMessageId,
      providerStatus: msg.providerStatus,
      providerError: msg.providerError,
      lastUpdateAt: msg.updatedAt,
      raw: msg.providerRawStatus ? JSON.parse(msg.providerRawStatus) : null,
      whatsappMessageId: msg.whatsappMessageId,
      receivableId: msg.receivableId,
      clientId: msg.clientId,
      status: msg.status,
    });
  } catch (error: any) {
    console.error(`[MessageStatus] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

/**
 * 🔄 BACKFILL: Coletar dados de pagamento real do Conta Azul
 * POST /api/test/conta-azul/payment-info/backfill?limit=50
 * Busca linhaDigitavel/barcode e PDF para receivables elegíveis
 */
router.post('/payment-info/backfill', devOnly, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const receivableId = req.query.receivableId ? parseInt(req.query.receivableId as string) : null;
    const db = await getDb();

    if (!db) {
      return res.status(500).json({ success: false, error: 'DATABASE_ERROR' });
    }

    // Buscar receivables elegíveis
    let recs;
    
    if (receivableId) {
      recs = await db.select().from(receivables)
        .where(eq(receivables.id, receivableId))
        .limit(limit);
    } else {
      // Buscar receivables sem linhaDigitavel ou com link privado
      // ✅ CORRIGIDO: ORDER BY updatedAt DESC para sempre pegar o mais recente
      recs = await db.select().from(receivables)
        .where(eq(receivables.status, 'overdue'))
        .orderBy(desc(receivables.updatedAt))
        .limit(limit);
    }

    if (!recs.length) {
      return res.json({
        success: true,
        backfilled: 0,
        updated: 0,
        failed: 0,
        details: [],
      });
    }

    const results: any[] = [];
    let updated = 0;
    let failed = 0;

    // Obter token OAuth
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return res.status(401).json({ success: false, error: 'OAUTH_TOKEN_INVALID' });
    }

    // Para cada receivable, buscar dados do Conta Azul
    for (const rec of recs) {
      try {
        console.log(`[PaymentInfoBackfill] Processando receivableId=${rec.id}`);

        // Buscar detalhes do título no Conta Azul
        const contaAzulUrl = `${process.env.CONTA_AZUL_API_BASE}/receivables/${rec.contaAzulId}`;
        const caResponse = await axios.get(contaAzulUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          },
          timeout: 10000,
        });

        const caData = caResponse.data;
        console.log(`[PaymentInfoBackfill] Conta Azul response: ${JSON.stringify(caData).substring(0, 200)}...`);

        // Extrair linhaDigitavel (linha digitável do boleto)
        let linhaDigitavel: string | null = null;
        let boletoUrl: string | null = null;

        // Tenta extrair de diferentes campos possíveis
        if (caData.boletoInfo?.linhaDigitavel) {
          linhaDigitavel = caData.boletoInfo.linhaDigitavel;
        } else if (caData.linhaDigitavel) {
          linhaDigitavel = caData.linhaDigitavel;
        } else if (caData.boleto?.linhaDigitavel) {
          linhaDigitavel = caData.boleto.linhaDigitavel;
        }

        // Extrair URL do boleto
        if (caData.boletoInfo?.url) {
          boletoUrl = caData.boletoInfo.url;
        } else if (caData.boleto?.url) {
          boletoUrl = caData.boleto.url;
        } else if (caData.boletoUrl) {
          boletoUrl = caData.boletoUrl;
        }

        // Validar linha digitável
        let isValidLinha = false;
        if (linhaDigitavel) {
          const cleaned = linhaDigitavel.replace(/[\s.]/g, '');
          isValidLinha = /^\d{44}$|^\d{47}$/.test(cleaned);
          console.log(`[PaymentInfoBackfill] linhaDigitavel=${linhaDigitavel} isValid=${isValidLinha}`);
        }

        // Validar URL do boleto (deve ser público) com retry
        let isPublicBoletoUrl = false;
        if (boletoUrl) {
          isPublicBoletoUrl = await validatePublicUrlWithRetry(boletoUrl);
          console.log(`[PaymentInfoBackfill] boletoUrl=${boletoUrl} isPublic=${isPublicBoletoUrl}`);
        }

        // Se tiver URL do boleto e for privada, tentar baixar PDF e subir pro R2
        let r2PdfUrl: string | null = null;
        if (boletoUrl && !isPublicBoletoUrl) {
          try {
            console.log(`[PaymentInfoBackfill] Tentando baixar PDF privado: ${boletoUrl}`);
            const pdfResponse = await axios.get(boletoUrl, {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
              },
              responseType: 'arraybuffer',
              timeout: 15000,
            });

            const pdfBuffer = Buffer.from(pdfResponse.data);
            console.log(`[PaymentInfoBackfill] PDF baixado: ${pdfBuffer.length} bytes`);

            // Upload via Worker (com fallback para R2)
            const uploadResult = await uploadPdfWithFallback(rec.id, pdfBuffer);
            if (uploadResult.success) {
              r2PdfUrl = uploadResult.publicUrl;
              console.log(`[PaymentInfoBackfill] PDF enviado via ${uploadResult.provider}: ${r2PdfUrl}`);
            } else {
              console.error(`[PaymentInfoBackfill] Erro ao enviar PDF: ${uploadResult.error}`);
            }
          } catch (pdfError: any) {
            console.error(`[PaymentInfoBackfill] Erro ao baixar/enviar PDF: ${pdfError?.message}`);
          }
        }

        // Atualizar banco se tiver dados válidos
        if (isValidLinha || isPublicBoletoUrl || r2PdfUrl) {
          const updateData: any = {
            paymentInfoPublic: true,
            paymentInfoSource: 'conta-azul',
          };

          if (isValidLinha) {
            updateData.linhaDigitavel = linhaDigitavel;
          }

          if (isPublicBoletoUrl) {
          }

          if (r2PdfUrl) {
            updateData.pdfStorageUrl = r2PdfUrl;
            updateData.link = boletoUrl;
          }

          await db.update(receivables).set(updateData).where(eq(receivables.id, rec.id));
          updated++;

          console.log(`[PaymentInfoBackfill] ✅ Atualizado receivableId=${rec.id}`);
          results.push({
            receivableId: rec.id,
            status: 'UPDATED',
            linhaDigitavel: isValidLinha ? linhaDigitavel : null,
            boletoUrl: isPublicBoletoUrl ? boletoUrl : null,
          });
        } else {
          console.log(`[PaymentInfoBackfill] ❌ Sem dados válidos receivableId=${rec.id}`);
          results.push({
            receivableId: rec.id,
            status: 'NO_DATA',
            linhaDigitavel: null,
            boletoUrl: null,
          });
        }
      } catch (error: any) {
        failed++;
        console.error(`[PaymentInfoBackfill] ERROR receivableId=${rec.id} error=${error?.message}`);
        results.push({
          receivableId: rec.id,
          status: 'ERROR',
          error: error?.message,
        });
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    res.json({
      success: true,
      backfilled: recs.length,
      updated,
      failed,
      details: results,
    });
  } catch (error: any) {
    console.error(`[PaymentInfoBackfill] ERRO GERAL: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

/**
 * 🔍 Inspeção completa de payment info
 * GET /api/test/reactivation/payment-info/{receivableId}
 */
router.get('/payment-info/:receivableId', devOnly, async (req: Request, res: Response) => {
  try {
    const receivableId = parseInt(req.params.receivableId);
    const db = await getDb();

    if (!db) {
      return res.status(500).json({ success: false, error: 'DATABASE_ERROR' });
    }

    const rec = await db.select().from(receivables).where(eq(receivables.id, receivableId)).limit(1);

    if (!rec.length) {
      return res.status(404).json({ success: false, error: 'RECEIVABLE_NOT_FOUND' });
    }

    const receivable = rec[0];

    // Validar linha digitável
    let linhaDigitavelValid = false;
    if (receivable.linhaDigitavel) {
      const cleaned = receivable.linhaDigitavel.replace(/[\s.]/g, '');
      linhaDigitavelValid = /^\d{44}$|^\d{47}$/.test(cleaned);
    }

    // Validar URL pública
    let isPublicLink = false;
    if (receivable.link) {
      isPublicLink = await isPublicUrl(receivable.link);
    }

    // Validar PDF no storage
    let hasPdfStorage = false;
    if (receivable.pdfStorageUrl) {
      hasPdfStorage = await isPdfAccessible(receivableId);
    }

    // Determinar se pode enviar
    const canSend = linhaDigitavelValid || isPublicLink || hasPdfStorage;
    let blockReason = null;
    if (!canSend) {
      blockReason = 'MISSING_PAYMENT_INFO';
    }

    console.log(`[PaymentInfo] receivableId=${receivableId} canSend=${canSend} blockReason=${blockReason}`);

    res.json({
      receivableId,
      linhaDigitavelRaw: receivable.linhaDigitavel,
      linhaDigitavelValid,
      linkRaw: receivable.link,
      isPublicLink,
      pdfStorageUrl: receivable.pdfStorageUrl,
      hasPdfStorage,
      canSend,
      blockReason,
    });
  } catch (error: any) {
    console.error(`[PaymentInfo] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

/**
 * 📊 Monitorar status de delivery em tempo real
 * GET /api/test/reactivation/delivery-status/{receivableId}
 * Retorna: providerStatus (queued → sent → delivered → read)
 */
router.get('/delivery-status/:receivableId', devOnly, async (req: Request, res: Response) => {
  try {
    const receivableId = parseInt(req.params.receivableId);
    const db = await getDb();

    if (!db) {
      return res.status(500).json({ success: false, error: 'DATABASE_ERROR' });
    }

    // Buscar última mensagem para este receivable
    const messages = await db
      .select()
      .from(collectionMessages)
      .where(eq(collectionMessages.receivableId, receivableId))
      .orderBy((t) => t.createdAt)
      .limit(1);

    if (!messages.length) {
      return res.status(404).json({
        success: false,
        error: 'NO_MESSAGE_FOUND',
        receivableId,
      });
    }

    const message = messages[0];

    console.log(
      `[DeliveryStatus] receivableId=${receivableId} providerStatus=${message.providerStatus} sentAt=${message.sentAt}`
    );

    res.json({
      success: true,
      receivableId,
      providerMessageId: message.providerMessageId,
      providerStatus: message.providerStatus,
      status: message.status,
      sentAt: message.sentAt,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      providerRawStatus: message.providerRawStatus,
      providerError: message.providerError,
    });
  } catch (error: any) {
    console.error(`[DeliveryStatus] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

/**
 * 🧪 Smoke Test - Upload e List Objects no R2
 * POST /api/test/r2/smoke-upload
 * Valida se R2 está recebendo e listando objetos corretamente
 */
router.post('/r2/smoke-upload', devOnly, async (req: Request, res: Response) => {
  try {
    console.log('[R2SmokeTest] START');

    // 1. Upload de arquivo pequeno
    const smokeContent = Buffer.from('SMOKE TEST - ' + new Date().toISOString());
    const uploadResult = await uploadPdfToR2('smoke', smokeContent);

    if (!uploadResult.success) {
      console.error('[R2SmokeTest] UPLOAD_FAILED:', uploadResult.error);
      return res.status(500).json({
        success: false,
        stage: 'upload',
        error: uploadResult.error,
      });
    }

    console.log('[R2SmokeTest] UPLOAD_SUCCESS:', uploadResult.publicUrl);

    // 2. List objects no bucket
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const endpoint = process.env.R2_ENDPOINT || 'https://3b2c8f1a5e7c9d2b1f4a6e8c0d3b5f7a.r2.cloudflarestorage.com';
    const bucket = process.env.STORAGE_BUCKET || 'boletosfraga';

    const s3 = new S3Client({
      region: process.env.AWS_REGION || 'auto',
      endpoint,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
      forcePathStyle: true,
    });

    const listCommand = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: 'boletos/',
      MaxKeys: 10,
    });

    const listResult = await s3.send(listCommand);
    const objectCount = listResult.Contents?.length || 0;
    const objectKeys = listResult.Contents?.map((obj) => obj.Key) || [];

    console.log('[R2SmokeTest] LIST_SUCCESS count=' + objectCount + ' keys=' + JSON.stringify(objectKeys));

    res.json({
      success: true,
      stage: 'complete',
      upload: {
        key: uploadResult.key,
        publicUrl: uploadResult.publicUrl,
      },
      list: {
        bucket,
        endpoint,
        prefix: 'boletos/',
        objectCount,
        objectKeys: objectKeys.slice(0, 5), // Primeiros 5
      },
      message: 'Smoke test concluído. Verifique no painel Cloudflare se os objetos aparecem.',
    });
  } catch (error: any) {
    console.error('[R2SmokeTest] ERROR:', error?.message, error?.stack);
    res.status(500).json({
      success: false,
      stage: 'error',
      error: error?.message,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
  }
});

/**
 * 🔑 Gerar Presigned URL para Upload Direto ao R2
 * POST /api/test/r2/generate-presigned
 * Permite upload direto do cliente sem passar pelo backend
 */
router.post('/r2/generate-presigned', devOnly, async (req: Request, res: Response) => {
  try {
    const { receivableId } = req.body;

    if (!receivableId || typeof receivableId !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_RECEIVABLE_ID',
      });
    }

    console.log(`[PresignedURL] Gerando URL para receivableId=${receivableId}`);

    // Configuração do R2
    const endpoint = process.env.R2_ENDPOINT || 'https://3b2c8f1a5e7c9d2b1f4a6e8c0d3b5f7a.r2.cloudflarestorage.com';
    const bucket = process.env.STORAGE_BUCKET || 'boletosfraga';
    const publicBaseUrl = process.env.STORAGE_PUBLIC_BASE_URL || 'https://pub-803cde8c7a1942b0a35dd9678898243.r2.dev';

    // Chave do objeto
    const key = `boletos/${receivableId}.pdf`;
    const publicUrl = `${publicBaseUrl}/${key}`;

    // Gerar presigned PUT URL com TTL de 600 segundos (10 minutos)
    const expiresIn = 600;
    const now = new Date();
    const expirationTime = new Date(now.getTime() + expiresIn * 1000);

    // Construir presigned URL manualmente
    // Formato: https://endpoint/bucket/key?X-Amz-Algorithm=...&X-Amz-Credential=...&X-Amz-Date=...&X-Amz-Expires=...&X-Amz-Signature=...&X-Amz-SignedHeaders=...

    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';

    if (!accessKeyId || !secretAccessKey) {
      console.error('[PresignedURL] AWS credentials não configuradas');
      return res.status(500).json({
        success: false,
        error: 'AWS_CREDENTIALS_NOT_CONFIGURED',
      });
    }

    // Usar AWS SDK v3 para gerar presigned URL
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: 'application/pdf',
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });

    console.log(`[PresignedURL] ✅ URL gerada para receivableId=${receivableId}`);
    console.log(`[PresignedURL] Upload URL: ${uploadUrl.substring(0, 100)}...`);
    console.log(`[PresignedURL] Public URL: ${publicUrl}`);

    res.json({
      success: true,
      receivableId,
      key,
      uploadUrl,
      publicUrl,
      expiresIn,
      expiresAt: expirationTime.toISOString(),
      instructions: {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/pdf',
        },
        example: `curl -X PUT "${uploadUrl.substring(0, 50)}..." -H "Content-Type: application/pdf" --data-binary "@arquivo.pdf"`,
      },
    });
  } catch (error: any) {
    console.error(`[PresignedURL] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

/**
 * 🔍 DEBUG: Retornar dados completos do receivable para validação
 */
router.get('/debug/receivable-data/:receivableId', devOnly, async (req: Request, res: Response) => {
  try {
    const receivableId = parseInt(req.params.receivableId);
    const db = await getDb();

    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'DATABASE_CONNECTION_FAILED',
      });
    }

    const result = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, receivableId))
      .limit(1);

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'RECEIVABLE_NOT_FOUND',
      });
    }

    const r = result[0];
    const valorFormatado = (typeof r.amount === 'number' && r.amount > 100)
      ? (r.amount / 100).toFixed(2)
      : Number(r.amount || 0).toFixed(2);

    res.json({
      success: true,
      receivableId: r.id,
      clientId: r.clientId,
      amount: r.amount,
      valorFormatado: `R$ ${valorFormatado}`,
      dueDate: r.dueDate,
      documento: r.documento,
      linhaDigitavel: r.linhaDigitavel,
      link: r.link,
      pdfStorageUrl: r.pdfStorageUrl,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  } catch (error: any) {
    console.error(`[DebugReceivable] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

/**
 * 🔍 DEBUG: Listar todos os receivables com 90+ dias
 */
router.get('/debug/receivables-90plus', devOnly, async (req: Request, res: Response) => {
  try {
    const db = await getDb();

    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'DATABASE_CONNECTION_FAILED',
      });
    }

    // Calcular data 90 dias atrás
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const result = await db
      .select()
      .from(receivables)
      .where(
        and(
          eq(receivables.status, 'pending'),
          lte(receivables.dueDate, ninetyDaysAgo)
        )
      )
      .limit(50);

    const formatted = result.map(r => {
      const valorFormatado = (typeof r.amount === 'number' && r.amount > 100)
        ? (r.amount / 100).toFixed(2)
        : Number(r.amount || 0).toFixed(2);
      
      const daysOverdue = Math.floor(
        (Date.now() - new Date(r.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      return {
        receivableId: r.id,
        clientId: r.clientId,
        amount: r.amount,
        valorFormatado: `R$ ${valorFormatado}`,
        dueDate: r.dueDate,
        daysOverdue,
        documento: r.documento,
        status: r.status,
      };
    });

    res.json({
      success: true,
      total: formatted.length,
      receivables: formatted,
    });
  } catch (error: any) {
    console.error(`[DebugReceivables90Plus] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

/**
 * 🔍 DEBUG: Exibir última mensagem enviada
 */
router.get('/debug/last-message-sent', devOnly, async (req: Request, res: Response) => {
  try {
    const db = await getDb();

    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'DATABASE_CONNECTION_FAILED',
      });
    }

    const result = await db
      .select()
      .from(collectionMessages)
      .orderBy(desc(collectionMessages.createdAt))
      .limit(1);

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'NO_MESSAGES_FOUND',
      });
    }

    const msg = result[0];

    res.json({
      success: true,
      message: {
        id: msg.id,
        receivableId: msg.receivableId,
        clientId: msg.clientId,
        messageTemplate: msg.messageTemplate,
        messageType: msg.messageType,
        status: msg.status,
        outcome: msg.outcome,
        messageSent: msg.messageSent,
        createdAt: msg.createdAt,
        updatedAt: msg.updatedAt,
      },
    });
  } catch (error: any) {
    console.error(`[DebugLastMessage] ERROR: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});

/**
 * 🔄 SYNC: Sincronizar receivables do Conta Azul para um cliente específico
 */
router.post('/sync-conta-azul/:clientId', devOnly, async (req: Request, res: Response) => {
  const logs: string[] = [];
  
  const log = (msg: string) => {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${msg}`;
    logs.push(logMsg);
    console.log(logMsg);
  };

  try {
    const clientId = parseInt(req.params.clientId);
    log(`===== SYNC INICIADO =====`);
    log(`clientId: ${clientId}`);
    
    const db = await getDb();

    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'DATABASE_CONNECTION_FAILED',
        logs,
      });
    }

    // Buscar cliente no banco
    const clientResult = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (clientResult.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'CLIENT_NOT_FOUND',
      });
    }

    const client = clientResult[0];
    log(`contaAzulPersonId: ${client.contaAzulPersonId}`);

    // Buscar token de acesso
    const token = await getValidAccessToken();
    if (!token) {
      log(`ERRO: Falha ao obter token Conta Azul`);
      return res.status(500).json({
        success: false,
        error: 'CONTA_AZUL_TOKEN_FAILED',
        logs,
      });
    }
    log(`Token obtido com sucesso`);

    // Buscar contas a receber do Conta Azul via API Financeira
    // Endpoint correto: /v1/financeiro/eventos-financeiros/contas-a-receber/buscar
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    const dataVencimentoDe = ninetyDaysAgo.toISOString().split('T')[0];
    const dataVencimentoAte = thirtyDaysAhead.toISOString().split('T')[0];
    
    // AÇÃO B: Implementar filtro por cliente/pessoa
    // Tentando múltiplos parâmetros possíveis para filtrar por pessoa
    const contaAzulUrl = `${process.env.CONTA_AZUL_API_BASE}/financeiro/eventos-financeiros/contas-a-receber/buscar?pagina=1&tamanho_pagina=100&data_vencimento_de=${dataVencimentoDe}&data_vencimento_ate=${dataVencimentoAte}&pessoa_id=${client.contaAzulPersonId}`;
    log(`Tentando com filtro pessoa_id=${client.contaAzulPersonId}`);
    // Se pessoa_id não funcionar, a API ignorará e retornará todos (e filtraremos no código)
    log(`API_BASE: ${process.env.CONTA_AZUL_API_BASE}`);
    log(`URL COMPLETA: ${contaAzulUrl}`);
    log(`Periodo de vencimento: ${dataVencimentoDe} a ${dataVencimentoAte}`);

    log(`Iniciando requisição GET para API Financeira do Conta Azul...`);
    
    let response;
    try {
      response = await axios.get(contaAzulUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      log(`Requisição bem-sucedida! Status: 200`);
    } catch (axiosError: any) {
      log(`===== ERRO NA REQUISICAO =====`);
      log(`Status HTTP: ${axiosError.response?.status}`);
      log(`URL: ${contaAzulUrl}`);
      log(`Response Body: ${JSON.stringify(axiosError.response?.data)}`);
      log(`Error Message: ${axiosError.message}`);
      
      return res.status(500).json({
        success: false,
        error: `Request failed with status code ${axiosError.response?.status}`,
        logs,
        details: {
          url: contaAzulUrl,
          status: axiosError.response?.status,
          responseData: axiosError.response?.data,
        },
      });
    }

    // A API Financeira retorna estrutura diferente
    // Campo correto: response.data.itens (não data ou contas_a_receber)
    const receivablesFromContaAzul = response.data.itens || response.data.items || response.data.data || response.data.contas_a_receber || [];
    log(`Encontrados ${receivablesFromContaAzul.length} contas a receber`);
    
    // AÇÃO C: Log da resposta bruta para debug
    if (receivablesFromContaAzul.length > 0) {
      log(`===== RESPOSTA BRUTA (primeiros 2 itens) =====`);
      for (let i = 0; i < Math.min(2, receivablesFromContaAzul.length); i++) {
        log(`Item ${i}: ${JSON.stringify(receivablesFromContaAzul[i], null, 2)}`);
      }
      log(`===== FIM RESPOSTA BRUTA =====`);
    } else {
      log(`AVISO: Nenhuma conta a receber encontrada no período ${dataVencimentoDe} a ${dataVencimentoAte}`);
      log(`Resposta bruta da API: ${JSON.stringify(response.data, null, 2).substring(0, 500)}...`);
    }

    // AÇÃO D: Filtrar por cliente correto
    // A resposta pode conter contas de múltiplos clientes
    // Precisamos filtrar apenas as do cliente esperado
    log(`Filtrando contas para cliente esperado (contaAzulPersonId: ${client.contaAzulPersonId})`);
    
    // Procurar pelo cliente nos dados retornados
    // Pode estar em r.cliente.id, r.pessoa_id, r.cliente_id, etc
    const receivablesForThisClient = receivablesFromContaAzul.filter((r: any) => {
      const clienteId = r.cliente?.id || r.pessoa_id || r.cliente_id;
      const matches = clienteId === client.contaAzulPersonId;
      if (!matches) {
        log(`Ignorando conta ${r.id} (cliente: ${r.cliente?.nome || clienteId})`);
      }
      return matches;
    });
    
    log(`Após filtro: ${receivablesForThisClient.length} contas para este cliente`);

    // Formatar resposta (adaptado para API Financeira)
    const formatted = receivablesForThisClient.map((r: any) => {
      // A API Financeira pode ter campos diferentes
      // Campos típicos: id, total, data_vencimento, cliente, status, etc
      return {
        externalId: r.id,
        clientId: clientId,
        amount: r.total || r.valor || r.amount,
        dueDate: r.data_vencimento || r.dueDate,
        status: r.status || 'pending',
        rawData: r, // Manter dados brutos para debug
      };
    });

    log(`===== SYNC CONCLUIDO COM SUCESSO =====`);
    
    res.json({
      success: true,
      clientId,
      totalReceivables: formatted.length,
      receivables: formatted,
      logs,
    });
  } catch (error: any) {
    log(`===== ERRO GERAL =====`);
    log(`Error: ${error?.message}`);
    
    res.status(500).json({
      success: false,
      error: error?.message || 'SYNC_FAILED',
      logs,
    });
  }
});

/**
 * 🔍 AÇÃO 2B: Listar pessoas SEM filtro (para debug)
 */
router.get('/debug/list-all-pessoas', devOnly, async (req: Request, res: Response) => {
  const logs: string[] = [];
  
  const log = (msg: string) => {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${msg}`;
    logs.push(logMsg);
    console.log(logMsg);
  };

  try {
    log(`===== LISTAR TODAS AS PESSOAS =====`);
    
    const token = await getValidAccessToken();
    if (!token) {
      return res.status(500).json({
        success: false,
        error: 'TOKEN_FAILED',
        logs,
      });
    }
    log(`Token obtido`);

    // Listar pessoas SEM filtro (primeiras 50)
    const url = `${process.env.CONTA_AZUL_API_BASE}/pessoas?pagina=1&tamanho_pagina=50`;
    log(`URL: ${url}`);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    
    log(`Status: 200`);
    log(`Total encontrado: ${response.data.items || response.data.data?.length || 0}`);
    log(`Estrutura da resposta:`);
    if (response.data.items || response.data.data && response.data.items || response.data.data.length > 0) {
      log(`Primeiro item (completo):`);
      log(JSON.stringify(response.data.items || response.data.data[0], null, 2));
      
      // Listar todos os nomes para o usuário procurar
      log(`\n===== LISTA DE PESSOAS =====`);
      response.data.items || response.data.data.forEach((p: any, idx: number) => {
        log(`${idx + 1}. ID: ${p.id} | Nome: ${p.nome} | Documento: ${p.documento}`);
      });
    }

    res.json({
      success: true,
      logs,
      rawResponse: response.data,
    });
  } catch (error: any) {
    log(`ERRO: ${error?.message}`);
    if (error?.response?.data) {
      log(`Response: ${JSON.stringify(error.response.data)}`);
    }
    res.status(500).json({
      success: false,
      error: error?.message,
      logs,
    });
  }
});

/**
 * 🔍 AÇÃO 1B: Buscar cliente por NOME na API do Conta Azul
 */
router.post('/debug/find-cliente-by-name/:name', devOnly, async (req: Request, res: Response) => {
  const logs: string[] = [];
  const name = req.params.name;
  
  const log = (msg: string) => {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${msg}`;
    logs.push(logMsg);
    console.log(logMsg);
  };

  try {
    log(`===== BUSCAR CLIENTE POR NOME =====`);
    log(`Nome: ${name}`);
    
    const token = await getValidAccessToken();
    if (!token) {
      return res.status(500).json({
        success: false,
        error: 'TOKEN_FAILED',
        logs,
      });
    }
    log(`Token obtido`);

    // Buscar cliente por nome via endpoint de pessoas/clientes
    const url = `${process.env.CONTA_AZUL_API_BASE}/pessoas?filtro[nome]=${encodeURIComponent(name)}`;
    log(`URL: ${url}`);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    
    log(`Status: 200`);
    log(`Total encontrado: ${response.data.items || response.data.data?.length || 0}`);
    
    if (response.data.items || response.data.data && response.data.items || response.data.data.length > 0) {
      const cliente = response.data.items || response.data.data[0];
      log(`Cliente encontrado:`);
      log(`  ID: ${cliente.id}`);
      log(`  Nome: ${cliente.nome}`);
      log(`  Documento: ${cliente.documento}`);
    } else {
      log(`AVISO: Nenhum cliente encontrado com nome ${name}`);
    }

    res.json({
      success: true,
      name,
      logs,
      rawResponse: response.data,
    });
  } catch (error: any) {
    log(`ERRO: ${error?.message}`);
    if (error?.response?.data) {
      log(`Response: ${JSON.stringify(error.response.data)}`);
    }
    res.status(500).json({
      success: false,
      error: error?.message,
      logs,
    });
  }
});

/**
 * 🔍 AÇÃO 1: Buscar cliente por CNPJ na API do Conta Azul
 */
router.post('/debug/find-cliente-by-cnpj/:cnpj', devOnly, async (req: Request, res: Response) => {
  const logs: string[] = [];
  const cnpj = req.params.cnpj;
  
  const log = (msg: string) => {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${msg}`;
    logs.push(logMsg);
    console.log(logMsg);
  };

  try {
    log(`===== BUSCAR CLIENTE POR CNPJ =====`);
    log(`CNPJ: ${cnpj}`);
    
    const token = await getValidAccessToken();
    if (!token) {
      return res.status(500).json({
        success: false,
        error: 'TOKEN_FAILED',
        logs,
      });
    }
    log(`Token obtido`);

    // Tentar buscar cliente por CNPJ via endpoint de pessoas/clientes
    // Documentação: https://developers.contaazul.com/docs/pessoas-openapi
    const url = `${process.env.CONTA_AZUL_API_BASE}/pessoas?filtro[documento]=${cnpj}`;
    log(`URL: ${url}`);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    
    log(`Status: 200`);
    log(`Total encontrado: ${response.data.items || response.data.data?.length || 0}`);
    
    if (response.data.items || response.data.data && response.data.items || response.data.data.length > 0) {
      const cliente = response.data.items || response.data.data[0];
      log(`Cliente encontrado:`);
      log(`  ID: ${cliente.id}`);
      log(`  Nome: ${cliente.nome}`);
      log(`  Documento: ${cliente.documento}`);
      log(`  Resposta completa: ${JSON.stringify(cliente, null, 2)}`);
    } else {
      log(`AVISO: Nenhum cliente encontrado com CNPJ ${cnpj}`);
    }

    res.json({
      success: true,
      cnpj,
      logs,
      rawResponse: response.data,
    });
  } catch (error: any) {
    log(`ERRO: ${error?.message}`);
    if (error?.response?.data) {
      log(`Response: ${JSON.stringify(error.response.data)}`);
    }
    res.status(500).json({
      success: false,
      error: error?.message,
      logs,
    });
  }
});

/**
 * 🔍 Endpoint: Buscar pessoa por documento (com paginação e fallback para nome)
 */
router.post('/debug/find-pessoa-by-documento/:documento', devOnly, async (req: Request, res: Response) => {
  const documento = req.params.documento;
  const nome = req.query.nome as string | undefined;

  try {
    const token = await getValidAccessToken();
    if (!token) {
      return res.status(500).json({
        success: false,
        error: 'TOKEN_FAILED',
      });
    }

    const result = await findPessoaByDocumento(documento, nome, token);

    res.json({
      success: result.found,
      pessoa: result.pessoa,
      stats: result.stats,
      logs: result.logs,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message,
    });
  }
});



/**
 * 🔍 DEBUG: Testar API Financeira sem filtro de cliente
 */
router.get('/debug/api-financeira-test', devOnly, async (req: Request, res: Response) => {
  const logs: string[] = [];
  
  const log = (msg: string) => {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${msg}`;
    logs.push(logMsg);
    console.log(logMsg);
  };

  try {
    log(`===== TESTE API FINANCEIRA =====`);
    
    const token = await getValidAccessToken();
    if (!token) {
      return res.status(500).json({
        success: false,
        error: 'TOKEN_FAILED',
        logs,
      });
    }
    log(`Token obtido`);

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    const dataVencimentoDe = ninetyDaysAgo.toISOString().split('T')[0];
    const dataVencimentoAte = thirtyDaysAhead.toISOString().split('T')[0];
    
    const url = `${process.env.CONTA_AZUL_API_BASE}/financeiro/eventos-financeiros/contas-a-receber/buscar?pagina=1&tamanho_pagina=50&data_vencimento_de=${dataVencimentoDe}&data_vencimento_ate=${dataVencimentoAte}`;
    log(`URL: ${url}`);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    
    log(`Status: 200`);
    log(`Total encontrado: ${response.data.items || response.data.data?.length || 0}`);
    
    if (response.data.items || response.data.data && response.data.items || response.data.data.length > 0) {
      log(`Primeiro item:`);
      log(JSON.stringify(response.data.items || response.data.data[0], null, 2));
    }

    res.json({
      success: true,
      logs,
      rawResponse: response.data,
    });
  } catch (error: any) {
    log(`ERRO: ${error?.message}`);
    res.status(500).json({
      success: false,
      error: error?.message,
      logs,
    });
  }
});


/**
 * 🚀 ENDPOINT ORQUESTRADOR: Bootstrap Conta Azul
 * 
 * Fluxo automático sem workaround manual:
 * 1) Validar tenant do token
 * 2) Encontrar pessoa por CNPJ
 * 3) Persistir contaAzulPersonId no banco
 * 4) Rodar sync de receivables
 * 
 * POST /api/test/reactivation/bootstrap-conta-azul/:clientId
 * Body: { documento?: "21918918000194", expectedCnpj?: "...", expectedCompanyName?: "..." }
 */
router.post('/bootstrap-conta-azul/:clientId', async (req: Request, res: Response) => {
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(`[ContaAzulBootstrap] ${msg}`);
    logs.push(msg);
  };

  try {
    const clientId = parseInt(req.params.clientId);
    const { documento = '21918918000194', expectedCnpj, expectedCompanyName } = req.body || {};

    log(`START clientId=${clientId} documento=${documento}`);

    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        step: 'db-connect',
        error: 'DATABASE_NOT_AVAILABLE',
        logs,
      });
    }

    // ========================================
    // PASSO A: Validar tenant do token (multi-strategy)
    // ========================================
    log(`STEP_A: Validating tenant (multi-strategy)...`);

    let tenantCheckResult: any = null;
    try {
      tenantCheckResult = await tenantCheckMultiStrategy(clientId);

      if (!tenantCheckResult.ok) {
        log(`ERRO tenant-check multi-strategy failed: ${tenantCheckResult.error}`);
        if (tenantCheckResult.allAttempts) {
          log(`Attempts: ${JSON.stringify(tenantCheckResult.allAttempts)}`);
        }
        return res.status(422).json({
          success: false,
          step: 'tenant-check',
          error: 'TENANT_NOT_RESOLVED',
          message: tenantCheckResult.error,
          attempts: tenantCheckResult.allAttempts,
          logs,
        });
      }

      log(`tenant-check OK: strategyUsed=${tenantCheckResult.strategyUsed}`);
      log(`identifiers: ${JSON.stringify(tenantCheckResult.identifiers)}`);
      log(`baseUrl: ${tenantCheckResult.baseUrlEffective}`);

    } catch (error: any) {
      log(`ERRO tenant-check: ${error?.message}`);
      return res.status(422).json({
        success: false,
        step: 'tenant-check',
        error: 'TENANT_NOT_RESOLVED',
        message: error?.message,
        logs,
      });
    }


    // ========================================
    // PASSO B: Encontrar pessoa por documento
    // ========================================
    log(`STEP_B: Finding pessoa by documento=${documento}`);

    let pessoa: any = null;
    try {
      const token = await getValidAccessToken();
      log(`Using findPessoaByDocumentoV2 with documento=${documento}`);
      const result = await findPessoaByDocumentoV2(documento, token, undefined, expectedCompanyName);

      if (!result.found || !result.pessoa) {
        if (result.attempts) {
          log(`Attempts: ${JSON.stringify(result.attempts)}`);
        }
        if (result.logs) {
          result.logs.forEach((l: string) => log(l));
        }
        log(`ERRO: pessoa não encontrada`);
        return res.status(404).json({
          success: false,
          step: 'find-pessoa',
          error: 'PERSON_NOT_FOUND',
          documento,
          logs,
        });
      }

      pessoa = result.pessoa;
      log(`found=true personId=${pessoa.id} nome=${pessoa.nome}`);

    } catch (error: any) {
      log(`ERRO find-pessoa: ${error?.message}`);
      return res.status(500).json({
        success: false,
        step: 'find-pessoa',
        error: 'FIND_PESSOA_ERROR',
        message: error?.message,
        logs,
      });
    }

    // ========================================
    // PASSO C: Atualizar banco
    // ========================================
    log(`STEP_C: Updating database...`);

    let oldContaAzulPersonId: string | null = null;
    try {
      // Buscar cliente atual
      const clientRecord = await db
        .select()
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);

      if (!clientRecord.length) {
        return res.status(404).json({
          success: false,
          step: 'db-update',
          error: 'CLIENT_NOT_FOUND',
          clientId,
          logs,
        });
      }

      oldContaAzulPersonId = clientRecord[0].contaAzulPersonId || null;

      // Atualizar contaAzulPersonId
      await db
        .update(clients)
        .set({
          contaAzulPersonId: pessoa.id,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, clientId));

      log(`dbUpdate clientId=${clientId} old=${oldContaAzulPersonId} new=${pessoa.id}`);

    } catch (error: any) {
      log(`ERRO db-update: ${error?.message}`);
      return res.status(500).json({
        success: false,
        step: 'db-update',
        error: 'DB_UPDATE_ERROR',
        message: error?.message,
        logs,
      });
    }

    // ========================================
    // PASSO D: Rodar sync de receivables
    // ========================================
    log(`STEP_D: Running sync...`);

    let syncResult: any = null;
    try {
      const token = await getValidAccessToken();

      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const dataVencimentoDe = ninetyDaysAgo.toISOString().split('T')[0];
      const dataVencimentoAte = thirtyDaysAhead.toISOString().split('T')[0];

      const url = `${process.env.CONTA_AZUL_API_BASE}/financeiro/eventos-financeiros/contas-a-receber/buscar?pagina=1&tamanho_pagina=50&data_vencimento_de=${dataVencimentoDe}&data_vencimento_ate=${dataVencimentoAte}`;

      log(`sync URL: ${url}`);

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      const items = response.data.itens || response.data.data || [];
      log(`sync found ${items.length} receivables`);

      // Processar items e upsert no banco
      let upsertCount = 0;
      let lastReceivable: any = null;

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        
        // Log do primeiro item como prova
        if (idx === 0) {
          log(`FIRST_ITEM (raw): ${JSON.stringify(item).substring(0, 200)}...`);
        }
        
        // Filtrar apenas para o cliente atual (se possível)
        // Por enquanto, vamos upsert todos e deixar o sync fazer a filtragem

        const externalId = item.id || item.idEvento;
        const amount = item.total || item.valor || item.valorParcela || 0;
        const dueDate = item.data_vencimento || item.dataVencimento || item.vencimento;
        
        // Log do primeiro item com campos extraíos
        if (idx === 0) {
          log(`FIRST_ITEM (extracted): externalId=${externalId}, amount=${amount}, dueDate=${dueDate}`);
        }

        if (externalId && amount && dueDate) {
          try {
            // Upsert receivable
            const existing = await db
              .select()
              .from(receivables)
              .where(eq(receivables.contaAzulId, externalId))
              .limit(1);

            if (existing.length > 0) {
              await db
                .update(receivables)
                .set({
                  amount: String(amount),
                  dueDate: new Date(dueDate),
                  updatedAt: new Date(),
                })
                .where(eq(receivables.id, existing[0].id));
            } else {
              await db.insert(receivables).values({
                contaAzulId: externalId,
                clientId,
                amount: String(amount),
                dueDate: new Date(dueDate),
                status: 'overdue',
                source: 'conta-azul',
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            }

            upsertCount++;
            lastReceivable = { contaAzulId: externalId, amount, dueDate };
          } catch (e: any) {
            log(`warn: failed to upsert receivable ${externalId}: ${e?.message}`);
          }
        }
      }

      syncResult = {
        receivablesFound: items.length,
        receivablesUpserted: upsertCount,
        lastReceivable,
      };

      log(`sync done: upserted=${upsertCount} lastReceivable=${JSON.stringify(lastReceivable)}`);

    } catch (error: any) {
      log(`ERRO sync: ${error?.message}`);
      // Não falhar aqui, retornar parcial
      syncResult = {
        error: error?.message,
      };
    }

    // ========================================
    // RESPOSTA FINAL
    // ========================================
    log(`SUCCESS: bootstrap completed`);

    return res.json({
      success: true,
      clientId,
      tenant: tenantCheckResult,
      person: {
        id: pessoa.id,
        nome: pessoa.nome,
        documento: pessoa.documento,
        email: pessoa.email,
        telefone: pessoa.telefone,
        celular: pessoa.celular,
      },
      dbUpdate: {
        oldContaAzulPersonId,
        newContaAzulPersonId: pessoa.id,
      },
      sync: syncResult,
      logs,
    });

  } catch (error: any) {
    log(`FATAL: ${error?.message}`);
    return res.status(500).json({
      success: false,
      step: 'unknown',
      error: 'UNKNOWN_ERROR',
      message: error?.message,
      logs,
    });
  }
});


/**
 * 🚀 ENDPOINT ORQUESTRADOR: Disparo de Cobrança E2E
 * POST /api/test/reactivation/send-precharge-manual/:clientId
 * 
 * Fluxo completo:
 * 1. Validar token OAuth (pré-check)
 * 2. Rodar bootstrap (tenant-check → find-pessoa → db-update → sync)
 * 3. Selecionar receivable mais recente/pendente
 * 4. Gerar PDF do boleto e upload para R2
 * 5. Enviar WhatsApp via ZapContábil
 * 6. Auditar no banco (whatsappMessageId, sentAt, templateUsed, receivableId, status)
 */
router.post('/send-precharge-manual/:clientId', devOnly, async (req: Request, res: Response) => {
  const clientId = parseInt(req.params.clientId);
  const { documento, expectedCnpj, expectedCompanyName } = req.body || {};
  const logs: string[] = [];

  const log = (msg: string) => {
    const timestamp = new Date().toISOString();
    const logMsg = `[ReactivationDispatch] ${msg}`;
    console.log(logMsg);
    logs.push(logMsg);
  };

  try {
    const isDryRun = req.query.dryRun === '1';
    log(`START clientId=${clientId} documento=${documento} dryRun=${isDryRun}`);

    // Se for dryRun, pular validações de precondição (é só preview)
    if (!isDryRun) {
      // ========================================
      // TRAVA 3: Gate de Execucao (Precondition Check)
      // ========================================
      log(`GATE_CHECK: Validating preconditions...`);
    
    // Verificar /api/health
    try {
      const port = process.env.PORT || '3000';
      const healthResponse = await fetch(`http://localhost:${port}/api/health`);
      if (!healthResponse.ok) {
        log(`GATE_FAILED: Health check returned ${healthResponse.status}`);
        return res.status(412).json({
          success: false,
          step: 'precondition-check',
          error: 'HEALTH_CHECK_FAILED',
          reason: `Health check returned status ${healthResponse.status}`,
          logs,
        });
      }
    } catch (err: any) {
      log(`GATE_FAILED: Health check error: ${err.message}`);
      return res.status(412).json({
        success: false,
        step: 'precondition-check',
        error: 'HEALTH_CHECK_ERROR',
        reason: err.message,
        logs,
      });
    }

    // Verificar token OAuth valido via /api/test/e2e/status
    try {
      const port = process.env.PORT || '3000';
      const statusResponse = await fetch(`http://localhost:${port}/api/test/e2e/status`);
      if (!statusResponse.ok) {
        log(`GATE_FAILED: E2E status check returned ${statusResponse.status}`);
        return res.status(412).json({
          success: false,
          step: 'precondition-check',
          error: 'TOKEN_CHECK_FAILED',
          reason: `E2E status check returned status ${statusResponse.status}`,
          logs,
        });
      }
      const statusData = await statusResponse.json();
      if (!statusData.success || !statusData.system?.tokenValid) {
        log(`GATE_FAILED: Token not valid (tokenValid=${statusData.system?.tokenValid})`);
        return res.status(412).json({
          success: false,
          step: 'precondition-check',
          error: 'TOKEN_INVALID',
          reason: 'OAuth token is not valid or expired',
          logs,
        });
      }
      log(`GATE_PASSED: All preconditions met`);
      } catch (err: any) {
        log(`GATE_FAILED: Token validation error: ${err.message}`);
        return res.status(412).json({
          success: false,
          step: 'precondition-check',
          error: 'TOKEN_CHECK_ERROR',
          reason: err.message,
          logs,
        });
      }
    } else {
      log(`DRY_RUN: Skipping precondition checks (preview only)`);
    }

    const db = await getDb();
    if (!db) {
      return res.status(500).json({
        success: false,
        step: 'db-connection',
        error: 'DB_NOT_AVAILABLE',
        logs,
      });
    }


    // ========================================
    // IDEMPOTÊNCIA: Verificar se já foi enviado
    // ========================================
    if (!isDryRun) {
      log(`IDEMPOTENCY_CHECK: Verificando se (clientId=${clientId}, receivableId=?) já foi enviado...`);
      // Nota: receivableId será selecionado depois, então fazer check após STEP_3
    }

    // ========================================
    // PASSO 0: Validar cliente existe
    // ========================================
    log(`STEP_0: Validating client...`);
    const clientRecord = await db
      .select()
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!clientRecord.length) {
      return res.status(404).json({
        success: false,
        step: 'client-validation',
        error: 'CLIENT_NOT_FOUND',
        clientId,
        logs,
      });
    }

    const client = clientRecord[0];
    log(`client found: name=${client.name} document=${client.document}`);

    // ========================================
    // PASSO 1: Pré-check token OAuth (com validação corrigida)
    // ========================================
    log(`STEP_1: Pre-check token OAuth...`);
    try {
      const { validateTokenWithFallback } = await import('./tokenValidationWithRefresh');
      const tokenValidation = await validateTokenWithFallback(clientId, 'bootstrap-precheck');
      
      if (!tokenValidation.ok) {
        log(`ERRO token validation: ${tokenValidation.error}`);
        
        if (tokenValidation.requiresReauthorization) {
          return res.status(401).json({
            success: false,
            step: 'token-validation',
            error: 'REAUTHORIZE_REQUIRED',
            message: tokenValidation.error,
            logs,
          });
        }
        
        return res.status(401).json({
          success: false,
          step: 'token-validation',
          error: tokenValidation.errorCode || 'TOKEN_INVALID',
          message: tokenValidation.error,
          logs,
        });
      }
      
      log(`token valid: ${tokenValidation.attemptDetails?.[0]?.url || 'N/A'}`);
    } catch (error: any) {
      log(`ERRO token validation: ${error?.message}`);
      return res.status(500).json({
        success: false,
        step: 'token-validation',
        error: 'TOKEN_VALIDATION_ERROR',
        message: error?.message,
        logs,
      });
    }


    // Normalizar telefone para E.164 (antes dos GATES)
    let phoneE164: string | null = null;
    try {
      const phoneRaw = client.phoneCellular || client.phone;
      if (!phoneRaw) {
        throw new Error('No phone number found for client');
      }
      
      const { phoneE164: normalized, error: phoneError } = normalizePhoneE164(phoneRaw);
      if (phoneError || !normalized) {
        throw new Error(`Phone normalization failed: ${phoneError}`);
      }
      phoneE164 = normalized;
      log(`Phone normalized: ${phoneRaw} → ${phoneE164}`);
    } catch (error: any) {
      log(`ERRO phone normalization: ${error?.message}`);
      if (!isDryRun) {
        return res.status(422).json({
          ok: false,
          step: 'phone-normalization',
          error: 'INVALID_PHONE_E164',
          reason: error?.message,
          logs,
        });
      }
      throw error;
    }

    // ========================================
    // PASSO 3: Selecionar receivable
    // ========================================
    log(`STEP_3: Selecting receivable...`);
    let selectedReceivable: any = null;
    try {
      // Se receivableId foi passado na query, usar esse
      const queryReceivableId = req.query.receivableId ? parseInt(req.query.receivableId as string) : null;
      
      if (queryReceivableId) {
        log(`Using receivableId from query: ${queryReceivableId}`);
        const specificRecord = await db
          .select()
          .from(receivables)
          .where(
            and(
              eq(receivables.clientId, clientId),
              eq(receivables.id, queryReceivableId)
            )
          )
          .limit(1);
        
        if (!specificRecord.length) {
          throw new Error(`Receivable ${queryReceivableId} not found for client ${clientId}`);
        }
        selectedReceivable = specificRecord[0];
      } else {
        // Buscar receivable mais recente/pendente
        const receivableRecord = await db
          .select()
          .from(receivables)
          .where(
            and(
              eq(receivables.clientId, clientId),
              eq(receivables.status, 'pending')
            )
          )
          .orderBy(desc(receivables.dueDate))
          .limit(1);

        if (!receivableRecord.length) {
          // Tentar com status 'overdue'
          const overdueRecord = await db
            .select()
            .from(receivables)
            .where(
              and(
                eq(receivables.clientId, clientId),
                eq(receivables.status, 'overdue')
              )
            )
            .orderBy(desc(receivables.dueDate))
            .limit(1);

          if (!overdueRecord.length) {
            throw new Error('No receivables found for client');
          }
          selectedReceivable = overdueRecord[0];
        } else {
          selectedReceivable = receivableRecord[0];
        }
      }

      // Normalizar amount (centavos → reais)
      const amountValue = parseFloat(selectedReceivable.amount);
      const amountInReais = amountValue > 100 ? (amountValue / 100).toFixed(2) : amountValue.toFixed(2);

      log(`receivable selected: id=${selectedReceivable.id} amount=${amountInReais} dueDate=${selectedReceivable.dueDate}`);
    } catch (error: any) {
      log(`ERRO receivable selection: ${error?.message}`);
      return res.status(404).json({
        success: false,
        step: 'receivable-selection',
        error: 'NO_RECEIVABLES',
        message: error?.message,
        logs,
      });
    }

    // ========================================
    // GATES: Pré-condições antes do REAL
    // ========================================
    if (!isDryRun) {
      log(`GATES_CHECK: Validando pré-condições...`);
      
      // 1) Health check
      try {
        const healthResponse = await axios.get(`http://localhost:${process.env.PORT || 3000}/api/health`, { timeout: 5000 });
        if (healthResponse.status !== 200) {
          log(`GATE_FAILED: Health check returned status ${healthResponse.status}`);
          return res.status(412).json({
            ok: false,
            step: 'gates-check',
            error: 'HEALTH_CHECK_FAILED',
            reason: `Health check returned ${healthResponse.status}`,
            logs,
          });
        }
        log(`GATE_PASSED: Health check OK`);
      } catch (error: any) {
        log(`GATE_FAILED: Health check error: ${error?.message}`);
        return res.status(412).json({
          ok: false,
          step: 'gates-check',
          error: 'HEALTH_CHECK_FAILED',
          reason: error?.message,
          logs,
        });
      }
      
      // 2) Token validation
      try {
        const tokenStatusResponse = await axios.get(`http://localhost:${process.env.PORT || 3000}/api/test/e2e/status`, { timeout: 5000 });
        if (!tokenStatusResponse.data.system || !tokenStatusResponse.data.system.tokenValid) {
          log(`GATE_FAILED: Token validation failed`);
          return res.status(412).json({
            ok: false,
            step: 'gates-check',
            error: 'TOKEN_INVALID',
            reason: 'OAuth token is not valid or expired',
            logs,
          });
        }
        log(`GATE_PASSED: Token validation OK`);
      } catch (error: any) {
        log(`GATE_FAILED: Token validation error: ${error?.message}`);
        return res.status(412).json({
          ok: false,
          step: 'gates-check',
          error: 'TOKEN_CHECK_FAILED',
          reason: error?.message,
          logs,
        });
      }
      
      // 3) Phone E.164 validation
      if (!phoneE164) {
        log(`GATE_FAILED: Phone E.164 is null`);
        return res.status(422).json({
          ok: false,
          step: 'gates-check',
          error: 'INVALID_PHONE_E164',
          reason: 'Phone number is not in E.164 format',
          logs,
        });
      }
      log(`GATE_PASSED: Phone E.164 validation OK (${phoneE164})`);
      
      // 4) Receivable status validation
      if (!['pending', 'overdue'].includes(selectedReceivable.status)) {
        log(`GATE_FAILED: Receivable status is ${selectedReceivable.status}, expected pending/overdue`);
        return res.status(422).json({
          ok: false,
          step: 'gates-check',
          error: 'INVALID_RECEIVABLE_STATUS',
          reason: `Receivable status must be pending or overdue, got ${selectedReceivable.status}`,
          logs,
        });
      }
      log(`GATE_PASSED: Receivable status validation OK (${selectedReceivable.status})`);
      
      log(`GATES_ALL_PASSED: Todas as pré-condições validadas`);
    }

    // ========================================
    // PASSO 2: Rodar bootstrap (skip em dryRun)
    // ========================================
    log(`STEP_2: Running bootstrap...`);
    let bootstrapResult: any = null;
    
    if (!isDryRun) {
      // REAL: Chamar bootstrap endpoint
      const bootstrapUrl = `http://localhost:${process.env.PORT || 3000}/api/test/reactivation/bootstrap-conta-azul/${clientId}`;
      try {
        log(`Bootstrap URL: POST ${bootstrapUrl}`);
        log(`Bootstrap payload: ${JSON.stringify({ documento: documento || client.document })}`);
        
        const bootstrapResponse = await axios.post(
          bootstrapUrl,
          { documento: documento || client.document },
          {
            headers: {
              'X-Dev-Secret': process.env.DEV_SECRET || 'Contabil1',
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );

        if (!bootstrapResponse.data.success) {
          throw new Error(`Bootstrap failed: ${bootstrapResponse.data.error}`);
        }

        bootstrapResult = bootstrapResponse.data;
        log(`bootstrap ok: tenant=${bootstrapResult.tenant?.companyName} person=${bootstrapResult.person?.nome}`);
      } catch (error: any) {
        log(`ERRO bootstrap: ${error?.message}`);
        
        // Logging detalhado do erro
        if (error?.response) {
          log(`HTTP Status: ${error.response.status}`);
          log(`Response Data: ${JSON.stringify(error.response.data)}`);
          log(`Request-ID: ${error.response.headers['x-request-id'] || 'N/A'}`);
        }
        
        // Adicionar contexto à resposta
        const errorResponse: any = {
          success: false,
          step: 'bootstrap',
          error: 'BOOTSTRAP_FAILED',
          message: error?.message,
          context: {
            clientId,
            receivableId: selectedReceivable?.id,
          },
          logs,
        };
        
        if (error?.response) {
          errorResponse.httpStatus = error.response.status;
          errorResponse.responseData = error.response.data;
          errorResponse.requestUrl = bootstrapUrl;
          errorResponse.requestMethod = 'POST';
        }
        
        return res.status(error?.response?.status || 500).json(errorResponse);
      }
    } else {
      // DRY_RUN: Skip bootstrap, usar dados locais
      log(`DRY_RUN: Skipping bootstrap (preview mode, no Conta Azul calls)`);
      bootstrapResult = {
        tenant: { companyName: client.name },
        person: { nome: client.name, documento: client.document },
      };
    }


    // ========================================
    // IDEMPOTÊNCIA: Verificar se já foi enviado
    // ========================================
    if (!isDryRun) {
      log(`IDEMPOTENCY_CHECK: Verificando se (clientId=${clientId}, receivableId=${selectedReceivable.id}, channel=whatsapp) já foi enviado...`);
      
      try {
        const { whatsappAudit } = await import('../drizzle/schema');
        
        // Procurar audit existente com status "sent", "delivered", ou "queued"
        const existingAudit = await db
          .select()
          .from(whatsappAudit)
          .where(
            and(
              eq(whatsappAudit.clientId, clientId),
              eq(whatsappAudit.receivableId, selectedReceivable.id)
            )
          )
          .orderBy(desc(whatsappAudit.createdAt))
          .limit(1);
        
        if (existingAudit.length > 0) {
          const audit = existingAudit[0];
          const status = audit.status as string;
          
          // Se status é "sent", "delivered", ou "queued", retornar reused=true (a menos que force=1)
          if (['sent', 'delivered', 'queued'].includes(status) && req.query.force !== '1') {
            log(`IDEMPOTENCY_REUSED: Audit já existe com status=${status}, auditId=${audit.id}, messageId=${audit.messageId}`);
            return res.status(200).json({
              ok: true,
              reused: true,
              auditId: audit.id,
              messageId: audit.messageId,
              receivableId: selectedReceivable.id,
              clientId,
              logs,
            });
          }
          
          // Se status é "failed", permitir reenviar SOMENTE se ?force=1
          if (status === 'failed' && req.query.force !== '1') {
            log(`IDEMPOTENCY_FAILED_NO_FORCE: Audit anterior falhou, mas force=1 não foi passado`);
            return res.status(409).json({
              ok: false,
              error: 'PREVIOUS_ATTEMPT_FAILED',
              message: 'Envio anterior falhou. Use ?force=1 para reenviar.',
              auditId: audit.id,
              logs,
            });
          }
          
          if (status === 'failed' && req.query.force === '1') {
            log(`IDEMPOTENCY_FORCE_RETRY: Reenviando após falha anterior (force=1)`);
          }
        }
      } catch (error: any) {
        // Log completo do erro SQL
        log(`WARN idempotency check: Failed query: ${error?.sql || 'N/A'}`);
        log(`WARN idempotency check: Params: ${error?.parameters?.join(',') || 'N/A'}`);
        log(`WARN idempotency check: Driver error: ${error?.message}`);
        log(`WARN idempotency check: Stack: ${error?.stack?.split('\n')[0] || 'N/A'}`);
        // Não falhar aqui, continuar com envio
      }
    }

    // ========================================
    // PASSO 4: Download PDF do Conta Azul e upload para R2
    // ========================================
    log(`STEP_4: Downloading PDF from Conta Azul and uploading to R2...`);
    let pdfUrl: string | null = null;
    
    // Retry logic para 502/503/504
    const retryDelays = [500, 2000, 5000]; // ms
    let lastError: any = null;
    
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        const token = await getValidAccessToken();
        
        // Buscar boleto/PDF do Conta Azul
        const receivableDetailUrl = `${process.env.CONTA_AZUL_API_BASE}/financeiro/eventos-financeiros/contas-a-receber/${selectedReceivable.contaAzulId}`;
        
        const receivableResponse = await axios.get(receivableDetailUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
          timeout: 15000,
        });
        
        const receivableData = receivableResponse.data;
        const pdfLink = receivableData.boleto_url || receivableData.boleto?.url || receivableData.url;
        
        if (!pdfLink) {
          throw new Error('No PDF URL found in receivable data');
        }
        
        log(`pdf link from conta azul: ${pdfLink}`);
        
        // Download PDF
        const pdfResponse = await axios.get(pdfLink, {
          responseType: 'arraybuffer',
          timeout: 15000,
        });
        
        const pdfBuffer = Buffer.from(pdfResponse.data);
        log(`pdf downloaded: ${pdfBuffer.length} bytes`);
        
        // Upload para R2
        const uploadResult = await uploadPdfToR2(selectedReceivable.id, pdfBuffer);
        
        if (!uploadResult.success) {
          throw new Error(`Upload failed: ${uploadResult.error}`);
        }
        
        pdfUrl = uploadResult.publicUrl;
        log(`pdf uploaded to r2: ${pdfUrl}`);
        
        // Validar acesso público
        const headResponse = await axios.head(pdfUrl, {
          timeout: 5000,
          validateStatus: (status) => status >= 200 && status < 400,
        });
        
        if (headResponse.status !== 200) {
          throw new Error(`PDF not accessible: HTTP ${headResponse.status}`);
        }
        
        log(`pdf accessible: HTTP 200`);
        break; // Sucesso, sair do loop
      } catch (error: any) {
        lastError = error;
        const status = error?.response?.status;
        const isRetryable = [502, 503, 504].includes(status);
        
        if (isRetryable && attempt < retryDelays.length) {
          const delay = retryDelays[attempt];
          log(`RETRY pdf (attempt ${attempt + 1}/${retryDelays.length}): HTTP ${status}, waiting ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          log(`WARN pdf step: ${error?.message}`);
          // Não falhar aqui, continuar com link digitável
          pdfUrl = null;
          break;
        }
      }
    }

    // ========================================
    // PASSO 5: Enviar WhatsApp via ZapContábil
    // ========================================
    log(`STEP_5: Sending WhatsApp via ZapContábil...`);
    let whatsappMessageId: string | null = null;
    let whatsappStatus: string = 'pending';
    let correlationId: string | null = null;
    let providerTrackingMode: 'WITH_ID' | 'ACK_ONLY' | 'NO_ID_ACK' | 'WEBHOOK' = 'WITH_ID';
    let providerAck: boolean = false;
    try {
      const { sendWhatsAppMessageViaZapContabil, generateCorrelationId, calculatePayloadHash } = await import('./zapcontabilWhatsApp');
      
      const phone = phoneE164;

      // Normalizar amount
      const amountValue = parseFloat(selectedReceivable.amount);
      const amountInReais = amountValue > 100 ? (amountValue / 100).toFixed(2) : amountValue.toFixed(2);

      // Formatar data
      const dueDate = new Date(selectedReceivable.dueDate);
      const dueDateFormatted = dueDate.toLocaleDateString('pt-BR');

      // Template de mensagem
      const message = `Olá, ${client.name}. Segue o boleto referente aos serviços contábeis da Fraga Contabilidade para a ${bootstrapResult.person?.nome}. Valor: R$ ${amountInReais} | Vencimento: ${dueDateFormatted}. ${pdfUrl ? `Boleto: ${pdfUrl}` : 'Boleto em anexo'}. Posso confirmar o recebimento?`;

      // Gerar correlationId para rastreamento
      correlationId = generateCorrelationId(8019, clientId, selectedReceivable.id);
      log(`Generated correlationId: ${correlationId}`);
      
      // Incluir correlationId na mensagem
      const messageWithCorrelation = `${message}\n${correlationId}`;

      // Se for dryRun, não enviar de verdade
      if (isDryRun) {
        log(`DRY_RUN: Skipping WhatsApp send (preview only)`);
        whatsappStatus = 'preview';
        whatsappMessageId = null;  // Não gerar messageId em preview
      } else {
        // Enviar via ZapContábil
        const zapResult = await sendWhatsAppMessageViaZapContabil({
          phone,
          message: messageWithCorrelation,
          mediaUrl: pdfUrl || undefined,
          clientId,
          receivableId: selectedReceivable.id,
          correlationId,
          ticketId: 8019, // TODO: Obter ticketId do cliente/contato
        });

        if (!zapResult.ok) {
          throw new Error(`ZapContábil error: ${zapResult.error}`);
        }

        whatsappMessageId = zapResult.messageId || null;
        providerTrackingMode = zapResult.providerTrackingMode || 'WITH_ID';
        providerAck = zapResult.providerAck || false;
        
        // Status depende do tracking mode
        if (zapResult.providerTrackingMode === 'ACK_ONLY') {
          whatsappStatus = 'queued'; // ACK-only: mensagem foi aceita mas não confirmada
        } else {
          whatsappStatus = 'sent'; // Com messageId real
        }

        log(`[ZapContabilSend] whatsapp sent: messageId=${whatsappMessageId} correlationId=${correlationId} trackingMode=${providerTrackingMode} phone=${phone} status=${whatsappStatus}`);
      }
    } catch (error: any) {
      if (!isDryRun) {
        log(`[ZapContabilSend] ERRO whatsapp: ${error?.message}`);
        whatsappStatus = 'failed';
        
        // ✅ CORRIGIDO: 403 é NOT retryable → retornar 502 com ok:false
        // Nunca retornar success:true quando WhatsApp falha
        const httpStatus = error?.response?.status || 500;
        const errorData = error?.response?.data || {};
        
        // Logar detalhes completos
        log(`[ZapContabilSend] HTTP Status: ${httpStatus}`);
        log(`[ZapContabilSend] Response Data: ${JSON.stringify(errorData)}`);
        
        // Retornar erro com status apropriado
        return res.status(502).json({
          ok: false,
          success: false,
          step: 'whatsapp-send',
          error: 'WHATSAPP_SEND_FAILED',
          details: {
            httpStatus,
            errorMessage: error?.message,
            responseData: errorData,
            correlationId: error?.response?.headers?.['x-correlation-id'] || 'N/A',
          },
          logs,
        });
      } else {
        throw error;
      }
    }

    // ========================================
    // PASSO 6: Auditar no banco (skip em dryRun)
    // ========================================
    log(`STEP_6: Auditing...`);
    let auditId: number | null = null;
    
    // ✅ Em dryRun, não gravar auditoria (é só preview)
    if (isDryRun) {
      log(`DRY_RUN: Skipping audit (preview only)`);
    } else {
      try {
        // Importar tabela whatsappAudit
        const { whatsappAudit } = await import('../drizzle/schema');
        
        // Inserir auditoria com correlationId e tracking mode
        const auditResult = await db.insert(whatsappAudit).values({
          clientId,
          receivableId: selectedReceivable.id,
          messageId: whatsappMessageId,
          correlationId: correlationId,
          providerTrackingMode: providerTrackingMode,
          providerAck: providerAck,
          sentAt: new Date(),
          templateUsed: 'precharge-manual',
          status: whatsappStatus as 'sent' | 'failed' | 'delivered' | 'read' | 'error',
          errorMessage: whatsappStatus === 'failed' ? 'ZapContábil send failed' : null,
          phoneNumber: client.phoneCellular || client.phone,
          messageContent: null,
          pdfUrl: pdfUrl || null,
          providerAckAt: providerAck ? new Date() : null,
        });

        // Recuperar ID da auditoria com SELECT
        const inserted = await db
          .select({ id: whatsappAudit.id })
          .from(whatsappAudit)
          .where(
            and(
              eq(whatsappAudit.clientId, clientId),
              eq(whatsappAudit.receivableId, selectedReceivable.id),
              eq(whatsappAudit.messageId, whatsappMessageId || `failed_${Date.now()}`)
            )
          )
          .orderBy(desc(whatsappAudit.createdAt))
          .limit(1);

        if (inserted && inserted.length > 0) {
          auditId = inserted[0].id ?? null;
        }

        log(`[ZapContabilSend] audit recorded: auditId=${auditId} clientId=${clientId} receivableId=${selectedReceivable.id} messageId=${whatsappMessageId} status=${whatsappStatus}`);
      } catch (error: any) {
        log(`WARN audit: ${error?.message}`);
        log(`WARN audit stack: ${error?.stack?.split('\n')[0]}`);
        log(`WARN audit SQL: ${error?.sql}`);
        log(`WARN audit code: ${error?.code}`);
      }
    }


    // ========================================
    // RESPOSTA FINAL
    // ========================================
    log(`SUCCESS: dispatch completed`);

    // Em dryRun, não incluir sentAt (é só preview)
    const responseWhatsapp: any = {
      messageId: whatsappMessageId,
      status: whatsappStatus,
    };
    if (!isDryRun) {
      responseWhatsapp.sentAt = new Date();
    }

    const responseEvidencePack: any = {
      receivableId: selectedReceivable.id,
      pdfUrl,
      whatsappMessageId,
      correlationId,
      providerTrackingMode,
      providerAck,
      whatsappAuditId: auditId,
    };
    if (!isDryRun) {
      responseEvidencePack.sentAt = new Date();
    }

    return res.json({
      success: true,
      clientId,
      client: {
        id: client.id,
        name: client.name,
        document: client.document,
        phone: client.phoneCellular || client.phone,
      },
      bootstrap: bootstrapResult,
      receivable: {
        id: selectedReceivable.id,
        contaAzulId: selectedReceivable.contaAzulId,
        amount: selectedReceivable.amount,
        dueDate: selectedReceivable.dueDate,
        status: selectedReceivable.status,
      },
      whatsapp: responseWhatsapp,
      pdfUrl,
      auditId,
      evidencePack: responseEvidencePack,
      logs,
    });

  } catch (error: any) {
    log(`FATAL: ${error?.message}`);
    return res.status(500).json({
      success: false,
      step: 'unknown',
      error: 'UNKNOWN_ERROR',
      message: error?.message,
      logs,
    });
  }
});

/**
 * 🔍 PROBE: Testar todas as combinações de rota/payload/auth do ZapContábil
 * POST /api/test/reactivation/zapcontabil-probe
 */
router.post('/zapcontabil-probe', devOnly, async (req: Request, res: Response) => {
  try {
    const { runZapContabilProbe } = await import('./zapcontabilProbe');
    const results = await runZapContabilProbe();
    
    return res.json({
      ok: true,
      totalTests: results.totalTests,
      successCount: results.successCount,
      winner: results.winner,
      allResults: results.allResults,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message,
    });
  }
});

export default router;
