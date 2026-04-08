import { Router } from 'express';
import { getDb } from './db';
import { receivables } from '../drizzle/schema';
import { sql } from 'drizzle-orm';
import { downloadContaAzulPdf } from './contaAzulApiClient';
import FormData from 'form-data';

const router = Router();

router.post('/test-real-receivable', async (req, res) => {
  try {
    console.log(`\n[ETAPA5] Buscando primeiro receivable real...`);
    
    const db = await getDb();
    if (!db) {
      return res.status(500).json({ error: 'DB não disponível' });
    }
    
    // Buscar primeiro receivable com contaAzulId válido
    const results = await db
      .select()
      .from(receivables)
      .where(sql`${receivables.contaAzulId} IS NOT NULL AND ${receivables.contaAzulId} != 'r7-conta-azul-real' AND ${receivables.contaAzulId} != ''`)
      .limit(1);
    
    if (!results || results.length === 0) {
      return res.status(404).json({ error: 'Nenhum receivable real encontrado' });
    }
    
    const receivable = results[0];
    console.log(`[ETAPA5] Receivable encontrado: ID=${receivable.id}, ContaAzulId=${receivable.contaAzulId}`);
    
    // PASSO 1: Download do Conta Azul
    console.log(`\n[ETAPA5] PASSO 1: Baixando PDF do Conta Azul...`);
    console.log(`[ETAPA5] ContaAzulId: ${receivable.contaAzulId}`);
    
    const pdfBuffer = await downloadContaAzulPdf(receivable.contaAzulId!);
    
    if (!pdfBuffer) {
      return res.json({
        success: false,
        error: 'PDF_NOT_GENERATED_CONTA_AZUL',
        receivableId: receivable.id,
        contaAzulId: receivable.contaAzulId,
        pdf: {
          httpStatus: null,
          contentType: null,
          sizeBytes: 0,
        },
      });
    }
    
    console.log(`[ETAPA5] ✅ PDF baixado com sucesso (${pdfBuffer.length} bytes)`);
    
    // PASSO 2: Enviar via multipart (fluxo ETAPA 4 validado)
    console.log(`\n[ETAPA5] PASSO 2: Enviando via multipart...`);
    
    // Login
    const loginRes = await fetch('https://api-fraga.zapcontabil.chat/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'stevensfraga@gmail.com',
        password: 'Rafa@123',
      }),
    });
    
    if (loginRes.status !== 200) {
      throw new Error(`Login failed: HTTP ${loginRes.status}`);
    }
    
    const loginData = await loginRes.json();
    const token = loginData.token;
    const setCookie = loginRes.headers.get('set-cookie') || '';
    const jrtCookie = setCookie.split(';')[0] || '';
    
    console.log(`[ETAPA5] Login OK`);
    
    // Warm-up
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
    
    console.log(`[ETAPA5] Warm-up OK`);
    
    // Enviar multipart
    const correlationId = `[#FRAGA:8019:ETAPA5_REAL:${receivable.id}:${Date.now()}]`;
    const filename = `boleto-${receivable.id}.pdf`;
    
    const form = new FormData();
    form.append('fromMe', 'true');
    
    const pdfBytes = Buffer.isBuffer(pdfBuffer) ? new Uint8Array(pdfBuffer) : pdfBuffer;
    form.append('medias', new Blob([pdfBytes], { type: 'application/pdf' }), filename);
    
    form.append('filename', filename);
    form.append('body', `Cobrança R7 - boleto em anexo.\\n${correlationId}`);
    form.append('mediaType', 'application/pdf');
    
    const sendRes = await fetch(`https://api-fraga.zapcontabil.chat/messages/8019`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': jrtCookie,
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: form as any,
    });
    
    const sendStatus = sendRes.status;
    const sendText = await sendRes.text();
    
    console.log(`[ETAPA5] Send HTTP ${sendStatus}`);
    console.log(`[ETAPA5] Send response: ${sendText.substring(0, 200)}`);
    
    return res.json({
      success: sendStatus === 200,
      receivableId: receivable.id,
      contaAzulId: receivable.contaAzulId,
      correlationId,
      pdf: {
        httpStatus: 200,
        contentType: 'application/pdf',
        sizeBytes: pdfBuffer.length,
      },
      send: {
        httpStatus: sendStatus,
        response: sendText.substring(0, 200),
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ETAPA5] Erro:`, errMsg);
    return res.status(500).json({ error: errMsg });
  }
});

export default router;
