import { Router } from 'express';
import { getDb } from './db';
import { receivables, whatsappAudit } from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { fetchContaAzulReceivable, downloadContaAzulPdf } from './contaAzulApiClient';

const router = Router();

// ============================================================================
// HELPERS
// ============================================================================

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET = process.env.STORAGE_BUCKET || process.env.VITE_APP_ID || 'fraga-boletos';
const PREFIX = 'boletos/';

// ============================================================================
// STEP 1: resolveReceivableIdentity()
// ============================================================================

async function resolveReceivableIdentity(clientId: number, receivableId: number) {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    logs.push(`🔍 Buscando receivable: clientId=${clientId}, receivableId=${receivableId}`);

    const db = await getDb();
    if (!db) {
      logs.push(`❌ Database não disponível`);
      return {
        success: false,
        error: 'DB_NOT_AVAILABLE',
        logs,
        timingMs: Date.now() - startTime,
      };
    }

    // STEP 1A: Buscar no DB local
    const localReceivable = await db
      .select()
      .from(receivables)
      .where(and(eq(receivables.id, receivableId), eq(receivables.clientId, clientId)))
      .limit(1);

    if (localReceivable && localReceivable.length > 0) {
      const rec = localReceivable[0];
      logs.push(`✅ Receivable encontrado no DB local`);
      logs.push(`   contaAzulId: ${rec.contaAzulId}`);
      logs.push(`   amount: ${rec.amount}`);
      logs.push(`   status: ${rec.status}`);

      return {
        success: true,
        contaAzulId: rec.contaAzulId,
        documentNumber: rec.documento || `${clientId}-${receivableId}`,
        r2Key: rec.pdfStorageUrl || null,
        localReceivableId: rec.id,
        logs,
        timingMs: Date.now() - startTime,
      };
    }

    logs.push(`⚠️ Receivable não encontrado no DB local, tentando Conta Azul...`);

    // STEP 1B: Fallback - Buscar no Conta Azul
    const contaAzulReceivable = await fetchContaAzulReceivable(receivableId);
    if (!contaAzulReceivable) {
      logs.push(`❌ Receivable não encontrado no Conta Azul`);
      return {
        success: false,
        error: 'RECEIVABLE_NOT_FOUND_CONTA_AZUL',
        logs,
        timingMs: Date.now() - startTime,
      };
    }

    logs.push(`✅ Receivable encontrado no Conta Azul`);
    logs.push(`   contaAzulId: ${contaAzulReceivable.id}`);
    logs.push(`   amount: ${contaAzulReceivable.valor}`);

    // STEP 1C: Upsert no DB local
    try {
      await db.insert(receivables).values({
        contaAzulId: contaAzulReceivable.id,
        clientId,
        amount: String(contaAzulReceivable.valor),
        dueDate: new Date(contaAzulReceivable.data_vencimento),
        status: contaAzulReceivable.status === 'pago' ? 'paid' : 'pending',
        documento: contaAzulReceivable.numero_documento,
        description: contaAzulReceivable.descricao,
        source: 'conta-azul',
      }).onDuplicateKeyUpdate({
        set: {
          contaAzulId: contaAzulReceivable.id,
          amount: String(contaAzulReceivable.valor),
          dueDate: new Date(contaAzulReceivable.data_vencimento),
          status: contaAzulReceivable.status === 'pago' ? 'paid' : 'pending',
        },
      });

      logs.push(`✅ Receivable persistido no DB local`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logs.push(`⚠️ Erro ao persistir: ${errMsg}`);
    }

    return {
      success: true,
      contaAzulId: contaAzulReceivable.id,
      documentNumber: contaAzulReceivable.numero_documento || `${clientId}-${receivableId}`,
      r2Key: null, // Novo, não tem PDF em R2 ainda
      localReceivableId: receivableId,
      logs,
      timingMs: Date.now() - startTime,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logs.push(`❌ Erro: ${errMsg}`);
    return {
      success: false,
      error: 'RESOLVE_IDENTITY_FAILED',
      logs,
      timingMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// STEP 2: resolvePdfForReceivable()
// ============================================================================

async function resolvePdfForReceivable(
  contaAzulId: string,
  documentNumber: string,
  r2KeyHint?: string | null | undefined,
  localReceivableId?: number
) {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    logs.push(`📄 Resolvendo PDF para contaAzulId=${contaAzulId}`);

    // FALLBACK A: Se r2Key foi salvo, usar direto
    if (r2KeyHint) {
      logs.push(`🔄 Tentando R2 com r2Key existente: ${r2KeyHint}`);
      try {
        const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: r2KeyHint });
        const response = await s3.send(cmd);
        const bufferData = await response.Body?.transformToByteArray();

        if (bufferData && bufferData.length > 1000) {
          const buffer = Buffer.from(bufferData);
          logs.push(`✅ PDF encontrado no R2 (${buffer.length} bytes)`);
          const hash = crypto.createHash('sha256').update(buffer).digest('hex');
          return {
            success: true,
            source: 'R2_HINT',
            buffer,
            r2Key: r2KeyHint,
            sha256: hash,
            sizeBytes: buffer.length,
            logs,
            timingMs: Date.now() - startTime,
          };
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logs.push(`⚠️ R2 hint falhou: ${errMsg}`);
      }
    }

    // FALLBACK B: Tentar padrões no R2
    const patterns = [
      `${PREFIX}${contaAzulId}.pdf`,
      `${PREFIX}${documentNumber}.pdf`,
    ];

    for (const pattern of patterns) {
      logs.push(`🔄 Tentando padrão R2: ${pattern}`);
      try {
        const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: pattern });
        const response = await s3.send(cmd);
        const bufferData = await response.Body?.transformToByteArray();

        if (bufferData && bufferData.length > 1000) {
          const buffer = Buffer.from(bufferData);
          logs.push(`✅ PDF encontrado no R2: ${pattern} (${buffer.length} bytes)`);
          const hash = crypto.createHash('sha256').update(buffer).digest('hex');
          return {
            success: true,
            source: 'R2_PATTERN',
            buffer,
            r2Key: pattern,
            sha256: hash,
            sizeBytes: buffer.length,
            logs,
            timingMs: Date.now() - startTime,
          };
        }
      } catch (err) {
        // Expected: 404 se não encontrar
      }
    }

    // FALLBACK C: Buscar no Conta Azul
    logs.push(`🔄 Tentando Conta Azul...`);
    const pdfBuffer = await downloadContaAzulPdf(contaAzulId);

    if (!pdfBuffer || pdfBuffer.length < 1000) {
      logs.push(`❌ PDF não gerado no Conta Azul ou muito pequeno`);
      return {
        success: false,
        error: 'PDF_NOT_GENERATED_CONTA_AZUL',
        logs,
        timingMs: Date.now() - startTime,
      };
    }

    logs.push(`✅ PDF baixado do Conta Azul (${pdfBuffer.length} bytes)`);

    // FALLBACK C2: Upload para R2
    const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
    const r2Key = `${PREFIX}${contaAzulId}-${hash.substring(0, 8)}.pdf`;

    logs.push(`📤 Uploading para R2: ${r2Key}`);
    try {
      const cmd = new PutObjectCommand({
        Bucket: BUCKET,
        Key: r2Key,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
      });
      await s3.send(cmd);
      logs.push(`✅ PDF salvo em R2`);

      // FALLBACK C3: Persistir r2Key no DB
      if (localReceivableId) {
        const db = await getDb();
        if (db) {
          try {
            await db
              .update(receivables)
              .set({
                pdfStorageUrl: r2Key,
              })
              .where(eq(receivables.id, localReceivableId));
            logs.push(`✅ r2Key persistido no DB`);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logs.push(`⚠️ Erro ao persistir r2Key: ${errMsg}`);
          }
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logs.push(`❌ Erro ao upload R2: ${errMsg}`);
      return {
        success: false,
        error: 'R2_UPLOAD_FAILED',
        logs,
        timingMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      source: 'CONTA_AZUL',
      buffer: pdfBuffer,
      r2Key,
      sha256: hash,
      sizeBytes: pdfBuffer.length,
      logs,
      timingMs: Date.now() - startTime,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logs.push(`❌ Erro: ${errMsg}`);
    return {
      success: false,
      error: 'RESOLVE_PDF_FAILED',
      logs,
      timingMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// STEP 3: sendZapPdfMultipart()
// ============================================================================

async function sendZapPdfMultipart(
  ticketId: number,
  pdfBuffer: Buffer,
  filename: string,
  correlationId: string
) {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    logs.push(`🔐 Login programático...`);

    // Login
    const loginRes = await fetch('https://api-fraga.zapcontabil.chat/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.ZAP_CONTABIL_USER,
        password: process.env.ZAP_CONTABIL_PASS,
      }),
    });

    if (loginRes.status !== 200) {
      throw new Error(`Login failed: HTTP ${loginRes.status}`);
    }

    const loginData = await loginRes.json();
    const token = loginData.token;
    const setCookie = loginRes.headers.get('set-cookie') || '';
    const jrtCookie = setCookie.split(';')[0] || '';

    logs.push(`✅ Login OK`);

    // Warm-up
    logs.push(`🔄 Warm-up GET /tickets...`);
    const warmupRes = await fetch('https://api-fraga.zapcontabil.chat/tickets?pageNumber=1&pageSize=10', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': jrtCookie,
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
    });

    if (warmupRes.status !== 200) {
      throw new Error(`Warm-up failed: HTTP ${warmupRes.status}`);
    }

    logs.push(`✅ Warm-up OK`);

    // Send multipart
    logs.push(`📤 Enviando PDF via multipart...`);

    const form = new FormData();
    form.append('fromMe', 'true');
    const pdfBytes = Buffer.isBuffer(pdfBuffer) ? new Uint8Array(pdfBuffer) : pdfBuffer;
    form.append('medias', new Blob([pdfBytes], { type: 'application/pdf' }), filename);
    form.append('filename', filename);
    form.append('body', `Cobrança R7 - boleto em anexo.\n${correlationId}`);
    form.append('mediaType', 'application/pdf');

    const sendRes = await fetch(`https://api-fraga.zapcontabil.chat/messages/${ticketId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': jrtCookie,
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: form,
    });

    const sendResponseText = await sendRes.text();
    let sendResponseJson = {};
    try {
      sendResponseJson = JSON.parse(sendResponseText);
    } catch (e) {
      sendResponseJson = { raw: sendResponseText };
    }

    if (sendRes.status !== 200) {
      throw new Error(`Send failed: HTTP ${sendRes.status}: ${JSON.stringify(sendResponseJson)}`);
    }

    logs.push(`✅ Envio OK (HTTP ${sendRes.status})`);

    // Validate
    logs.push(`📋 Validando no ticket...`);
    const ticketRes = await fetch(`https://api-fraga.zapcontabil.chat/tickets/${ticketId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': jrtCookie,
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
    });

    const ticketData = await ticketRes.json();
    const hasCorrelationId = ticketData.lastMessage?.includes(correlationId);

    if (!hasCorrelationId) {
      throw new Error(`CorrelationId not found in ticket lastMessage`);
    }

    logs.push(`✅ Validação OK`);

    return {
      success: true,
      httpStatus: sendRes.status,
      providerResponse: sendResponseJson,
      ticketLastMessage: ticketData.lastMessage,
      logs,
      timingMs: Date.now() - startTime,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logs.push(`❌ Erro: ${errMsg}`);
    return {
      success: false,
      error: 'ZAP_SEND_FAILED',
      logs,
      timingMs: Date.now() - startTime,
    };
  }
}

// ============================================================================
// MAIN ENDPOINT: POST /api/r7/send-receivable
// ============================================================================

router.post('/send-receivable', async (req, res) => {
  const { ticketId, clientId, receivableId, correlationId } = req.body;
  const overallStart = Date.now();

  if (!ticketId || !clientId || !receivableId || !correlationId) {
    return res.status(400).json({
      success: false,
      error: 'MISSING_REQUIRED_FIELDS',
      message: 'ticketId, clientId, receivableId, correlationId are required',
    });
  }

  try {
    console.log(`🚀 POST /api/r7/send-receivable: ticketId=${ticketId}, clientId=${clientId}, receivableId=${receivableId}`);

    // STEP 1: Resolve identity
    const identityResult = await resolveReceivableIdentity(clientId, receivableId);
    if (!identityResult.success) {
      return res.status(404).json({
        success: false,
        error: identityResult.error,
        logs: identityResult.logs,
      });
    }

    // STEP 2: Resolve PDF
    const pdfResult = await resolvePdfForReceivable(
      identityResult.contaAzulId as string,
      identityResult.documentNumber as string,
      identityResult.r2Key || undefined,
      identityResult.localReceivableId
    );

    if (!pdfResult.success) {
      return res.status(422).json({
        success: false,
        error: pdfResult.error,
        logs: pdfResult.logs,
      });
    }

    // STEP 3: Send via ZapContábil
    const zapResult = await sendZapPdfMultipart(
      ticketId,
      pdfResult.buffer as Buffer,
      `boleto-${receivableId}.pdf`,
      correlationId as string
    );

    if (!zapResult.success) {
      return res.status(502).json({
        success: false,
        error: zapResult.error,
        logs: zapResult.logs,
      });
    }

    // SUCCESS - Persist audit
    const db = await getDb();
    if (db) {
      try {
        await db.insert(whatsappAudit).values({
          clientId,
          receivableId: identityResult.localReceivableId || receivableId,
          correlationId,
          providerTrackingMode: 'NO_ID_ACK',
          providerAck: true,
          sentAt: new Date(),
          status: 'sent',
          phoneNumber: '', // TODO: Get from client
          messageContent: `Cobrança R7 - boleto em anexo.\n${correlationId}`,
          pdfUrl: pdfResult.r2Key || '',
        });
      } catch (err) {
        console.error('⚠️ Erro ao persistir auditoria:', err);
      }
    }

    // SUCCESS
    return res.json({
      success: true,
      correlationId,
      pdf: {
        source: pdfResult.source,
        r2Key: pdfResult.r2Key,
        sha256: pdfResult.sha256,
        sizeBytes: pdfResult.sizeBytes,
      },
      zap: {
        send_http: zapResult.httpStatus,
        providerRaw: zapResult.providerResponse,
      },
      ticketLastMessage: zapResult.ticketLastMessage,
      timingsMs: {
        resolveIdentity: identityResult.timingMs,
        resolvePdf: pdfResult.timingMs,
        send: zapResult.timingMs,
        total: Date.now() - overallStart,
      },
      logs: {
        identity: identityResult.logs,
        pdf: pdfResult.logs,
        zap: zapResult.logs,
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Erro: ${errMsg}`);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: errMsg,
    });
  }
});

export default router;
