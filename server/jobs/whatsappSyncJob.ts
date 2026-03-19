import { getDb } from '../db';
import { clients } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import axios from 'axios';
import { sql } from 'drizzle-orm';

/**
 * WhatsApp Sync Job
 * Sincroniza números de WhatsApp com Conta Azul
 * Marca como 'conta-azul' apenas números confirmados na API oficial
 */

export async function syncWhatsappWithContaAzul() {
  
  try {
    console.log('[WhatsappSync] Iniciando sincronização com Conta Azul...');
    
    // 1. Buscar token de acesso válido
    const token = process.env.CONTA_AZUL_API_TOKEN;
    if (!token) {
      console.error('[WhatsappSync] ERRO: Token Conta Azul não configurado');
      return { success: false, error: 'MISSING_TOKEN' };
    }

    // 2. Buscar todos os clientes com whatsappNumber preenchido
    const db_instance = await getDb();
    if (!db_instance) {
      console.error('[WhatsappSync] ERRO: Database connection failed');
      return { success: false, error: 'DB_CONNECTION_FAILED' };
    }

    // Buscar clientes com WhatsApp
    const allClients = await db_instance
      .select()
      .from(clients);
    
    const clientsWithPhone = allClients.filter(
      c => c.whatsappNumber && String(c.whatsappNumber).trim().length > 0
    );

    console.log(`[WhatsappSync] Encontrados ${clientsWithPhone.length} clientes com WhatsApp`);

    let validatedCount = 0;
    let notConfirmedCount = 0;
    const results = [];

    // 3. Para cada cliente, validar com Conta Azul
    for (const client of clientsWithPhone) {
      try {
        // Buscar dados do cliente no Conta Azul
        const caResponse = await axios.get(
          `${process.env.CONTA_AZUL_API_BASE}/customers/${client.contaAzulId}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        );

        const caCustomer = caResponse.data?.data;
        if (!caCustomer) {
          console.warn(`[WhatsappSync] NAO_CONFIRMADO - clientId=${client.id}, contaAzulId=${client.contaAzulId}, motivo=cliente_nao_encontrado`);
          notConfirmedCount++;
          results.push({
            clientId: client.id,
            status: 'not_confirmed',
            reason: 'customer_not_found',
          });
          continue;
        }

        // Extrair telefone celular do Conta Azul
        const caPhone = caCustomer.mobilePhone || caCustomer.phone;
        if (!caPhone) {
          console.warn(`[WhatsappSync] NAO_CONFIRMADO - clientId=${client.id}, motivo=sem_telefone_ca`);
          notConfirmedCount++;
          results.push({
            clientId: client.id,
            status: 'not_confirmed',
            reason: 'no_phone_in_conta_azul',
          });
          continue;
        }

        // Normalizar telefone (remover caracteres especiais)
        const normalizedCAPhone = caPhone.replace(/\D/g, '');
        const normalizedClientPhone = String(client.whatsappNumber).replace(/\D/g, '');

        // Comparar telefones
        if (normalizedCAPhone === normalizedClientPhone) {
          // ✅ VALIDADO: Número existe no Conta Azul
          if (db_instance) {
            await db_instance
              .update(clients)
              .set({
                whatsappSource: 'conta-azul',
                updatedAt: new Date(),
              })
              .where(eq(clients.id, client.id));
          }

          console.log(`[WhatsappSync] VALIDADO_CONTA_AZUL - clientId=${client.id}, phone=${client.whatsappNumber}`);
          validatedCount++;
          results.push({
            clientId: client.id,
            status: 'validated',
            whatsappNumber: client.whatsappNumber,
          });
        } else {
          // ❌ NÃO CONFIRMADO: Número não bate com Conta Azul
          console.warn(`[WhatsappSync] NAO_CONFIRMADO - clientId=${client.id}, local=${normalizedClientPhone}, ca=${normalizedCAPhone}`);
          notConfirmedCount++;
          results.push({
            clientId: client.id,
            status: 'not_confirmed',
            reason: 'phone_mismatch',
            localPhone: client.whatsappNumber,
            contaAzulPhone: caPhone,
          });
        }
      } catch (error: any) {
        console.error(`[WhatsappSync] ERRO ao sincronizar clientId=${client.id}:`, error.message);
        results.push({
          clientId: client.id,
          status: 'error',
          error: error.message,
        });
      }
    }

    console.log(`[WhatsappSync] CONCLUÍDO - validados=${validatedCount}, nao_confirmados=${notConfirmedCount}`);

    return {
      success: true,
      validatedCount,
      notConfirmedCount,
      results,
    };
  } catch (error: any) {
    console.error('[WhatsappSync] ERRO CRÍTICO:', error.message);
    return { success: false, error: error.message };
  }
}


