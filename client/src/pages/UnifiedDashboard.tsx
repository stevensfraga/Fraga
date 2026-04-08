import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { AlertCircle, MessageCircle, Loader2, RefreshCw, TrendingUp, Users, DollarSign, BarChart3, Search, Filter, History, Send, Smile, Lock, CheckCircle } from "lucide-react";
import { useLocation } from "wouter";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { toast } from "sonner";
import FinancialDashboard from "./FinancialDashboard";

interface DashboardData {
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
  cnae_distribution: Array<{ [key: string]: any }>;
  total_overdue: number;
  bank_balance: number;
}

interface Client {
  id: string;
  nome: string;
  dias_atraso: number;
  valor_atraso: number;
  faixa: "friendly" | "administrative" | "formal";
  num_parcelas: number;
  vencimento_mais_antigo: string;
}

interface Stats {
  totalClientes: number;
  totalOverdue: number;
  byRange: {
    friendly: { count: number; total: number };
    administrative: { count: number; total: number };
    formal: { count: number; total: number };
  };
}

const COLORS = ["#1F4E79", "#2E7BA6", "#3E9FD3", "#4EBFFF", "#5ECFFF", "#6EDFFF", "#7EEFFF", "#8EFFFF", "#9FFFFF"];

function OAuthIntegrationCard() {
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const { data: oauthStatus } = trpc.contaAzulOAuth.isAuthenticated.useQuery();
  const getAuthUrlQuery = trpc.contaAzulOAuth.getAuthUrl.useQuery();

  const handleOAuthStart = async () => {
    setOauthLoading(true);
    setOauthError(null);

    try {
      if (getAuthUrlQuery.data?.success && getAuthUrlQuery.data?.authUrl) {
        window.location.href = getAuthUrlQuery.data.authUrl;
      } else {
        setOauthError(getAuthUrlQuery.data?.error || "Erro ao gerar URL de autorização");
      }
    } catch (error: any) {
      setOauthError(error.message || "Erro ao iniciar autenticação");
    } finally {
      setOauthLoading(false);
    }
  };

  return (
    <Card className="bg-gradient-to-r from-blue-600 to-blue-800 border-blue-500">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
              {oauthStatus?.authenticated ? (
                <>
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  Conta Azul Conectada
                </>
              ) : (
                <>
                  <Lock className="w-5 h-5 text-yellow-400" />
                  Conectar Conta Azul
                </>
              )}
            </h2>
            <p className="text-blue-100 text-sm mb-4">
              {oauthStatus?.authenticated
                ? "Sua conta Conta Azul está conectada. Você pode sincronizar dados e disparar cobranças via WhatsApp."
                : "Conecte sua conta Conta Azul para sincronizar clientes, boletos e disparar cobranças automáticas via WhatsApp."}
            </p>
            {oauthError && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-200 text-sm">
                {oauthError}
              </div>
            )}
          </div>
          <Button
            onClick={handleOAuthStart}
            disabled={oauthLoading || oauthStatus?.authenticated || getAuthUrlQuery.isLoading}
            className={`ml-4 ${
              oauthStatus?.authenticated
                ? "bg-green-600 hover:bg-green-700"
                : "bg-white text-blue-600 hover:bg-blue-50"
            }`}
          >
            {oauthLoading || getAuthUrlQuery.isLoading ? "Carregando..." : oauthStatus?.authenticated ? "Conectado" : "Conectar Agora"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryButton({ clientId }: { clientId: string }) {
  const [, navigate] = useLocation();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => navigate(`/client/${clientId}`)}
      className="text-xs"
      title="Ver histórico de mensagens"
    >
      <History className="w-3 h-3" />
    </Button>
  );
}

// Componente de Dashboard de Sentimentos
function SentimentDashboardContent() {
  const mockSentimentData = [
    { date: "2026-02-01", positive: 5, negative: 2, neutral: 3, mixed: 1 },
    { date: "2026-02-02", positive: 8, negative: 1, neutral: 2, mixed: 2 },
    { date: "2026-02-03", positive: 6, negative: 3, neutral: 4, mixed: 1 },
    { date: "2026-02-04", positive: 9, negative: 2, neutral: 3, mixed: 0 },
    { date: "2026-02-05", positive: 7, negative: 4, neutral: 2, mixed: 2 },
    { date: "2026-02-06", positive: 10, negative: 1, neutral: 3, mixed: 1 },
  ];

  const sentimentColors = {
    positive: "#10b981",
    negative: "#ef4444",
    neutral: "#6b7280",
    mixed: "#f59e0b",
  };

  const pieData = [
    { name: "Positivo", value: 45 },
    { name: "Negativo", value: 13 },
    { name: "Neutro", value: 17 },
    { name: "Misto", value: 7 },
  ];

  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-green-900/30 border-green-700/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-green-400 text-sm mb-2">Sentimentos Positivos</div>
                <div className="text-3xl font-bold text-green-400">45</div>
                <div className="text-green-600 text-xs mt-2">37% do total</div>
              </div>
              <Smile className="w-10 h-10 text-green-400/30" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-red-900/30 border-red-700/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-red-400 text-sm mb-2">Sentimentos Negativos</div>
                <div className="text-3xl font-bold text-red-400">13</div>
                <div className="text-red-600 text-xs mt-2">11% do total</div>
              </div>
              <AlertCircle className="w-10 h-10 text-red-400/30" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-yellow-900/30 border-yellow-700/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-yellow-400 text-sm mb-2">Sentimentos Neutros</div>
                <div className="text-3xl font-bold text-yellow-400">17</div>
                <div className="text-yellow-600 text-xs mt-2">14% do total</div>
              </div>
              <MessageCircle className="w-10 h-10 text-yellow-400/30" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-purple-900/30 border-purple-700/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-purple-400 text-sm mb-2">Sentimentos Mistos</div>
                <div className="text-3xl font-bold text-purple-400">7</div>
                <div className="text-purple-600 text-xs mt-2">6% do total</div>
              </div>
              <TrendingUp className="w-10 h-10 text-purple-400/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico de Linha - Tendência */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">Tendência de Sentimento</CardTitle>
            <CardDescription>Últimos 6 dias</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={mockSentimentData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="positive" stroke={sentimentColors.positive} name="Positivo" />
                <Line type="monotone" dataKey="negative" stroke={sentimentColors.negative} name="Negativo" />
                <Line type="monotone" dataKey="neutral" stroke={sentimentColors.neutral} name="Neutro" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Gráfico de Pizza - Distribuição */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">Distribuição de Sentimentos</CardTitle>
            <CardDescription>Proporção de respostas</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.name === "Positivo"
                          ? sentimentColors.positive
                          : entry.name === "Negativo"
                            ? sentimentColors.negative
                            : entry.name === "Neutro"
                              ? sentimentColors.neutral
                              : sentimentColors.mixed
                      }
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico de Barras - Ações Sugeridas */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Ações Sugeridas por Tipo</CardTitle>
          <CardDescription>Próximos passos recomendados</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={[
              { name: "Aguardar", value: 3 },
              { name: "Escalar", value: 2 },
              { name: "Informar", value: 1 },
              { name: "Verificar", value: 1 },
            ]}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </>
  );
}

export default function UnifiedDashboard() {
  const [, navigate] = useLocation();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingClientId, setSendingClientId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterColor, setFilterColor] = useState<"all" | "friendly" | "administrative" | "formal">("all");
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    loadData();
    // Atualizar dashboard a cada 30 segundos
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    filterClients();
  }, [clients, searchTerm, filterColor]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Carregar dados financeiros
      const dashResponse = await fetch("/dashboard-data.json");
      const dashData = await dashResponse.json();
      setDashboardData(dashData);

      // Carregar clientes em atraso
      const clientsResponse = await fetch("/clientes-atraso.json");
      const clientsData = await clientsResponse.json();
      setClients(clientsData.clientes || []);

      // Calcular estatísticas
      const calculatedStats = calculateStats(clientsData.clientes || []);
      setStats(calculatedStats);
      setLastUpdate(new Date());
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
      toast.error("Erro ao carregar dados do dashboard");
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (clientsList: Client[]): Stats => {
    const friendly = clientsList.filter((c) => c.dias_atraso > 0 && c.dias_atraso <= 30);
    const administrative = clientsList.filter((c) => c.dias_atraso > 30 && c.dias_atraso <= 90);
    const formal = clientsList.filter((c) => c.dias_atraso > 90);

    const totalOverdue = clientsList.reduce((sum, c) => sum + c.valor_atraso, 0);

    return {
      totalClientes: clientsList.length,
      totalOverdue,
      byRange: {
        friendly: {
          count: friendly.length,
          total: friendly.reduce((sum, c) => sum + c.valor_atraso, 0),
        },
        administrative: {
          count: administrative.length,
          total: administrative.reduce((sum, c) => sum + c.valor_atraso, 0),
        },
        formal: {
          count: formal.length,
          total: formal.reduce((sum, c) => sum + c.valor_atraso, 0),
        },
      },
    };
  };

  const filterClients = () => {
    let filtered = clients;

    // Filtrar por cor
    if (filterColor !== "all") {
      filtered = filtered.filter((c) => {
        if (filterColor === "friendly") return c.dias_atraso > 0 && c.dias_atraso <= 30;
        if (filterColor === "administrative") return c.dias_atraso > 30 && c.dias_atraso <= 90;
        if (filterColor === "formal") return c.dias_atraso > 90;
        return true;
      });
    }

    // Filtrar por busca
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.nome.toLowerCase().includes(term)
      );
    }

    setFilteredClients(filtered);
  };

  const sendMessageMutation = trpc.collection.sendCollectionMessage.useMutation();

  const handleSendMessage = async (client: Client) => {
    setSendingClientId(client.id);
    try {
      const messageType = classifyClient(client);
      const templates: Record<string, string> = {
        friendly: `Oi ${client.nome}! Passando só para confirmar se o boleto referente a R$ ${client.valor_atraso.toFixed(2)} já foi programado. Qualquer coisa me avisa!`,
        administrative: `Olá ${client.nome}, Identificamos valores em aberto de R$ ${client.valor_atraso.toFixed(2)} há ${client.dias_atraso} dias. Para manter os serviços ativos, precisamos regularizar. Podemos seguir com pagamento integral ou parcelamento. Qual opção prefere?`,
        formal: `${client.nome}, Sem a regularização do débito de R$ ${client.valor_atraso.toFixed(2)} até 48 horas, os serviços serão suspensos conforme contrato. Favor regularizar urgentemente.`,
      };

      // Enviar mensagem via tRPC
      // O backend vai buscar o número de WhatsApp do cliente no banco de acessórias
      const result = await sendMessageMutation.mutateAsync({
        clientId: client.id,
        clientName: client.nome,
        clientPhone: undefined, // Backend vai buscar automaticamente
        amount: client.valor_atraso,
        daysOverdue: client.dias_atraso,
        messageType: messageType,
      });

      if (result.success) {
        console.log(`[WhatsApp] Mensagem enviada com sucesso para ${client.nome}`);
        toast.success("📱 Mensagem enviada via WhatsApp!");
      } else {
        console.error(`[WhatsApp] Erro ao enviar: ${result.message}`);
        toast.error(`❌ ${result.message}`);
      }
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
      toast.error("❌ Erro ao enviar mensagem");
    } finally {
      setSendingClientId(null);
    }
  };

  const classifyClient = (client: Client): "friendly" | "administrative" | "formal" => {
    if (client.dias_atraso <= 30) return "friendly";
    if (client.dias_atraso <= 90) return "administrative";
    return "formal";
  };

  const getColorBadge = (client: Client) => {
    const type = classifyClient(client);
    if (type === "friendly") return "🟢";
    if (type === "administrative") return "🟡";
    return "🔴";
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl flex items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin" />
          Carregando dashboard...
        </div>
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Erro ao carregar dados</div>
      </div>
    );
  }

  // Prepare chart data
  const revenueData = dashboardData.dre_2025.months.map((month, idx) => ({
    month: month.substring(0, 3),
    revenue: dashboardData.dre_2025.revenue[idx],
    profit: dashboardData.dre_2025.net_profit[idx],
  }));

  const cnaeData = dashboardData.cnae_distribution.slice(0, 5).map((item) => {
    const values = Object.values(item);
    return {
      name: String(values[0]).substring(0, 20),
      value: Number(values[1]) || 0,
    };
  });

  const totalRevenue = dashboardData.dre_2025.revenue.reduce((a, b) => a + b, 0);
  const totalProfit = dashboardData.dre_2025.net_profit.reduce((a, b) => a + b, 0);
  const avgMonthlyRevenue = totalRevenue / dashboardData.dre_2025.months.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">📊 Dashboard Fraga Contabilidade</h1>
          <p className="text-slate-400">Visão completa: Financeiro + Agente de Cobrança</p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="flex w-full bg-slate-800 border border-slate-700 overflow-x-auto">
            <TabsTrigger value="overview" className="text-white">
              📈 Visão Geral
            </TabsTrigger>
            <TabsTrigger value="financial" className="text-white">
              💰 Financeiro
            </TabsTrigger>
            <TabsTrigger value="collection" className="text-white">
              🔔 Cobrança ({stats?.totalClientes || 0})
            </TabsTrigger>
            <TabsTrigger value="sentiment" className="text-white">
              😊 Sentimentos
            </TabsTrigger>
            <TabsTrigger value="juridico" className="text-white">
              ⚖️ Jurídico
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* OAuth Integration Section */}
            <OAuthIntegrationCard />

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="bg-blue-900/30 border-blue-700/50">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-blue-400 text-sm mb-2">Faturamento 2025</div>
                      <div className="text-3xl font-bold text-blue-400">{formatCurrency(totalRevenue)}</div>
                      <div className="text-blue-600 text-xs mt-2">Receita total acumulada</div>
                    </div>
                    <DollarSign className="w-10 h-10 text-blue-400/30" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-green-900/30 border-green-700/50">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-green-400 text-sm mb-2">Lucro Líquido</div>
                      <div className="text-3xl font-bold text-green-400">{formatCurrency(totalProfit)}</div>
                      <div className="text-green-600 text-xs mt-2">Resultado acumulado</div>
                    </div>
                    <TrendingUp className="w-10 h-10 text-green-400/30" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-purple-900/30 border-purple-700/50">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-purple-400 text-sm mb-2">Total de Clientes</div>
                      <div className="text-3xl font-bold text-purple-400">{dashboardData.total_clients}</div>
                      <div className="text-purple-600 text-xs mt-2">{dashboardData.active_clients} ativos</div>
                    </div>
                    <Users className="w-10 h-10 text-purple-400/30" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-red-900/30 border-red-700/50">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-red-400 text-sm mb-2">Em Atraso</div>
                      <div className="text-3xl font-bold text-red-400">{formatCurrency(stats?.totalOverdue || 0)}</div>
                      <div className="text-red-600 text-xs mt-2">{stats?.totalClientes || 0} clientes</div>
                    </div>
                    <AlertCircle className="w-10 h-10 text-red-400/30" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white">Evolução Mensal - Receita vs Lucro</CardTitle>
                  <CardDescription className="text-slate-400">2025</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={revenueData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                      <XAxis dataKey="month" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569" }} />
                      <Legend />
                      <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} name="Receita" />
                      <Line type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} name="Lucro" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white">Top 5 CNAEs</CardTitle>
                  <CardDescription className="text-slate-400">Distribuição de clientes por setor</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={cnaeData} cx="50%" cy="50%" labelLine={false} label={({ name, value }) => `${name}: ${value}`} outerRadius={80} fill="#8884d8" dataKey="value">
                        {cnaeData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Financial Tab */}
          <TabsContent value="financial" className="space-y-6">
            <FinancialDashboard />
          </TabsContent>

          {/* Sentiment Tab */}
          <TabsContent value="sentiment" className="space-y-6">
            <SentimentDashboardContent />
          </TabsContent>

          {/* Collection Tab */}
          <TabsContent value="collection" className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="pt-6">
                  <div className="text-slate-400 text-sm mb-2">Total em Atraso</div>
                  <div className="text-3xl font-bold text-white">{stats?.totalClientes || 0}</div>
                  <div className="text-slate-500 text-xs mt-2">Clientes com débito</div>
                </CardContent>
              </Card>

              <Card className="bg-green-900/30 border-green-700/50">
                <CardContent className="pt-6">
                  <div className="text-green-400 text-sm mb-2">🟢 Amigável</div>
                  <div className="text-3xl font-bold text-green-400">{stats?.byRange?.friendly?.count || 0}</div>
                  <div className="text-green-600 text-xs mt-2">{formatCurrency(stats?.byRange?.friendly?.total || 0)}</div>
                </CardContent>
              </Card>

              <Card className="bg-yellow-900/30 border-yellow-700/50">
                <CardContent className="pt-6">
                  <div className="text-yellow-400 text-sm mb-2">🟡 Administrativa</div>
                  <div className="text-3xl font-bold text-yellow-400">{stats?.byRange?.administrative?.count || 0}</div>
                  <div className="text-yellow-600 text-xs mt-2">{formatCurrency(stats?.byRange?.administrative?.total || 0)}</div>
                </CardContent>
              </Card>

              <Card className="bg-red-900/30 border-red-700/50">
                <CardContent className="pt-6">
                  <div className="text-red-400 text-sm mb-2">🔴 Formal</div>
                  <div className="text-3xl font-bold text-red-400">{stats?.byRange?.formal?.count || 0}</div>
                  <div className="text-red-600 text-xs mt-2">{formatCurrency(stats?.byRange?.formal?.total || 0)}</div>
                </CardContent>
              </Card>

              <Card className="bg-blue-900/30 border-blue-700/50">
                <CardContent className="pt-6">
                  <div className="text-blue-400 text-sm mb-2">Valor Total</div>
                  <div className="text-2xl font-bold text-blue-400">{formatCurrency(stats?.totalOverdue || 0)}</div>
                  <div className="text-blue-600 text-xs mt-2">Em recuperações</div>
                </CardContent>
              </Card>
            </div>

            {/* Filtros e Busca */}
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">🔍 Filtros e Busca</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                    <Input
                      placeholder="Buscar por nome, email, município..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                    />
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => setFilterColor("all")}
                    variant={filterColor === "all" ? "default" : "outline"}
                    className={filterColor === "all" ? "bg-slate-600 hover:bg-slate-700" : "border-slate-600 text-slate-300 hover:bg-slate-700"}
                  >
                    Todos ({clients.length})
                  </Button>
                  <Button
                    onClick={() => setFilterColor("friendly")}
                    variant={filterColor === "friendly" ? "default" : "outline"}
                    className={filterColor === "friendly" ? "bg-green-600 hover:bg-green-700" : "border-green-600 text-green-300 hover:bg-green-900/30"}
                  >
                    🟢 Amigável ({stats?.byRange?.friendly?.count || 0})
                  </Button>
                  <Button
                    onClick={() => setFilterColor("administrative")}
                    variant={filterColor === "administrative" ? "default" : "outline"}
                    className={filterColor === "administrative" ? "bg-yellow-600 hover:bg-yellow-700" : "border-yellow-600 text-yellow-300 hover:bg-yellow-900/30"}
                  >
                    🟡 Administrativa ({stats?.byRange?.administrative?.count || 0})
                  </Button>
                  <Button
                    onClick={() => setFilterColor("formal")}
                    variant={filterColor === "formal" ? "default" : "outline"}
                    className={filterColor === "formal" ? "bg-red-600 hover:bg-red-700" : "border-red-600 text-red-300 hover:bg-red-900/30"}
                  >
                    🔴 Formal ({stats?.byRange?.formal?.count || 0})
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Tabela de Clientes */}
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">
                  📋 Lista de Clientes em Atraso ({filteredClients.length})
                </CardTitle>
                <CardDescription className="text-slate-400">
                  {filterColor !== "all" && `Filtrado por: ${filterColor === "friendly" ? "Amigável" : filterColor === "administrative" ? "Administrativa" : "Formal"}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-3 px-4 text-slate-300 font-semibold">Status</th>
                        <th className="text-left py-3 px-4 text-slate-300 font-semibold">Cliente</th>
                        <th className="text-left py-3 px-4 text-slate-300 font-semibold">Município</th>
                        <th className="text-right py-3 px-4 text-slate-300 font-semibold">Dias Atraso</th>
                        <th className="text-right py-3 px-4 text-slate-300 font-semibold">Valor em Atraso</th>
                        <th className="text-center py-3 px-4 text-slate-300 font-semibold">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredClients.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-8 text-slate-400">
                            Nenhum cliente encontrado
                          </td>
                        </tr>
                      ) : (
                        filteredClients.map((client) => (
                          <tr key={client.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition">
                            <td className="py-3 px-4">{getColorBadge(client)}</td>
                            <td className="py-3 px-4">
                              <div className="font-semibold text-white">{client.nome}</div>
                              <div className="text-xs text-slate-400">ID: {client.id}</div>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className="text-slate-300 font-semibold">{client.dias_atraso}d</span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className="text-white font-semibold">{formatCurrency(client.valor_atraso)}</span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <div className="flex gap-2 justify-center">
                                <Button
                                  size="sm"
                                  onClick={() => handleSendMessage(client)}
                                  disabled={sendingClientId === client.id}
                                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
                                >
                                  {sendingClientId === client.id ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  ) : (
                                    <MessageCircle className="w-3 h-3 mr-1" />
                                  )}
                                  Enviar
                                </Button>
                                <HistoryButton clientId={client.id} />
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Jurídico Tab */}
          <TabsContent value="juridico" className="space-y-6">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  ⚖️ Módulo Jurídico
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Gere dossiês de cobrança para encaminhamento ao jurídico. Revise candidatos, aprove casos e exporte comprovantes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="bg-slate-700/50 border-slate-600">
                    <CardContent className="pt-6 text-center">
                      <div className="text-3xl mb-2">📝</div>
                      <h3 className="text-white font-semibold mb-1">Candidatos</h3>
                      <p className="text-slate-400 text-sm">Clientes com dívida antiga e múltiplas tentativas de cobrança sem sucesso</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-slate-700/50 border-slate-600">
                    <CardContent className="pt-6 text-center">
                      <div className="text-3xl mb-2">✅</div>
                      <h3 className="text-white font-semibold mb-1">Aprovação</h3>
                      <p className="text-slate-400 text-sm">Revise e aprove dossiês antes de enviar ao escritório jurídico</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-slate-700/50 border-slate-600">
                    <CardContent className="pt-6 text-center">
                      <div className="text-3xl mb-2">📤</div>
                      <h3 className="text-white font-semibold mb-1">Export</h3>
                      <p className="text-slate-400 text-sm">Exporte XLSX + TXT com comprovantes de interação para o jurídico</p>
                    </CardContent>
                  </Card>
                </div>
                <Button
                  onClick={() => navigate('/juridico')}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 text-lg"
                >
                  ⚖️ Abrir Painel Jurídico Completo
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
