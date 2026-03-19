/**
 * Dados de demonstração para o dashboard de cobrança
 * Simula clientes reais em atraso para fins de teste
 */

export const mockOverdueClients = [
  // Faixa Amigável (0-30 dias)
  {
    id: "client-001",
    name: "Empresa ABC Ltda",
    email: "contato@empresaabc.com.br",
    phone: "11987654321",
    whatsappNumber: "11987654321",
    cnae: "6202-3/00",
    status: "active" as const,
    receivables: [
      {
        id: "rec-001",
        amount: 2500.00,
        dueDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 dias atrás
        description: "Serviço de consultoria - Janeiro",
        daysOverdue: 15,
        monthsOverdue: 0,
        status: "overdue" as const,
      },
    ],
  },
  {
    id: "client-002",
    name: "Consultoria XYZ",
    email: "financeiro@consultoriaxyz.com.br",
    phone: "21988776655",
    whatsappNumber: "21988776655",
    cnae: "6920-9/00",
    status: "active" as const,
    receivables: [
      {
        id: "rec-002",
        amount: 1800.00,
        dueDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 dias atrás
        description: "Auditoria contábil",
        daysOverdue: 8,
        monthsOverdue: 0,
        status: "overdue" as const,
      },
    ],
  },
  {
    id: "client-003",
    name: "Loja de Roupas Premium",
    email: "vendas@roupaspremium.com.br",
    phone: "85999887766",
    whatsappNumber: "85999887766",
    cnae: "4711-3/01",
    status: "active" as const,
    receivables: [
      {
        id: "rec-003",
        amount: 3200.00,
        dueDate: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000), // 22 dias atrás
        description: "Fornecimento de produtos - Fevereiro",
        daysOverdue: 22,
        monthsOverdue: 0,
        status: "overdue" as const,
      },
    ],
  },

  // Faixa Administrativa (31-90 dias)
  {
    id: "client-004",
    name: "Restaurante da Cidade",
    email: "gerente@restaurantedacidade.com.br",
    phone: "31987654321",
    whatsappNumber: "31987654321",
    cnae: "5611-2/01",
    status: "active" as const,
    receivables: [
      {
        id: "rec-004",
        amount: 5500.00,
        dueDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 dias atrás
        description: "Consultoria de gestão",
        daysOverdue: 45,
        monthsOverdue: 1,
        status: "overdue" as const,
      },
    ],
  },
  {
    id: "client-005",
    name: "Agência de Publicidade Digital",
    email: "financeiro@agenciapub.com.br",
    phone: "47999776655",
    whatsappNumber: "47999776655",
    cnae: "7311-0/00",
    status: "active" as const,
    receivables: [
      {
        id: "rec-005",
        amount: 4200.00,
        dueDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 dias atrás
        description: "Campanha de marketing - Dezembro",
        daysOverdue: 60,
        monthsOverdue: 2,
        status: "overdue" as const,
      },
    ],
  },
  {
    id: "client-006",
    name: "Distribuidora de Alimentos",
    email: "vendas@distribalimentos.com.br",
    phone: "63988776655",
    whatsappNumber: "63988776655",
    cnae: "4621-0/00",
    status: "active" as const,
    receivables: [
      {
        id: "rec-006",
        amount: 8900.00,
        dueDate: new Date(Date.now() - 75 * 24 * 60 * 60 * 1000), // 75 dias atrás
        description: "Fornecimento de produtos - Dezembro",
        daysOverdue: 75,
        monthsOverdue: 2,
        status: "overdue" as const,
      },
    ],
  },

  // Faixa Formal (90+ dias)
  {
    id: "client-007",
    name: "Indústria de Plásticos",
    email: "financeiro@indplasticos.com.br",
    phone: "41987654321",
    whatsappNumber: "41987654321",
    cnae: "2222-0/00",
    status: "active" as const,
    receivables: [
      {
        id: "rec-007",
        amount: 12500.00,
        dueDate: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000), // 120 dias atrás
        description: "Serviço de consultoria - Outubro",
        daysOverdue: 120,
        monthsOverdue: 4,
        status: "overdue" as const,
      },
    ],
  },
  {
    id: "client-008",
    name: "Transportadora Regional",
    email: "financeiro@transportadora.com.br",
    phone: "67999887766",
    whatsappNumber: "67999887766",
    cnae: "4921-0/00",
    status: "active" as const,
    receivables: [
      {
        id: "rec-008",
        amount: 6800.00,
        dueDate: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000), // 150 dias atrás
        description: "Auditoria contábil - Setembro",
        daysOverdue: 150,
        monthsOverdue: 5,
        status: "overdue" as const,
      },
    ],
  },
];
