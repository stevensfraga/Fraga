/**
 * Auto-Close Cobrança Tickets Job
 *
 * Roda a cada minuto e fecha automaticamente tickets do setor Cobrança
 * que ficaram sem resposta humana por mais de 5 minutos.
 *
 * Critérios para fechar:
 *   - Ticket no setor Cobrança (queueId = COBRANCA_QUEUE_ID)
 *   - Status "pending" (sem atendente atribuído)
 *   - Criado há mais de AUTO_CLOSE_MINUTES minutos
 *
 * Env vars:
 *   COBRANCA_QUEUE_ID=13
 *   AUTO_CLOSE_COBRANCA_MINUTES=5  (padrão: 5)
 *   AUTO_CLOSE_COBRANCA_ENABLED=true
 */

import axios from 'axios';

const ZAP_API_URL = process.env.ZAP_CONTABIL_API_URL || 'https://api-fraga.zapcontabil.chat';
const ZAP_API_KEY = process.env.ZAP_CONTABIL_API_KEY || process.env.WHATSAPP_API_KEY || '';
const COBRANCA_QUEUE_ID = parseInt(process.env.COBRANCA_QUEUE_ID || '13', 10);
const AUTO_CLOSE_MINUTES = parseInt(process.env.AUTO_CLOSE_COBRANCA_MINUTES || '5', 10);

function isEnabled() {
  return process.env.AUTO_CLOSE_COBRANCA_ENABLED === 'true';
}

/**
 * Busca tickets pendentes no setor Cobrança
 */
async function fetchPendingCobrancaTickets(): Promise<any[]> {
  const res = await axios.get(
    `${ZAP_API_URL}/api/tickets?status=pending&queueId=${COBRANCA_QUEUE_ID}&limit=50`,
    {
      headers: { Authorization: `Bearer ${ZAP_API_KEY}` },
      timeout: 10000,
    }
  );
  const data = res.data?.tickets || res.data?.data || res.data || [];
  return Array.isArray(data) ? data : [];
}

/**
 * Fecha um ticket via PUT
 */
async function closeTicket(ticketId: number): Promise<void> {
  await axios.put(
    `${ZAP_API_URL}/api/tickets/${ticketId}`,
    { status: 'closed' },
    {
      headers: { Authorization: `Bearer ${ZAP_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 8000,
    }
  );
}

/**
 * Executa o job de auto-fechamento
 */
export async function runAutoCloseCobrancaTickets(): Promise<{ closed: number; checked: number }> {
  if (!ZAP_API_KEY) {
    console.warn('[AutoClose] ⚠️ ZAP_CONTABIL_API_KEY não configurada — job ignorado');
    return { closed: 0, checked: 0 };
  }

  if (!isEnabled()) {
    return { closed: 0, checked: 0 };
  }

  let closed = 0;
  let checked = 0;

  try {
    const tickets = await fetchPendingCobrancaTickets();
    checked = tickets.length;

    const now = Date.now();
    const cutoffMs = AUTO_CLOSE_MINUTES * 60 * 1000;

    for (const ticket of tickets) {
      const ticketId = ticket.id;
      const createdAt = new Date(ticket.createdAt || ticket.created_at).getTime();
      const ageMs = now - createdAt;

      // Só fechar se estiver sem atendente (userId null) e mais velho que o limite
      const hasAgent = !!(ticket.userId || ticket.user_id);
      if (hasAgent) continue;

      if (ageMs < cutoffMs) continue;

      const ageMin = Math.round(ageMs / 60000);
      console.log(`[AutoClose] 🔒 Fechando ticket #${ticketId} — sem resposta por ${ageMin} min`);

      try {
        await closeTicket(ticketId);
        closed++;
        console.log(`[AutoClose] ✅ Ticket #${ticketId} fechado automaticamente`);
      } catch (err: any) {
        console.error(`[AutoClose] ❌ Erro ao fechar ticket #${ticketId}:`, err.message);
      }
    }

    if (closed > 0) {
      console.log(`[AutoClose] 📊 Resumo: ${closed} fechado(s) de ${checked} verificado(s)`);
    }
  } catch (err: any) {
    console.error('[AutoClose] ❌ Erro ao buscar tickets Cobrança:', err.message);
  }

  return { closed, checked };
}
