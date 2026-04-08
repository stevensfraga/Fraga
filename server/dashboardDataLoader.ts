/**
 * Carrega dados do arquivo dashboard-data.json
 * e extrai informações de clientes em atraso
 */

export interface DashboardData {
  dre_2024: {
    months: string[];
    revenue: number[];
    net_profit: number[];
  };
  dre_2025: {
    months: string[];
    revenue: number[];
    net_profit: number[];
  };
  total_clients: number;
  active_clients: number;
  bank_balance: number;
  total_overdue: number;
  cnae_distribution: Array<Record<string, any>>;
  recebimento_data: Array<Record<string, any>>;
  pagamento_data: Array<Record<string, any>>;
  generated_at: string;
}

/**
 * Gera clientes fictícios em atraso baseado nos dados do dashboard
 */
export function generateOverdueClientsFromDashboard(data: DashboardData) {
  const clients = [];
  
  // Usar CNAE distribution para gerar nomes de clientes
  const cnaes = data.cnae_distribution || [];
  
  // Gerar 8 clientes baseado nos dados
  const clientNames = [
    "Empresa ABC Ltda",
    "Consultoria XYZ",
    "Loja de Roupas Premium",
    "Restaurante da Cidade",
    "Agência de Publicidade Digital",
    "Distribuidora de Alimentos",
    "Indústria de Plásticos",
    "Transportadora Regional",
  ];

  const amounts = [2500, 1800, 3200, 5500, 4200, 8900, 12500, 6800];
  const daysOverdue = [15, 8, 22, 45, 60, 75, 120, 150];

  for (let i = 0; i < clientNames.length; i++) {
    const cnae = cnaes[i % cnaes.length] || {};
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - daysOverdue[i]);

    clients.push({
      id: `client-${i + 1}`,
      name: clientNames[i],
      email: `contato@${clientNames[i].toLowerCase().replace(/\s+/g, "")}.com.br`,
      phone: `${11 + i}9${Math.random().toString().slice(2, 10)}`,
      whatsappNumber: `${11 + i}9${Math.random().toString().slice(2, 10)}`,
      cnae: Object.values(cnae)[0]?.toString() || "6202-3/00",
      status: "active" as const,
      totalOverdue: amounts[i],
      daysOverdue: daysOverdue[i],
      monthsOverdue: Math.floor(daysOverdue[i] / 30),
      receivables: [
        {
          id: `rec-${i + 1}`,
          amount: amounts[i],
          dueDate,
          description: `Serviço de consultoria - ${new Date(dueDate).toLocaleDateString("pt-BR")}`,
          daysOverdue: daysOverdue[i],
          monthsOverdue: Math.floor(daysOverdue[i] / 30),
          status: "overdue" as const,
        },
      ],
    });
  }

  return clients;
}

/**
 * Calcula estatísticas de cobrança
 */
export function calculateCollectionStats(clients: any[]) {
  const friendly = clients.filter((c) => c.daysOverdue <= 30);
  const administrative = clients.filter((c) => c.daysOverdue > 30 && c.daysOverdue <= 90);
  const formal = clients.filter((c) => c.daysOverdue > 90);

  const totalOverdue = clients.reduce((sum, c) => sum + c.totalOverdue, 0);

  return {
    totalClients: clients.length,
    totalOverdue,
    byRange: {
      friendly: {
        count: friendly.length,
        total: friendly.reduce((sum, c) => sum + c.totalOverdue, 0),
      },
      administrative: {
        count: administrative.length,
        total: administrative.reduce((sum, c) => sum + c.totalOverdue, 0),
      },
      formal: {
        count: formal.length,
        total: formal.reduce((sum, c) => sum + c.totalOverdue, 0),
      },
    },
  };
}
