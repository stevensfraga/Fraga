/**
 * 📊 Dashboard de Cobrança - Versão 2.0
 * Integrado com tRPC + Endpoints de Métricas
 * Visibilidade operacional + valor comercial
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Send,
  TrendingUp,
  DollarSign,
  Users,
  AlertCircle,
  Calendar,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function CollectionDashboard() {
  const [period, setPeriod] = useState<"day" | "week" | "month">("month");
  const [debtAgingStatus, setDebtAgingStatus] = useState<"overdue" | "pending" | "all">("overdue");

  // Fetch metrics
  const mainMetrics = trpc.collectionMetrics.mainMetrics.useQuery({ period });
  const sendingHistory = trpc.collectionMetrics.sendingHistory.useQuery({ period, days: 30 });
  const topDebtors = trpc.collectionMetrics.topDebtors.useQuery({ limit: 10, status: "overdue" });
  const debtAging = trpc.collectionMetrics.debtAging.useQuery({ status: debtAgingStatus });
  const generalStats = trpc.collectionMetrics.generalStats.useQuery();

  const isLoading =
    mainMetrics.isLoading ||
    sendingHistory.isLoading ||
    topDebtors.isLoading ||
    debtAging.isLoading ||
    generalStats.isLoading;

  const handleRefresh = () => {
    mainMetrics.refetch();
    sendingHistory.refetch();
    topDebtors.refetch();
    debtAging.refetch();
    generalStats.refetch();
    toast.success("✅ Dados atualizados!");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-400 mx-auto mb-4" />
          <p className="text-slate-300">Carregando métricas de cobrança...</p>
        </div>
      </div>
    );
  }

  const metrics = mainMetrics.data;
  const history = sendingHistory.data || [];
  const debtors = topDebtors.data || [];
  const aging = debtAging.data;
  const stats = generalStats.data;

  // Cores para gráficos
  const COLORS = ["#fbbf24", "#f97316", "#ef4444"];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">📊 Dashboard de Cobrança</h1>
            <p className="text-slate-400">Visibilidade operacional e métricas de recuperação</p>
          </div>
          <Button
            onClick={handleRefresh}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Atualizar
          </Button>
        </div>

        {/* Period Selector */}
        <div className="flex gap-2 mb-8">
          {(["day", "week", "month"] as const).map((p) => (
            <Button
              key={p}
              variant={period === p ? "default" : "outline"}
              onClick={() => setPeriod(p)}
              className="capitalize"
            >
              {p === "day" ? "Hoje" : p === "week" ? "Semana" : "Mês"}
            </Button>
          ))}
        </div>

        {/* Main Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Boletos Enviados */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <Send className="w-4 h-4" />
                Boletos Enviados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{metrics?.boletos.sent || 0}</div>
              <p className="text-xs text-slate-500 mt-1">
                Falhados: {metrics?.boletos.failed || 0}
              </p>
            </CardContent>
          </Card>

          {/* Taxa de Entrega */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Taxa de Entrega
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-400">
                {metrics?.boletos.deliveryRate.toFixed(1) || 0}%
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {metrics?.boletos.sent || 0} de {metrics?.boletos.total || 0}
              </p>
            </CardContent>
          </Card>

          {/* Valor em Cobrança */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Em Cobrança
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-400">
                R$ {(metrics?.values.totalOverdue || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
              </div>
              <p className="text-xs text-slate-500 mt-1">Inadimplentes</p>
            </CardContent>
          </Card>

          {/* Valor Recuperado */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Recuperado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-400">
                R$ {(metrics?.values.totalRecovered || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
              </div>
              <p className="text-xs text-slate-500 mt-1">Pago</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Histórico de Envios */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Evolução de Envios</CardTitle>
              <CardDescription>Últimos 30 dias</CardDescription>
            </CardHeader>
            <CardContent>
              {history.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" stroke="#9ca3af" />
                    <YAxis stroke="#9ca3af" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
                      labelStyle={{ color: "#fff" }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="sent" stroke="#10b981" name="Enviados" />
                    <Line type="monotone" dataKey="failed" stroke="#ef4444" name="Falhados" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-300 flex items-center justify-center text-slate-500">
                  Sem dados de envios
                </div>
              )}
            </CardContent>
          </Card>

          {/* Aging da Dívida */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Aging da Dívida</CardTitle>
              <CardDescription>Distribuição por faixa de vencimento</CardDescription>
            </CardHeader>
            <CardContent>
              {aging && (aging["0-30"].count > 0 || aging["30-60"].count > 0 || aging["60+"].count > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: "0-30 dias", value: aging["0-30"].count || 0 },
                        { name: "30-60 dias", value: aging["30-60"].count || 0 },
                        { name: "60+ dias", value: aging["60+"].count || 0 },
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {COLORS.map((color, index) => (
                        <Cell key={`cell-${index}`} fill={color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
                      labelStyle={{ color: "#fff" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-300 flex items-center justify-center text-slate-500">
                  Sem dívidas em aberto
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Ranking de Inadimplentes */}
        <Card className="bg-slate-800 border-slate-700 mb-8">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Users className="w-5 h-5" />
              Top 10 Inadimplentes
            </CardTitle>
            <CardDescription>Maiores dívidas em aberto</CardDescription>
          </CardHeader>
          <CardContent>
            {debtors.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-3 px-4 text-slate-400">Cliente</th>
                      <th className="text-left py-3 px-4 text-slate-400">Email</th>
                      <th className="text-right py-3 px-4 text-slate-400">Dívida</th>
                      <th className="text-right py-3 px-4 text-slate-400">Boletos</th>
                      <th className="text-right py-3 px-4 text-slate-400">Dias Vencido</th>
                      <th className="text-center py-3 px-4 text-slate-400">WhatsApp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debtors.map((debtor, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-slate-700 hover:bg-slate-700/50 transition"
                      >
                        <td className="py-3 px-4 text-white font-medium">{debtor.clientName}</td>
                        <td className="py-3 px-4 text-slate-400 text-xs">{debtor.email || "-"}</td>
                        <td className="py-3 px-4 text-right text-red-400 font-semibold">
                          R$ {debtor.totalDebt.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {debtor.receivableCount}
                        </td>
                        <td className="py-3 px-4 text-right text-orange-400 font-semibold">
                          {debtor.daysOverdue} dias
                        </td>
                        <td className="py-3 px-4 text-center">
                          {debtor.whatsappNumber ? (
                            <span className="inline-block w-3 h-3 bg-green-500 rounded-full" title="WhatsApp disponível"></span>
                          ) : (
                            <span className="inline-block w-3 h-3 bg-red-500 rounded-full" title="Sem WhatsApp"></span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-slate-500 text-center py-8">Nenhum inadimplente encontrado</p>
            )}
          </CardContent>
        </Card>

        {/* Aging Details */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Detalhes do Aging
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "0-30 dias", key: "0-30", color: "bg-yellow-500" },
                { label: "30-60 dias", key: "30-60", color: "bg-orange-500" },
                { label: "60+ dias", key: "60+", color: "bg-red-500" },
              ].map((item) => (
                <div key={item.key} className="p-4 bg-slate-700 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-3 h-3 rounded ${item.color}`}></div>
                    <p className="text-slate-300 text-sm">{item.label}</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {aging?.[item.key as keyof typeof aging]?.count || 0}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    R$ {(aging?.[item.key as keyof typeof aging]?.total || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* General Stats */}
        <Card className="bg-slate-800 border-slate-700 mt-8">
          <CardHeader>
            <CardTitle className="text-white">Estatísticas Gerais</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-700 rounded-lg">
                <p className="text-slate-400 text-sm">Total de Contas</p>
                <p className="text-2xl font-bold text-white">
                  {stats?.receivables.byStatus.reduce((sum, item) => sum + item.count, 0) || 0}
                </p>
              </div>
              <div className="p-4 bg-slate-700 rounded-lg">
                <p className="text-slate-400 text-sm">Clientes</p>
                <p className="text-2xl font-bold text-white">{stats?.clients.total || 0}</p>
              </div>
              <div className="p-4 bg-slate-700 rounded-lg">
                <p className="text-slate-400 text-sm">Com WhatsApp</p>
                <p className="text-2xl font-bold text-green-400">{stats?.clients.withWhatsapp || 0}</p>
              </div>
              <div className="p-4 bg-slate-700 rounded-lg">
                <p className="text-slate-400 text-sm">Cobertura</p>
                <p className="text-2xl font-bold text-blue-400">
                  {stats?.clients.total
                    ? (((stats.clients.withWhatsapp || 0) / stats.clients.total) * 100).toFixed(1)
                    : 0}
                  %
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
