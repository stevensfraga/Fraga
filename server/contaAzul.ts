import axios from "axios";

const CONTA_AZUL_API_BASE = "https://api-v2.contaazul.com";
const API_TOKEN = process.env.CONTA_AZUL_API_TOKEN;

/**
 * Criar cliente HTTP autenticado com JWT token
 */
function getAuthenticatedClient() {
  return axios.create({
    baseURL: CONTA_AZUL_API_BASE,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });
}

/**
 * Buscar clientes
 */
export async function fetchClients() {
  try {
    const client = getAuthenticatedClient();
    const response = await client.get("/clientes", {
      params: {
        limit: 100,
      },
    });

    return response.data.data || [];
  } catch (error) {
    console.error("Error fetching clients from Conta Azul:", error);
    throw error;
  }
}

/**
 * Buscar contas a receber
 */
export async function fetchReceivables() {
  try {
    const client = getAuthenticatedClient();
    const response = await client.get("/contas-receber", {
      params: {
        limit: 100,
      },
    });

    return response.data.data || [];
  } catch (error) {
    console.error("Error fetching receivables from Conta Azul:", error);
    throw error;
  }
}

/**
 * Buscar contas a receber em atraso
 */
export async function fetchOverdueReceivables() {
  try {
    const client = getAuthenticatedClient();
    const response = await client.get("/contas-receber", {
      params: {
        status: "vencida",
        limit: 100,
      },
    });

    return response.data.data || [];
  } catch (error) {
    console.error("Error fetching overdue receivables from Conta Azul:", error);
    throw error;
  }
}

/**
 * Calcular dias de atraso
 */
export function calculateDaysOverdue(dueDate: Date): number {
  const now = new Date();
  const due = new Date(dueDate);
  const diffTime = Math.abs(now.getTime() - due.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Calcular meses em atraso
 */
export function calculateMonthsOverdue(dueDate: Date): number {
  const now = new Date();
  const due = new Date(dueDate);

  let months = 0;
  let current = new Date(due);

  while (current < now) {
    current.setMonth(current.getMonth() + 1);
    months++;
  }

  return Math.max(months, 0);
}

/**
 * Classificar cliente por faixa de atraso
 */
export function classifyByOverdueRange(
  daysOverdue: number
): "friendly" | "administrative" | "formal" {
  if (daysOverdue <= 30) return "friendly";
  if (daysOverdue <= 90) return "administrative";
  return "formal";
}

/**
 * Sincronizar clientes do Conta Azul com o banco local
 */
export async function syncClientsFromContaAzul() {
  try {
    const clients = await fetchClients();
    const receivables = await fetchOverdueReceivables();

    const syncedClients = [];
    const syncedReceivables = [];

    // Mapear clientes
    for (const client of clients) {
      syncedClients.push({
        contaAzulId: client.id,
        name: client.nome || client.name,
        email: client.email,
        phone: client.telefone || client.phone,
        whatsappNumber: client.telefone || client.phone,
        cnae: client.cnae,
        status: "active" as const,
      });
    }

    // Mapear contas a receber
    for (const receivable of receivables) {
      const dueDate = new Date(receivable.data_vencimento || receivable.dueDate);
      const daysOverdue = calculateDaysOverdue(dueDate);
      const monthsOverdue = calculateMonthsOverdue(dueDate);

      syncedReceivables.push({
        contaAzulId: receivable.id,
        clientId: receivable.cliente_id || receivable.customerId,
        amount: receivable.valor || receivable.amount,
        dueDate,
        status: "overdue" as const,
        monthsOverdue,
        daysOverdue,
        description: receivable.descricao || receivable.description,
      });
    }

    return {
      clients: syncedClients,
      receivables: syncedReceivables,
    };
  } catch (error) {
    console.error("Error syncing clients from Conta Azul:", error);
    throw error;
  }
}
