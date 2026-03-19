/**
 * ENDPOINT WORKAROUND: Envio com PDF Dummy
 * POST /api/test/r7/send-real-with-pdf
 * 
 * Fluxo:
 * A) Gerar PDF dummy em memória
 * B) Upload para storage interno (discovery automático)
 * C) Gerar signed URL
 * D) Enviar mensagem com PDF
 */

import { Router, Request, Response } from 'express';
import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { PDFDocument, rgb } from 'pdf-lib';

const router = Router();

interface UploadResult {
  endpoint: string;
  httpStatus: number;
  filename?: string;
  key?: string;
  url?: string;
  rawResponse: any;
}

// Criar axios com cookie jar
const createAxiosWithCookies = () => {
  const jar: { [key: string]: string } = {};
  
  const instance = axios.create({
    withCredentials: true,
    validateStatus: () => true,
  });

  instance.interceptors.response.use((response) => {
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      cookies.forEach((cookie) => {
        const [nameValue] = cookie.split(';');
        const [name, value] = nameValue.split('=');
        if (name && value) {
          jar[name.trim()] = value.trim();
        }
      });
    }
    return response;
  });

  instance.interceptors.request.use((config) => {
    const cookieString = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieString) {
      config.headers.Cookie = cookieString;
    }
    return config;
  });

  return instance;
};

// Gerar PDF dummy
async function generateDummyPdf(correlationId: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const { height } = page.getSize();

  // Título
  page.drawText('TESTE R7', {
    x: 50,
    y: height - 50,
    size: 24,
    color: rgb(0, 0, 0),
  });

  // Conteúdo
  page.drawText('Cobrança R7 - boleto teste', {
    x: 50,
    y: height - 100,
    size: 14,
    color: rgb(0, 0, 0),
  });

  // CorrelationId
  page.drawText(`Rastreamento: ${correlationId}`, {
    x: 50,
    y: height - 150,
    size: 10,
    color: rgb(0.4, 0.4, 0.4),
  });

  // Timestamp
  page.drawText(`Gerado em: ${new Date().toISOString()}`, {
    x: 50,
    y: height - 180,
    size: 10,
    color: rgb(0.4, 0.4, 0.4),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

router.post('/r7/send-real-with-pdf', async (req: Request, res: Response) => {
  const { ticketId, clientId, receivableId, correlationId } = req.body;
  const logs: string[] = [];
  const startTime = Date.now();

  try {
    logs.push(`🚀 Iniciando workaround com PDF dummy: ticketId=${ticketId}, receivableId=${receivableId}`);

    // Validar inputs
    if (!ticketId || !clientId || !receivableId || !correlationId) {
      logs.push('❌ Parâmetros obrigatórios faltando');
      return res.status(400).json({
        ok: false,
        error: 'MISSING_PARAMS',
        logs,
      });
    }

    // ========== STEP A: Gerar PDF dummy ==========
    logs.push(`📄 STEP A: Gerando PDF dummy...`);

    const pdfBuffer = await generateDummyPdf(correlationId);
    const payloadHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    logs.push(`✅ PDF gerado: ${pdfBuffer.length} bytes, hash=${payloadHash.substring(0, 16)}...`);

    // ========== STEP B: Upload para storage interno ==========
    logs.push(`📤 STEP B: Tentando upload para storage interno...`);

    const user = process.env.ZAP_CONTABIL_USER;
    const pass = process.env.ZAP_CONTABIL_PASS;

    if (!user || !pass) {
      logs.push('❌ Credenciais não configuradas');
      return res.status(401).json({
        ok: false,
        error: 'MISSING_CREDENTIALS',
        logs,
      });
    }

    // Login
    const axiosInstance = createAxiosWithCookies();
    const apiBaseUrl = 'https://api-fraga.zapcontabil.chat';

    logs.push(`🔐 Login...`);
    const loginResponse = await axiosInstance.post(`${apiBaseUrl}/auth/login`, {
      email: user,
      password: pass,
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (loginResponse.status !== 200) {
      logs.push(`❌ Login falhou: ${loginResponse.status}`);
      return res.status(401).json({
        ok: false,
        error: 'LOGIN_FAILED',
        logs,
      });
    }

    const bearerToken = loginResponse.data?.token;
    if (!bearerToken) {
      logs.push('❌ Token não retornado');
      return res.status(401).json({
        ok: false,
        error: 'NO_TOKEN',
        logs,
      });
    }

    logs.push(`✅ Login OK`);

    // Warm-up
    logs.push(`🔄 Warm-up...`);
    const warmupResponse = await axiosInstance.get(`${apiBaseUrl}/tickets?pageNumber=1`, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Accept': 'application/json',
      },
    });

    logs.push(`✅ Warm-up: ${warmupResponse.status}`);

    // Endpoints candidatos para upload
    const uploadEndpoints = [
      '/upload',
      '/files/upload',
      '/storage/upload',
      '/attachments/upload',
      '/media/upload',
      '/documents/upload',
      '/file/upload',
      '/messages/upload',
      '/tickets/upload',
      '/storage',
      '/files',
      '/api/upload',
    ];

    let uploadResult: UploadResult | null = null;
    const fileName = `boleto-r7-teste-${Date.now()}.pdf`;

    // Tentar multipart/form-data
    logs.push(`📤 Tentando multipart/form-data...`);
    for (const endpoint of uploadEndpoints) {
      try {
        // FormData nativo do Node.js 18+
        const formData = new FormData();
        const pdfBytes = Buffer.isBuffer(pdfBuffer) ? new Uint8Array(pdfBuffer) : pdfBuffer;
        const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        formData.append('file', pdfBlob, fileName);

        const uploadResponse = await axiosInstance.post(`${apiBaseUrl}${endpoint}`, formData, {
          headers: {
            'Authorization': `Bearer ${bearerToken}`,
            'Accept': 'application/json',
          },
          timeout: 15000,
          validateStatus: () => true,
        });

        const responseText = JSON.stringify(uploadResponse.data);
        const contentType = uploadResponse.headers['content-type'] || '';

        // Procurar por indicadores de sucesso
        if (
          responseText.includes('filename') ||
          responseText.includes('key') ||
          responseText.includes('url') ||
          responseText.includes('file')
        ) {
          logs.push(`✅ Endpoint encontrado: ${endpoint} (HTTP ${uploadResponse.status})`);
          
          uploadResult = {
            endpoint,
            httpStatus: uploadResponse.status,
            filename: uploadResponse.data?.filename || uploadResponse.data?.key,
            rawResponse: uploadResponse.data,
          };

          // Extrair filename/key
          if (uploadResponse.data?.filename) {
            uploadResult.filename = uploadResponse.data.filename;
          } else if (uploadResponse.data?.key) {
            uploadResult.filename = uploadResponse.data.key;
          } else if (uploadResponse.data?.url) {
            // Extrair filename da URL
            const urlMatch = uploadResponse.data.url.match(/\/([^/?]+\.pdf)/);
            if (urlMatch) {
              uploadResult.filename = urlMatch[1];
            }
          }

          break;
        }

        logs.push(`⚠️ ${endpoint}: ${uploadResponse.status}, content-type=${contentType}`);
      } catch (err: any) {
        logs.push(`⚠️ ${endpoint}: erro=${err.message}`);
      }
    }

    // Se multipart não funcionou, tentar base64
    if (!uploadResult) {
      logs.push(`📤 Tentando JSON base64...`);
      const base64 = pdfBuffer.toString('base64');

      for (const endpoint of uploadEndpoints.slice(0, 6)) {
        try {
          const uploadResponse = await axiosInstance.post(`${apiBaseUrl}${endpoint}`, {
            fileBase64: base64,
            fileName: fileName,
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${bearerToken}`,
              'Accept': 'application/json',
            },
            timeout: 15000,
            validateStatus: () => true,
          });

          const responseText = JSON.stringify(uploadResponse.data);

          if (
            responseText.includes('filename') ||
            responseText.includes('key') ||
            responseText.includes('url')
          ) {
            logs.push(`✅ Endpoint encontrado (base64): ${endpoint}`);
            
            uploadResult = {
              endpoint,
              httpStatus: uploadResponse.status,
              filename: uploadResponse.data?.filename || uploadResponse.data?.key,
              rawResponse: uploadResponse.data,
            };

            if (uploadResponse.data?.url) {
              const urlMatch = uploadResponse.data.url.match(/\/([^/?]+\.pdf)/);
              if (urlMatch) {
                uploadResult.filename = urlMatch[1];
              }
            }

            break;
          }
        } catch (err: any) {
          logs.push(`⚠️ ${endpoint}: erro=${err.message}`);
        }
      }
    }

    if (!uploadResult || !uploadResult.filename) {
      logs.push('❌ Nenhum endpoint de upload retornou filename/key');
      return res.status(422).json({
        ok: false,
        error: 'UPLOAD_ENDPOINT_NOT_FOUND',
        logs,
      });
    }

    logs.push(`✅ Upload concluído: endpoint=${uploadResult.endpoint}, filename=${uploadResult.filename}`);

    // ========== STEP C: Gerar signed URL ==========
    logs.push(`🔗 STEP C: Gerando signed URL...`);

    const signedUrlResponse = await axiosInstance.get(
      `${apiBaseUrl}/storage/signedUrl/${encodeURIComponent(uploadResult.filename)}?expiresInSeconds=900`,
      {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Accept': 'application/json',
        },
      }
    );

    if (signedUrlResponse.status !== 200 || !signedUrlResponse.data?.url) {
      logs.push(`❌ Signed URL falhou: ${signedUrlResponse.status}`);
      return res.status(422).json({
        ok: false,
        error: 'SIGNED_URL_FAILED',
        httpStatus: signedUrlResponse.status,
        logs,
      });
    }

    const signedUrl = signedUrlResponse.data.url;
    logs.push(`✅ Signed URL gerada`);

    // ========== STEP D: Enviar mensagem ==========
    logs.push(`📨 STEP D: Enviando mensagem com PDF...`);

    const messageBody = `Cobrança R7 - boleto em anexo.\n${correlationId}`;
    const messagePayload = {
      read: true,
      fromMe: true,
      mediaUrl: signedUrl,
      mediaType: 'application/pdf',
      fileName: `boleto-r7-teste.pdf`,
      body: messageBody,
      quotedMsg: null,
    };

    const sendResponse = await axiosInstance.post(`${apiBaseUrl}/messages/${ticketId}`, messagePayload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${bearerToken}`,
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://fraga.zapcontabil.chat',
        'Referer': 'https://fraga.zapcontabil.chat/',
      },
    });

    const httpStatus = sendResponse.status;
    const providerResponse = sendResponse.data || {};
    const providerAck = httpStatus >= 200 && httpStatus < 300;

    logs.push(`📨 Response: HTTP ${httpStatus}`);
    logs.push(`✅ Envio concluído`);

    const latency = Date.now() - startTime;

    return res.json({
      ok: providerAck,
      httpStatus,
      ticketId,
      clientId,
      receivableId,
      correlationId,
      uploadEndpoint: uploadResult.endpoint,
      uploadHttpStatus: uploadResult.httpStatus,
      filename: uploadResult.filename,
      signedUrl,
      providerResponse,
      payloadHash,
      latencyMs: latency,
      logs,
    });
  } catch (err: any) {
    logs.push(`❌ Erro: ${err.message}`);
    const latency = Date.now() - startTime;
    return res.status(500).json({
      ok: false,
      error: 'SEND_FAILED',
      message: err.message,
      latencyMs: latency,
      logs,
    });
  }
});

export default router;
