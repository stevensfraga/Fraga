/**
 * Conta Azul API Client
 * Funções para buscar dados de receivables e PDFs do Conta Azul
 */

const CONTA_AZUL_BASE_URL = process.env.CONTA_AZUL_API_BASE || 'https://api.contaazul.com/v1';
const CONTA_AZUL_TOKEN = process.env.CONTA_AZUL_API_TOKEN || '';

interface ContaAzulReceivable {
  id: string;
  numero_documento: string;
  descricao: string;
  valor: number;
  data_vencimento: string;
  status: 'pendente' | 'pago' | 'cancelado';
}

/**
 * Buscar receivable no Conta Azul
 */
export async function fetchContaAzulReceivable(receivableId: number): Promise<ContaAzulReceivable | null> {
  try {
    console.log(`[Conta Azul] Buscando receivable ${receivableId}...`);

    const response = await fetch(`${CONTA_AZUL_BASE_URL}/receivables/${receivableId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CONTA_AZUL_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 404) {
      console.log(`[Conta Azul] Receivable ${receivableId} não encontrado`);
      return null;
    }

    if (response.status !== 200) {
      console.error(`[Conta Azul] Erro HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[Conta Azul] Receivable encontrado: ${data.numero_documento}`);

    return {
      id: data.id,
      numero_documento: data.numero_documento,
      descricao: data.descricao,
      valor: data.valor,
      data_vencimento: data.data_vencimento,
      status: data.status,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Conta Azul] Erro ao buscar receivable: ${errMsg}`);
    return null;
  }
}

/**
 * Baixar PDF do boleto do Conta Azul
 */
export async function downloadContaAzulPdf(receivableId: string): Promise<Buffer | null> {
  try {
    console.log(`[Conta Azul] Baixando PDF para receivable ${receivableId}...`);

    // Buscar token do banco
    let token = CONTA_AZUL_TOKEN;
    if (!token) {
      console.log(`[Conta Azul] Token não configurado em env, buscando do banco...`);
      try {
        const { getDb } = await import('./db');
        const { contaAzulTokens } = await import('../drizzle/schema');
        const db = await getDb();
        if (db) {
          const tokenRecord = await db.select().from(contaAzulTokens).limit(1);
          if (tokenRecord && tokenRecord.length > 0) {
            token = tokenRecord[0].accessToken;
            console.log(`[Conta Azul] Token obtido do banco`);
          }
        }
      } catch (err) {
        console.error(`[Conta Azul] Erro ao buscar token do banco:`, err);
      }
    }

    if (!token) {
      console.error(`[Conta Azul] Nenhum token disponível`);
      return null;
    }

    const response = await fetch(`${CONTA_AZUL_BASE_URL}/receivables/${receivableId}/pdf`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.status === 404) {
      console.log(`[Conta Azul] PDF não disponível para receivable ${receivableId}`);
      return null;
    }

    if (response.status === 401) {
      console.error(`[Conta Azul] Unauthorized (401) - Token expirado ou inválido`);
      return null;
    }

    if (response.status !== 200) {
      console.error(`[Conta Azul] Erro HTTP ${response.status} ao baixar PDF`);
      const text = await response.text();
      console.error(`[Conta Azul] Response:`, text.substring(0, 200));
      return null;
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/pdf')) {
      console.error(`[Conta Azul] Content-Type inválido: ${contentType}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    const pdfBuffer = Buffer.from(buffer);

    console.log(`[Conta Azul] PDF baixado - Tamanho: ${pdfBuffer.length} bytes`);
    
    // Validar tamanho mínimo
    if (pdfBuffer.length < 1000) {
      console.error(`[Conta Azul] PDF muito pequeno (${pdfBuffer.length} bytes < 1000 bytes)`);
      console.error(`[Conta Azul] Primeiros 200 bytes:`, pdfBuffer.toString('utf-8', 0, Math.min(200, pdfBuffer.length)));
      return null;
    }
    
    console.log(`[Conta Azul] ✅ PDF válido (${pdfBuffer.length} bytes)`);
    return pdfBuffer;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Conta Azul] Erro ao baixar PDF: ${errMsg}`);
    return null;
  }
}
