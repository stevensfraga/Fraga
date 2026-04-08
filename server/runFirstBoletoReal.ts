/**
 * runFirstBoletoReal()
 * Dispara automaticamente o primeiro boleto real de todos os clientes OPEN/OVERDUE
 * Fluxo completo: Busca → Mensagem → Envio → Auditoria → Retry
 */

import { getDb } from './db';
import { collectionMessages, receivables, clients } from '../drizzle/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { formatarMensagemCobranca } from './r7GeradorasCollectionManager';
import { sendWhatsAppMessage } from './zapContabilIntegration';

/**
 * FUNÇÃO PRINCIPAL: runFirstBoletoReal()
 * Executa o fluxo completo de envio do primeiro boleto real
 */
export async function runFirstBoletoReal() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 INICIANDO: runFirstBoletoReal()');
  console.log('='.repeat(60) + '\n');
  
  try {
    // Fase 1: Validar OAuth
    console.log('[runFirstBoletoReal] 🔐 Validando OAuth Conta Azul...');
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.error('[runFirstBoletoReal] ❌ Credenciais OAuth não definidas');
      return { sucesso: false, erro: 'Credenciais OAuth não definidas' };
    }
    console.log('[runFirstBoletoReal] ✅ Credenciais OAuth válidas');
    
    // Fase 2: Buscar boleto
    console.log('[runFirstBoletoReal] 🔍 Buscando primeiro boleto OPEN/OVERDUE...');
    const db = await getDb();
    if (!db) {
      console.error('[runFirstBoletoReal] ❌ Banco de dados não disponível');
      return { sucesso: false, erro: 'Banco de dados não disponível' };
    }
    
    const boletosResult = await db
      .select({
        id: receivables.id,
        clientId: receivables.clientId,
        amount: receivables.amount,
        dueDate: receivables.dueDate,
        status: receivables.status,
        clientName: clients.name,
        whatsappNumber: clients.whatsappNumber,
      })
      .from(receivables)
      .innerJoin(clients, eq(receivables.clientId, clients.id))
      .where(
        and(
          inArray(receivables.status, ['pending', 'overdue']),
          eq(clients.name, 'R7 GERADORES LTDA')
        )
      )
      .limit(1);
    
    if (boletosResult.length === 0) {
      console.warn('[runFirstBoletoReal] ⚠️ Nenhum boleto encontrado');
      return { sucesso: false, erro: 'Nenhum boleto encontrado', total: 0 };
    }
    
    const boleto = boletosResult[0];
    console.log(`[runFirstBoletoReal] ✅ Boleto encontrado: ${boleto.clientName}`);
    
    // Fase 3: Gerar mensagem
    console.log('[runFirstBoletoReal] 📝 Gerando mensagem personalizada...');
    const mensagem = formatarMensagemCobranca({
      id: boleto.id.toString(),
      customer_id: boleto.clientId.toString(),
      due_date: boleto.dueDate.toISOString(),
      amount: Number(boleto.amount) * 100, // Converter para centavos
      status: boleto.status,
      clientName: boleto.clientName || '',
      whatsappNumber: boleto.whatsappNumber || '',
    });
    console.log('[runFirstBoletoReal] ✅ Mensagem gerada com sucesso');
    
    // Fase 4: Enviar com retry exponencial
    console.log(`[runFirstBoletoReal] 📱 Enviando via WhatsApp (${boleto.whatsappNumber})...`);
    const delays = [1000, 2000, 4000, 8000];
    let enviado = false;
    let tentativas = 0;
    let ultimoErro = '';
    
    for (let i = 0; i < delays.length; i++) {
      tentativas++;
      try {
        console.log(`[runFirstBoletoReal] Tentativa ${tentativas}/${delays.length}...`);
        
        if (boleto.whatsappNumber) {
          const resultado = await sendWhatsAppMessage({
            phone: boleto.whatsappNumber,
            message: mensagem,
            clientName: boleto.clientName || '',
            clientId: boleto.id.toString(),
            forceSend: true,
          });
          if (resultado.success) {
            console.log(`[runFirstBoletoReal] ✅ Mensagem enviada com sucesso`);
            enviado = true;
            break;
          }
        }
        
        if (i < delays.length - 1) {
          console.log(`[runFirstBoletoReal] ⏳ Aguardando ${delays[i]}ms antes de retry...`);
          await new Promise(resolve => setTimeout(resolve, delays[i]));
        }
      } catch (error: any) {
        ultimoErro = error.message;
        console.error(`[runFirstBoletoReal] ❌ Erro na tentativa ${tentativas}:`, ultimoErro);
        
        if (i < delays.length - 1) {
          console.log(`[runFirstBoletoReal] ⏳ Aguardando ${delays[i]}ms antes de retry...`);
          await new Promise(resolve => setTimeout(resolve, delays[i]));
        }
      }
    }
    
    // Fase 5: Registrar auditoria
    console.log('[runFirstBoletoReal] 📊 Registrando auditoria...');
    const statusEnvio = enviado ? 'sent' : 'failed';
    
    await db.insert(collectionMessages).values({
      cnpj: '21918918000194',
      clientId: boleto.clientId,
      messageType: 'friendly',
      messageTemplate: mensagem,
      messageSent: enviado ? 'true' : 'false',
      status: statusEnvio as any,
      sentAt: new Date(),
    });
    
    console.log('[runFirstBoletoReal] ✅ Auditoria registrada com sucesso');
    
    // Resumo final
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO FINAL:');
    console.log('='.repeat(60));
    console.log(`✅ Cliente: ${boleto.clientName}`);
    console.log(`💰 Valor: R$ ${Number(boleto.amount).toFixed(2)}`);
    console.log(`📱 Telefone: ${boleto.whatsappNumber}`);
    console.log(`📤 Status: ${enviado ? 'SUCESSO' : 'FALHA'}`);
    console.log(`🔄 Tentativas: ${tentativas}`);
    if (ultimoErro) {
      console.log(`❌ Erro: ${ultimoErro}`);
    }
    console.log('='.repeat(60) + '\n');
    
    return {
      sucesso: enviado,
      boletoId: boleto.id,
      clientName: boleto.clientName,
      valor: Number(boleto.amount),
      telefone: boleto.whatsappNumber,
      statusEnvio,
      tentativas,
      erro: ultimoErro || undefined,
    };
  } catch (error: any) {
    console.error('[runFirstBoletoReal] ❌ Erro geral:', error);
    return { sucesso: false, erro: error.message };
  }
}

export default runFirstBoletoReal;
