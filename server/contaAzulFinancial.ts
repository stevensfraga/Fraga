/**
 * Integração com API Conta Azul para dados financeiros
 * Busca receita, despesa e resultado dos últimos 6 meses
 */

import axios from "axios";

interface FinancialMonth {
  month: string;
  receita: number;
  receitaRecorrente: number;
  receitaEventual: number;
  despesa: number;
  despesaPessoal: number;
  despesaSistemas: number;
  despesaAdministrativa: number;
  despesaImpostos: number;
  resultado: number;
}

/**
 * Buscar dados financeiros de um mês específico
 */
export async function fetchMonthlyFinancialData(monthString: string): Promise<FinancialMonth | null> {
  try {
    const apiUrl = process.env.CONTA_AZUL_API_URL || "https://api.contaazul.com";
    const token = process.env.CONTA_AZUL_API_TOKEN;

    if (!token) {
      console.warn("[ContaAzul Financial] Token não configurado");
      return null;
    }

    // Formato: YYYY-MM
    const [year, month] = monthString.split("-");
    const startDate = `${year}-${month}-01`;
    const endDate = `${year}-${month}-31`;

    console.log(`[ContaAzul Financial] Buscando dados de ${monthString}...`);

    // Buscar receitas (contas a receber)
    const receitasResponse = await axios.get(`${apiUrl}/v1/receivables`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        filters: {
          status: "open,partially_paid,paid",
          dueDate: {
            start: startDate,
            end: endDate,
          },
        },
      },
      timeout: 10000,
    });

    // Buscar despesas (contas a pagar)
    const despesasResponse = await axios.get(`${apiUrl}/v1/payables`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        filters: {
          status: "open,partially_paid,paid",
          dueDate: {
            start: startDate,
            end: endDate,
          },
        },
      },
      timeout: 10000,
    });

    // Processar receitas
    const receitas = receitasResponse.data?.data || [];
    const totalReceita = receitas.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);
    const receitaRecorrente = totalReceita * 0.75; // Estimativa: 75% recorrente
    const receitaEventual = totalReceita * 0.25; // Estimativa: 25% eventual

    // Processar despesas
    const despesas = despesasResponse.data?.data || [];
    const totalDespesa = despesas.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);
    const despesaPessoal = totalDespesa * 0.5; // Estimativa: 50% pessoal
    const despesaSistemas = totalDespesa * 0.1; // Estimativa: 10% sistemas
    const despesaAdministrativa = totalDespesa * 0.25; // Estimativa: 25% administrativa
    const despesaImpostos = totalDespesa * 0.15; // Estimativa: 15% impostos

    const resultado = totalReceita - totalDespesa;

    const monthName = new Date(`${monthString}-01`).toLocaleString("pt-BR", { month: "short" });

    return {
      month: monthName,
      receita: totalReceita,
      receitaRecorrente,
      receitaEventual,
      despesa: totalDespesa,
      despesaPessoal,
      despesaSistemas,
      despesaAdministrativa,
      despesaImpostos,
      resultado,
    };
  } catch (error: any) {
    console.error(`[ContaAzul Financial] Erro ao buscar dados de ${monthString}:`, error.message);
    return null;
  }
}

/**
 * Buscar dados financeiros dos últimos 6 meses
 */
export async function fetchLast6MonthsFinancialData(): Promise<FinancialMonth[]> {
  try {
    const months: FinancialMonth[] = [];
    const now = new Date();

    // Buscar últimos 6 meses
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const monthString = `${year}-${month}`;

      const data = await fetchMonthlyFinancialData(monthString);
      if (data) {
        months.push(data);
      }
    }

    console.log(`[ContaAzul Financial] ✅ Dados de ${months.length} meses obtidos`);
    return months;
  } catch (error: any) {
    console.error("[ContaAzul Financial] Erro ao buscar últimos 6 meses:", error.message);
    return [];
  }
}
