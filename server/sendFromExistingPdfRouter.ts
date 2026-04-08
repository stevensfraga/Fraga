import express from 'express';

const router = express.Router();

/**
 * /api/test/r7/send-from-existing-pdf
 * 
 * PLANO B: Envia PDF já existente via Zap (sem depender do painel Conta Azul)
 * 
 * Input:
 * - ticketId: ID do ticket no Zap
 * - clientId: ID do cliente no banco
 * - receivableId: ID da conta a receber
 * - pdfPublicUrl: URL pública do PDF (já válido)
 * - correlationId: ID de correlação
 * 
 * Output:
 * - ok: boolean
 * - decision: string
 * - messageId: string (se sucesso)
 * - correlationId: string
 */

router.post('/send-from-existing-pdf', async (req, res) => {
  const { ticketId, clientId, receivableId, pdfPublicUrl, correlationId } = req.body;
  
  console.log(`[SendFromExistingPdf] Iniciando envio com correlationId: ${correlationId || 'N/A'}`);
  
  try {
    // Validar inputs obrigatórios
    if (!ticketId || !pdfPublicUrl) {
      return res.status(400).json({
        ok: false,
        decision: 'MISSING_REQUIRED_FIELDS',
        error: 'ticketId e pdfPublicUrl são obrigatórios',
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    console.log(`[SendFromExistingPdf] Validando PDF URL: ${pdfPublicUrl}`);
    
    // Validar que pdfPublicUrl é acessível
    const pdfResponse = await fetch(pdfPublicUrl, { method: 'HEAD' });
    
    if (!pdfResponse.ok) {
      return res.status(400).json({
        ok: false,
        decision: 'PDF_NOT_ACCESSIBLE',
        error: `PDF URL retornou status ${pdfResponse.status}`,
        pdfPublicUrl,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    const contentType = pdfResponse.headers.get('content-type') || '';
    
    if (!contentType.includes('application/pdf')) {
      return res.status(400).json({
        ok: false,
        decision: 'INVALID_PDF_CONTENT_TYPE',
        error: `Content-Type esperado: application/pdf, recebido: ${contentType}`,
        pdfPublicUrl,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    console.log(`[SendFromExistingPdf] PDF válido, enviando via Zap...`);
    
    // Obter API key do Zap
    const zapApiKey = process.env.ZAP_CONTABIL_API_KEY;
    const zapBaseUrl = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
    
    if (!zapApiKey) {
      return res.status(500).json({
        ok: false,
        decision: 'ZAP_API_KEY_MISSING',
        error: 'ZAP_CONTABIL_API_KEY não configurado',
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    // PASSO 1: Upload do PDF para storage interno do Zap
    console.log(`[SendFromExistingPdf] Fazendo upload do PDF para Zap storage...`);
    
    const uploadResponse = await fetch(`${zapBaseUrl}/storage/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${zapApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: pdfPublicUrl,
        fileName: `boleto-${receivableId || 'unknown'}.pdf`,
      }),
    });
    
    if (!uploadResponse.ok) {
      const uploadError = await uploadResponse.text();
      console.error(`[SendFromExistingPdf] Erro no upload:`, uploadError);
      
      return res.status(500).json({
        ok: false,
        decision: 'ZAP_UPLOAD_FAILED',
        error: `Upload falhou com status ${uploadResponse.status}`,
        details: uploadError,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    const uploadResult = await uploadResponse.json();
    const internalPdfUrl = uploadResult.url || uploadResult.signedUrl;
    
    if (!internalPdfUrl) {
      return res.status(500).json({
        ok: false,
        decision: 'ZAP_UPLOAD_NO_URL',
        error: 'Upload retornou sucesso mas sem URL',
        uploadResult,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    console.log(`[SendFromExistingPdf] Upload bem-sucedido: ${internalPdfUrl}`);
    
    // PASSO 2: Enviar mensagem com PDF anexo
    console.log(`[SendFromExistingPdf] Enviando mensagem para ticket ${ticketId}...`);
    
    const messageResponse = await fetch(`${zapBaseUrl}/messages/${ticketId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${zapApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: `Segue o boleto solicitado. [#FRAGA:${correlationId || 'PLANO_B'}]`,
        mediaUrl: internalPdfUrl,
        mediaType: 'application/pdf',
        fileName: `boleto-${receivableId || 'unknown'}.pdf`,
      }),
    });
    
    if (!messageResponse.ok) {
      const messageError = await messageResponse.text();
      console.error(`[SendFromExistingPdf] Erro no envio:`, messageError);
      
      return res.status(500).json({
        ok: false,
        decision: 'ZAP_SEND_FAILED',
        error: `Envio falhou com status ${messageResponse.status}`,
        details: messageError,
        internalPdfUrl,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    }
    
    const messageResult = await messageResponse.json();
    const messageId = messageResult.id || messageResult.messageId;
    
    console.log(`[SendFromExistingPdf] Envio bem-sucedido: ${messageId || 'ACK'}`);
    
    return res.json({
      ok: true,
      decision: 'SENT_SUCCESS',
      messageId: messageId || 'ACK',
      ticketId,
      clientId,
      receivableId,
      pdfPublicUrl,
      internalPdfUrl,
      correlationId,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error: any) {
    console.error('[SendFromExistingPdf] Erro fatal:', error);
    
    return res.status(500).json({
      ok: false,
      decision: 'FATAL_ERROR',
      error: error.message,
      correlationId,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
