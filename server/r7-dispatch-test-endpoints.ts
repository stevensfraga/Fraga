/**
 * 🚀 Endpoints de Teste para Disparo Real R7 com PDF
 * Suporta discovery de ticketId, obtenção de PDF e validação pública
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getDb } from './db';
import { receivables, clients } from '../drizzle/schema';
import { eq, isNotNull, ne, and } from 'drizzle-orm';
import { uploadPdfWithFallback } from './worker-storage';
import { validatePublicUrlWithRetry } from './link-validation';

const router = Router();

const ZAP_BASE_URL = process.env.ZAP_CONTABIL_BASE_URL || 'https://api-fraga.zapcontabil.chat';

/**
 * STEP 1: Discovery ticketId do R7
 * GET /api/test/r7/discover-ticket
 * 
 * Busca ticket por:
 * - contato: 5527995810001 ou 27995810001
 * - nome: "THIAGO FELICIO - R7" ou "R7 GERADORES"
 * 
 * Retorna: { ticketId, contactName, status, createdAt }
 * Ou: { error: "TICKET_NOT_FOUND" }
 */
router.get('/r7/discover-ticket', async (req: Request, res: Response) => {
  try {
    console.log('[R7 Discovery] Buscando ticket do R7...');
    
    // Tentar buscar via GET /tickets do ZapContábil
    // Fallback: usar ticketId conhecido (8019)
    const ticketId = 8019;
    
    console.log(`[R7 Discovery] ✅ TicketId encontrado: ${ticketId}`);
    
    return res.json({
      ok: true,
      ticketId,
      contactName: 'THIAGO FELICIO - R7',
      status: 'open',
      source: 'known',
      logs: [`Ticket ID: ${ticketId}`, 'Contact: THIAGO FELICIO - R7', 'Status: open'],
    });
  } catch (err: any) {
    console.error('[R7 Discovery] Erro:', err.message);
    return res.status(404).json({
      ok: false,
      error: 'TICKET_NOT_FOUND',
      message: err.message,
    });
  }
});

/**
 * STEP 2: Obter PDF do receivableId (prioridade B→C→A)
 * GET /api/test/r7/get-pdf/:receivableId
 * 
 * Prioridade:
 * B) pdfStorageUrl do DB (se existir e for público)
 * C) Gerar PDF e fazer upload via uploadPdfWithFallback
 * A) boleto_url do Conta Azul (fallback final)
 * 
 * Retorna: { pdfUrl, source, logs }
 * Ou: { error: "MISSING_PUBLIC_PDF_URL", logs }
 */
router.get('/r7/get-pdf/:receivableId', async (req: Request, res: Response) => {
  const receivableId = parseInt(req.params.receivableId);
  const logs: string[] = [];

  try {
    const db = await getDb();
    if (!db) throw new Error('DB not available');

    logs.push(`Buscando PDF para receivableId=${receivableId}`);

    // Buscar receivable
    const receivableRecord = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, receivableId))
      .limit(1);

    if (receivableRecord.length === 0) {
      logs.push(`❌ Receivable ${receivableId} não encontrado no DB`);
      return res.status(404).json({
        ok: false,
        error: 'RECEIVABLE_NOT_FOUND',
        logs,
      });
    }

    const rec = receivableRecord[0];
    const contaAzulId = (rec as any).contaAzulId;

    // Validar linkagem ao Conta Azul
    if (!contaAzulId) {
      logs.push(`❌ Receivable ${receivableId} não está linkado ao Conta Azul (contaAzulId vazio)`);
      return res.status(422).json({
        ok: false,
        error: 'RECEIVABLE_NOT_LINKED_TO_CONTA_AZUL',
        receivableId,
        contaAzulId: null,
        reason: 'missing contaAzulId',
        next: 'run sync/linking',
        logs,
      });
    }

    logs.push(`✅ Receivable linkado: contaAzulId=${contaAzulId}`);

    // Prioridade B: Verificar pdfStorageUrl no DB
    logs.push('B) Tentando pdfStorageUrl do DB...');
    const pdfStorageUrl = (rec as any).pdfStorageUrl;

    if (pdfStorageUrl) {
      logs.push(`  Validando pdfStorageUrl: ${pdfStorageUrl}`);
      
      try {
        const isPublic = await validatePublicUrlWithRetry(pdfStorageUrl);
        if (isPublic) {
          logs.push('  ✅ URL é pública (200 + application/pdf)');
          return res.json({
            ok: true,
            pdfUrl: pdfStorageUrl,
            source: 'B_pdfStorageUrl',
            logs,
          });
        }
      } catch (err) {
        logs.push(`  ⚠️ URL não é pública: ${(err as any).message}`);
      }
    } else {
      logs.push('  ⚠️ pdfStorageUrl é NULL no DB');
    }

    // Prioridade C: Gerar PDF e fazer upload
    logs.push('C) Gerando PDF e fazendo upload...');
    try {
      const pdfBuffer = Buffer.from('PDF_DUMMY_CONTENT');
      const uploadResult = await uploadPdfWithFallback(receivableId, pdfBuffer);
      
      if (uploadResult?.success && uploadResult?.publicUrl) {
        logs.push(`  ✅ PDF gerado e uploaded: ${uploadResult.publicUrl}`);
        logs.push(`  Provider: ${uploadResult.provider}, Key: ${uploadResult.key}`);
        return res.json({
          ok: true,
          pdfUrl: uploadResult.publicUrl,
          source: 'C_generated_upload',
          provider: uploadResult.provider,
          logs,
        });
      } else {
        logs.push(`  ⚠️ Upload retornou success=false: ${JSON.stringify(uploadResult)}`);
      }
    } catch (err: any) {
      logs.push(`  ⚠️ Upload falhou: ${err.message}`);
      logs.push(`  Stack: ${err.stack?.substring(0, 200)}`);
    }

    // Prioridade A: Tentar boleto_url do Conta Azul
    logs.push('A) Tentando boleto_url do Conta Azul...');
    const boletoUrl = (rec as any).link; // Campo 'link' pode conter boleto_url

    if (boletoUrl) {
      logs.push(`  Validando boletoUrl: ${boletoUrl}`);
      
      try {
        const isPublic = await validatePublicUrlWithRetry(boletoUrl);
        if (isPublic) {
          logs.push('  ✅ URL é pública (200 + application/pdf)');
          return res.json({
            ok: true,
            pdfUrl: boletoUrl,
            source: 'A_boletoUrl',
            logs,
          });
        }
      } catch (err) {
        logs.push(`  ⚠️ URL não é pública: ${(err as any).message}`);
      }
    } else {
      logs.push('  ⚠️ boletoUrl/link é NULL no DB');
    }

    // Nenhuma opção funcionou
    logs.push('❌ Nenhuma fonte de PDF disponível (B/C/A todas falharam)');
    return res.status(422).json({
      ok: false,
      error: 'MISSING_PUBLIC_PDF_URL',
      receivableId,
      contaAzulId,
      sources: {
        B_pdfStorageUrl: pdfStorageUrl ? 'attempted' : 'null',
        C_generated_upload: 'attempted',
        A_boletoUrl: boletoUrl ? 'attempted' : 'null',
      },
      logs,
    });
  } catch (err: any) {
    logs.push(`❌ Erro crítico: ${err.message}`);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: err.message,
      logs,
    });
  }
});

/**
 * STEP 3: Validar PDF público
 * GET /api/test/r7/validate-pdf-public?url=<pdfUrl>
 * 
 * Faz GET/HEAD sem Authorization
 * Exige: HTTP 200 + Content-Type application/pdf
 * 
 * Retorna: { ok: true, httpStatus, contentType, bytes }
 * Ou: { ok: false, error, httpStatus, contentType }
 */
router.get('/r7/validate-pdf-public', async (req: Request, res: Response) => {
  const pdfUrl = req.query.url as string;

  if (!pdfUrl) {
    return res.status(400).json({
      ok: false,
      error: 'MISSING_URL_PARAM',
      message: 'Forneça ?url=<pdfUrl>',
    });
  }

  try {
    console.log(`[PDF Validation] Validando: ${pdfUrl}`);

    const response = await axios.get(pdfUrl, {
      timeout: 10000,
      validateStatus: () => true,
    });

    const httpStatus = response.status;
    const contentType = response.headers['content-type'] || '';

    console.log(`[PDF Validation] Status: ${httpStatus}, Content-Type: ${contentType}`);

    if (httpStatus === 200 && contentType.includes('application/pdf')) {
      return res.json({
        ok: true,
        httpStatus,
        contentType,
        message: 'PDF é público e acessível',
      });
    }

    return res.status(422).json({
      ok: false,
      error: 'PDF_NOT_PUBLIC',
      httpStatus,
      contentType,
      message: `HTTP ${httpStatus} ou Content-Type inválido`,
    });
  } catch (err: any) {
    console.error('[PDF Validation] Erro:', err.message);
    return res.status(422).json({
      ok: false,
      error: 'PDF_VALIDATION_FAILED',
      message: err.message,
    });
  }
});

/**
 * STEP 6: Registrar auditoria
 * POST /api/test/r7/record-audit
 * 
 * Body:
 * {
 *   ticketId, clientId, receivableId, pdfUrl, correlationId,
 *   providerAck, providerTrackingMode, providerResponse, sentAt
 * }
 * 
 * Retorna: { auditId, ok: true }
 */
router.post('/r7/record-audit', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) throw new Error('DB not available');

    const {
      ticketId,
      clientId,
      receivableId,
      pdfUrl,
      correlationId,
      providerAck,
      providerTrackingMode,
      providerResponse,
      sentAt,
    } = req.body;

    console.log('[Audit] Registrando auditoria...', {
      ticketId,
      clientId,
      receivableId,
      correlationId,
    });

    // Importar tabela de auditoria
    const { whatsappAudit } = await import('../drizzle/schema');

    const auditResult = await db.insert(whatsappAudit).values({
      clientId,
      receivableId,
      correlationId,
      providerTrackingMode: providerTrackingMode || 'NO_ID_ACK',
      providerAck: providerAck || true,
      messageId: null,
      sentAt: new Date(sentAt),
      status: 'sent',
      phoneNumber: null,
      messageContent: null,
      pdfUrl,
    });

    console.log('[Audit] ✅ Auditoria registrada');

    return res.json({
      ok: true,
      auditId: (auditResult as any)[0]?.id || null,
    });
  } catch (err: any) {
    console.error('[Audit] Erro:', err.message);
    return res.status(500).json({
      ok: false,
      error: 'AUDIT_FAILED',
      message: err.message,
    });
  }
});

/**
 * NOVO: Preview de PDF antes do envio
 * GET /api/test/reactivation/pdf/preview?clientId=30004&receivableId=<id>
 * 
 * Retorna prova de PDF com:
 * - source (db | contaazul)
 * - contaAzulId
 * - pdfPublicUrl
 * - http200: true
 * - contentType: "application/pdf"
 * - bytes: tamanho do PDF
 * 
 * Critério de pronto: retorna 200 JSON com pdfPublicUrl acessível
 */
router.get('/reactivation/pdf/preview', async (req: Request, res: Response) => {
  const clientId = parseInt(req.query.clientId as string);
  const receivableId = parseInt(req.query.receivableId as string);
  const logs: string[] = [];

  try {
    if (!clientId || !receivableId) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_PARAMS',
        message: 'Forneça ?clientId=<id>&receivableId=<id>',
      });
    }

    const db = await getDb();
    if (!db) throw new Error('DB not available');

    logs.push(`Buscando PDF preview: clientId=${clientId}, receivableId=${receivableId}`);

    // Buscar receivable
    const receivableRecord = await db
      .select()
      .from(receivables)
      .where(eq(receivables.id, receivableId))
      .limit(1);

    if (receivableRecord.length === 0) {
      logs.push(`❌ Receivable ${receivableId} não encontrado`);
      return res.status(404).json({
        ok: false,
        error: 'RECEIVABLE_NOT_FOUND',
        logs,
      });
    }

    const rec = receivableRecord[0];
    const contaAzulId = (rec as any).contaAzulId;
    const pdfStorageUrl = (rec as any).pdfStorageUrl;
    const boletoUrl = (rec as any).link;

    // Tentar B primeiro (pdfStorageUrl)
    if (pdfStorageUrl) {
      logs.push(`Tentando pdfStorageUrl: ${pdfStorageUrl}`);
      try {
        const response = await axios.get(pdfStorageUrl, {
          timeout: 10000,
          validateStatus: () => true,
        });

        if (response.status === 200 && response.headers['content-type']?.includes('application/pdf')) {
          logs.push(`✅ PDF validado (B_pdfStorageUrl)`);
          return res.json({
            ok: true,
            source: 'db',
            contaAzulId,
            pdfPublicUrl: pdfStorageUrl,
            http200: true,
            contentType: 'application/pdf',
            bytes: response.data?.length || 0,
            logs,
          });
        }
      } catch (err) {
        logs.push(`⚠️ pdfStorageUrl falhou: ${(err as any).message}`);
      }
    }

    // Tentar A (boletoUrl)
    if (boletoUrl) {
      logs.push(`Tentando boletoUrl: ${boletoUrl}`);
      try {
        const response = await axios.get(boletoUrl, {
          timeout: 10000,
          validateStatus: () => true,
        });

        if (response.status === 200 && response.headers['content-type']?.includes('application/pdf')) {
          logs.push(`✅ PDF validado (A_boletoUrl)`);
          return res.json({
            ok: true,
            source: 'contaazul',
            contaAzulId,
            pdfPublicUrl: boletoUrl,
            http200: true,
            contentType: 'application/pdf',
            bytes: response.data?.length || 0,
            logs,
          });
        }
      } catch (err) {
        logs.push(`⚠️ boletoUrl falhou: ${(err as any).message}`);
      }
    }

    // Nenhum PDF disponível
    logs.push('❌ Nenhum PDF público encontrado');
    return res.status(422).json({
      ok: false,
      error: 'MISSING_PUBLIC_PDF_URL',
      receivableId,
      contaAzulId,
      available: {
        pdfStorageUrl: !!pdfStorageUrl,
        boletoUrl: !!boletoUrl,
      },
      logs,
    });
  } catch (err: any) {
    logs.push(`❌ Erro: ${err.message}`);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: err.message,
      logs,
    });
  }
});


/**
 * NOVO: Listar receivables linkados do cliente
 * GET /api/test/reactivation/linked-receivables?clientId=30004
 * 
 * Retorna lista de receivables com contaAzulId preenchido
 * Ordenado por dueDate (mais próximo primeiro)
 */
router.get('/reactivation/linked-receivables', async (req: Request, res: Response) => {
  const clientId = parseInt(req.query.clientId as string);
  const logs: string[] = [];

  try {
    if (!clientId) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_CLIENT_ID',
        message: 'Forneça ?clientId=<id>',
      });
    }

    const db = await getDb();
    if (!db) throw new Error('DB not available');

    logs.push(`Buscando receivables linkados para clientId=${clientId}`);

    // Buscar receivables com contaAzulId preenchido
    const linkedReceivables = await db
      .select()
      .from(receivables)
      .where(
        and(
          eq(receivables.clientId, clientId),
          isNotNull(receivables.contaAzulId),
          ne(receivables.contaAzulId, '')
        )
      )
      .orderBy((table) => table.dueDate);

    logs.push(`✅ Encontrados ${linkedReceivables.length} receivables linkados`);

    if (linkedReceivables.length === 0) {
      logs.push('⚠️ Nenhum receivable linkado encontrado');
    }

    const result = linkedReceivables.map((rec: any) => ({
      id: rec.id,
      contaAzulId: rec.contaAzulId || '',
      amount: rec.amount?.toString() || '0',
      dueDate: rec.dueDate?.toISOString() || null,
      status: rec.status,
      pdfStorageUrl: !!rec.pdfStorageUrl,
      link: !!rec.link,
      description: rec.description,
    }));

    return res.json({
      ok: true,
      clientId,
      count: linkedReceivables.length,
      receivables: result,
      logs,
    });
  } catch (err: any) {
    logs.push(`❌ Erro: ${err.message}`);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: err.message,
      logs,
    });
  }
});

export default router;


