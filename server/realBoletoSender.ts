/**
 * Gerenciador para envio de boletos reais do Conta Azul
 * Busca boletos nativos (com bank_slip.url) e envia via WhatsApp
 */

import axios from 'axios';
import { sendWhatsAppMessage } from './zapContabilIntegration';
import { getValidAccessToken } from './contaAzulOAuthManager';

interface ContaAzulReceivable {
  id: string;
  customer: {
    id: string;
    name: string;
    phone?: string;
    mobile?: string;
    email?: string;
  };
  amount: number;
  due_date: string;
  bank_slip?: {
    url: string;
  };
  status: string;
  boleto_url: string;
  message: string;
}

/**
 * Buscar boletos reais do Conta Azul com bank_slip.url
 */
export async function buscarBoletosReaisContaAzul(): Promise<ContaAzulReceivable[]> {
  try {
    console.log('\n' + '='.repeat(70));
    console.log('[BOLETO REAL] INICIANDO BUSCA DE BOLETOS');
    console.log('='.repeat(70));

    // PASSO 1: Obter token
    console.log('\n[PASSO 1] Obtendo access token...');
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      console.error('[ERRO] Token invalido ou expirado');
      throw new Error('Nao foi possivel obter access token valido');
    }
    console.log('[OK] Token obtido com sucesso');
    console.log(`[TOKEN] Primeiros 20 caracteres: ${accessToken.substring(0, 20)}...`);

    // PASSO 2: Obter company_id
    console.log('\n[PASSO 2] Obtendo company_id...');
    let companyId = null;
    try {
      const companyResponse = await axios.get('https://api.contaazul.com/v1/companies', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-ContaAzul-Api-Version': '2023-01-01',
        },
      });

      console.log(`[RESPOSTA] Status HTTP: ${companyResponse.status}`);
      console.log(`[RESPOSTA] Dados brutos:`);
      console.log(JSON.stringify(companyResponse.data, null, 2));

      const companies = companyResponse.data.items || companyResponse.data || [];
      if (companies.length === 0) {
        console.warn('[AVISO] Nenhuma empresa encontrada');
        companyId = null;
      } else {
        companyId = companies[0].id;
        console.log(`[OK] Company ID obtido: ${companyId}`);
      }
    } catch (error: any) {
      console.error('[ERRO] Ao obter company_id:', error.message);
      companyId = null;
    }

    // PASSO 3: Testar receivables com OPEN
    console.log('\n[PASSO 3] Testando /v1/financial/receivables com status=OPEN');
    let receivablesOpen = [];
    try {
      const url = 'https://api.contaazul.com/v1/financial/receivables';
      const params = {
        status: 'OPEN',
        include: 'bank_slip,customer',
      };

      console.log(`[URL] ${url}`);
      console.log(`[PARAMS] ${JSON.stringify(params)}`);

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'X-ContaAzul-Api-Version': '2023-01-01',
        'X-ContaAzul-Company-Id': companyId || '',
        'Content-Type': 'application/json',
      };

      console.log(`[HEADERS] Authorization: Bearer ${accessToken.substring(0, 20)}...`);
      console.log(`[HEADERS] X-ContaAzul-Company-Id: ${companyId || 'NAO DEFINIDO'}`);

      const response = await axios.get(url, { headers, params });

      console.log(`[RESPOSTA] Status HTTP: ${response.status}`);
      console.log(`[RESPOSTA] Dados brutos:`);
      console.log(JSON.stringify(response.data, null, 2));

      receivablesOpen = response.data.items || response.data.data || [];
      console.log(`[OK] Total encontrado: ${receivablesOpen.length}`);
    } catch (error: any) {
      console.error('[ERRO] Ao consultar receivables OPEN:', error.message);
      if (error.response) {
        console.error(`[ERRO] Status HTTP: ${error.response.status}`);
        console.error(`[ERRO] Resposta:`, JSON.stringify(error.response.data, null, 2));
      }
    }

    // PASSO 4: Testar receivables com OPEN,OVERDUE
    console.log('\n[PASSO 4] Testando /v1/financial/receivables com status=OPEN,OVERDUE');
    let receivablesOpenOverdue = [];
    try {
      const url = 'https://api.contaazul.com/v1/financial/receivables';
      const params = {
        status: 'OPEN,OVERDUE',
        include: 'bank_slip,customer',
      };

      console.log(`[URL] ${url}`);
      console.log(`[PARAMS] ${JSON.stringify(params)}`);

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'X-ContaAzul-Api-Version': '2023-01-01',
        'X-ContaAzul-Company-Id': companyId || '',
        'Content-Type': 'application/json',
      };

      const response = await axios.get(url, { headers, params });

      console.log(`[RESPOSTA] Status HTTP: ${response.status}`);
      console.log(`[RESPOSTA] Dados brutos:`);
      console.log(JSON.stringify(response.data, null, 2));

      receivablesOpenOverdue = response.data.items || response.data.data || [];
      console.log(`[OK] Total encontrado: ${receivablesOpenOverdue.length}`);
    } catch (error: any) {
      console.error('[ERRO] Ao consultar receivables OPEN,OVERDUE:', error.message);
    }

    // PASSO 5: Testar charges
    console.log('\n[PASSO 5] Testando /v1/financial/charges');
    let charges = [];
    try {
      const url = 'https://api.contaazul.com/v1/financial/charges';
      const params = {
        include: 'bank_slip,customer',
      };

      console.log(`[URL] ${url}`);
      console.log(`[PARAMS] ${JSON.stringify(params)}`);

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'X-ContaAzul-Api-Version': '2023-01-01',
        'X-ContaAzul-Company-Id': companyId || '',
        'Content-Type': 'application/json',
      };

      const response = await axios.get(url, { headers, params });

      console.log(`[RESPOSTA] Status HTTP: ${response.status}`);
      console.log(`[RESPOSTA] Dados brutos:`);
      console.log(JSON.stringify(response.data, null, 2));

      charges = response.data.items || response.data.data || [];
      console.log(`[OK] Total encontrado: ${charges.length}`);
    } catch (error: any) {
      console.error('[ERRO] Ao consultar charges:', error.message);
    }

    // PASSO 6: Testar invoices
    console.log('\n[PASSO 6] Testando /v1/sales/invoices');
    let invoices = [];
    try {
      const url = 'https://api.contaazul.com/v1/sales/invoices';
      const params = {
        include: 'bank_slip,customer',
      };

      console.log(`[URL] ${url}`);
      console.log(`[PARAMS] ${JSON.stringify(params)}`);

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'X-ContaAzul-Api-Version': '2023-01-01',
        'X-ContaAzul-Company-Id': companyId || '',
        'Content-Type': 'application/json',
      };

      const response = await axios.get(url, { headers, params });

      console.log(`[RESPOSTA] Status HTTP: ${response.status}`);
      console.log(`[RESPOSTA] Dados brutos:`);
      console.log(JSON.stringify(response.data, null, 2));

      invoices = response.data.items || response.data.data || [];
      console.log(`[OK] Total encontrado: ${invoices.length}`);
    } catch (error: any) {
      console.error('[ERRO] Ao consultar invoices:', error.message);
    }

    // PASSO 7: Consolidar resultados
    console.log('\n[PASSO 7] Consolidando resultados...');
    let todosBoletos = [...receivablesOpen, ...receivablesOpenOverdue, ...charges, ...invoices];

    console.log(`[RESUMO] Total de boletos encontrados: ${todosBoletos.length}`);
    console.log(`  - Receivables OPEN: ${receivablesOpen.length}`);
    console.log(`  - Receivables OPEN,OVERDUE: ${receivablesOpenOverdue.length}`);
    console.log(`  - Charges: ${charges.length}`);
    console.log(`  - Invoices: ${invoices.length}`);

    // PASSO 8: Filtrar apenas boletos com bank_slip.url
    console.log('\n[PASSO 8] Filtrando boletos com bank_slip.url...');
    const boletosComUrl = todosBoletos.filter(
      (b: ContaAzulReceivable) => b.bank_slip?.url
    );

    console.log(`[OK] Total com boleto nativo: ${boletosComUrl.length}`);

    if (boletosComUrl.length === 0) {
      console.warn('[AVISO] Nenhum boleto com bank_slip.url encontrado');
      console.warn('[AVISO] Verifique se os titulos foram emitidos via Conta Azul Pay');
    }

    console.log('\n' + '='.repeat(70));
    console.log('[BOLETO REAL] BUSCA CONCLUIDA');
    console.log('='.repeat(70) + '\n');

    return boletosComUrl;
  } catch (error: any) {
    console.error('\n' + '='.repeat(70));
    console.error('[ERRO] Erro geral ao buscar boletos:', error.message);
    console.error('='.repeat(70) + '\n');
    return [];
  }
}

/**
 * Enviar boleto real via WhatsApp
 */
export async function enviarBoletoRealWhatsApp(
  boleto: ContaAzulReceivable
): Promise<boolean> {
  try {
    const telefone = boleto.customer.mobile || boleto.customer.phone;
    if (!telefone) {
      console.warn('[BOLETO REAL] Telefone do cliente nao encontrado');
      return false;
    }

    const mensagem = `
Ola ${boleto.customer.name},

Segue o boleto oficial do Conta Azul:
${boleto.bank_slip?.url}

Valor: R$ ${(boleto.amount / 100).toFixed(2)}
Vencimento: ${boleto.due_date}

Agradecemos!
    `.trim();

    const resultado = await sendWhatsAppMessage({
      phone: telefone,
      message: mensagem,
      clientName: boleto.customer.name,
      clientId: boleto.customer.id,
      forceSend: true,
    });

    if (resultado.success) {
      console.log(`[BOLETO REAL] Boleto enviado com sucesso para ${telefone}`);
      return true;
    } else {
      console.error(`[BOLETO REAL] Erro ao enviar boleto: ${resultado.error}`);
      return false;
    }
  } catch (error: any) {
    console.error('[BOLETO REAL] Erro ao enviar boleto:', error.message);
    return false;
  }
}

/**
 * Processar todos os boletos reais
 */
export async function processarTodosBoletoReais(): Promise<{
  total: number;
  enviados: number;
  erros: number;
}> {
  try {
    const boletos = await buscarBoletosReaisContaAzul();

    let enviados = 0;
    let erros = 0;

    for (const boleto of boletos) {
      const sucesso = await enviarBoletoRealWhatsApp(boleto);
      if (sucesso) {
        enviados++;
      } else {
        erros++;
      }
    }

    return {
      total: boletos.length,
      enviados,
      erros,
    };
  } catch (error: any) {
    console.error('[BOLETO REAL] Erro ao processar boletos:', error.message);
    return {
      total: 0,
      enviados: 0,
      erros: 1,
    };
  }
}
