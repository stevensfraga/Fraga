/**
 * Dashboard de Auditoria de Cobrança
 * 
 * Exibe histórico de mensagens, estatísticas e relatórios em tempo real
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { CheckCircle2, AlertCircle, Clock, TrendingUp } from "lucide-react";

export default function CollectionAudit() {
  const [selectedPeriod, setSelectedPeriod] = useState<"today" | "week" | "month">("today");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch statistics
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.audit.getStatistics.useQuery({});

  // Fetch recent messages
  const { data: recentMessages, isLoading: messagesLoading, refetch: refetchMessages } = trpc.audit.getRecentMessages.useQuery({
    limit: 20,
  } as any);

  // Fetch today's summary
  const { data: todaySummary } = trpc.audit.getTodaySummary.useQuery({} as any);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      refetchStats();
      refetchMessages();
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh, refetchStats, refetchMessages]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
      case "delivered":
      case "read":
        return "bg-green-100 text-green-800";
      case "failed":
        return "bg-red-100 text-red-800";
      case "pending":
      case "sent":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
      case "delivered":
      case "read":
        return <CheckCircle2 className="w-4 h-4" />;
      case "failed":
        return <AlertCircle className="w-4 h-4" />;
      case "pending":
      case "sent":
        return <Clock className="w-4 h-4" />;
      default:
        return null;
    }
  };

  // Prepare chart data
  const chartData = stats?.byDay
    ? Object.entries(stats.byDay).map(([date, count]) => ({
        date: new Date(date).toLocaleDateString("pt-BR"),
        mensagens: count,
      }))
    : [];

  const clientData = stats?.byClient
    ? Object.entries(stats.byClient).map(([client, count]) => ({
        name: client,
        value: count,
      }))
    : [];

  const COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6"];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Dashboard de Auditoria</h1>
          <p className="text-slate-600">Histórico de cobranças, estatísticas e relatórios em tempo real</p>
        </div>

        {/* Controls */}
        <div className="flex gap-4 mb-6">
          <div className="flex gap-2">
            <Button
              variant={selectedPeriod === "today" ? "default" : "outline"}
              onClick={() => setSelectedPeriod("today")}
            >
              Hoje
            </Button>
            <Button
              variant={selectedPeriod === "week" ? "default" : "outline"}
              onClick={() => setSelectedPeriod("week")}
            >
              Semana
            </Button>
            <Button
              variant={selectedPeriod === "month" ? "default" : "outline"}
              onClick={() => setSelectedPeriod("month")}
            >
              Mês
            </Button>
          </div>

          <div className="ml-auto flex gap-2">
            <Button
              variant={autoRefresh ? "default" : "outline"}
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              {autoRefresh ? "🔄 Auto-atualizar" : "⏸️ Pausado"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                refetchStats();
                refetchMessages();
              }}
            >
              🔄 Atualizar agora
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600">Total de Mensagens</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{stats?.total || 0}</div>
              <p className="text-xs text-slate-500 mt-1">Período selecionado</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600">Enviadas com Sucesso</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">{stats?.successful || 0}</div>
              <p className="text-xs text-slate-500 mt-1">Taxa: {stats?.successRate}%</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600">Falhas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">{stats?.failed || 0}</div>
              <p className="text-xs text-slate-500 mt-1">Requer atenção</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600">Pendentes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-600">{stats?.pending || 0}</div>
              <p className="text-xs text-slate-500 mt-1">Em processamento</p>
            </CardContent>
          </Card>
        </div>

        {/* Hoje Summary */}
        {todaySummary && (
          <Card className="mb-6 bg-blue-50 border-blue-200">
            <CardHeader>
              <CardTitle className="text-lg">Resumo de Hoje</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-slate-600">Data</p>
                  <p className="text-lg font-semibold">{todaySummary.date}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Total</p>
                  <p className="text-lg font-semibold">{todaySummary.total}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Sucesso</p>
                  <p className="text-lg font-semibold text-green-600">{todaySummary.successful}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Taxa</p>
                  <p className="text-lg font-semibold text-blue-600">{todaySummary.successRate}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Line Chart - Mensagens por Dia */}
          <Card>
            <CardHeader>
              <CardTitle>Mensagens por Dia</CardTitle>
              <CardDescription>Tendência de envios nos últimos dias</CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="mensagens" stroke="#3b82f6" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-slate-500">
                  Sem dados disponíveis
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pie Chart - Distribuição por Cliente */}
          <Card>
            <CardHeader>
              <CardTitle>Distribuição por Cliente</CardTitle>
              <CardDescription>Mensagens enviadas por cliente</CardDescription>
            </CardHeader>
            <CardContent>
              {clientData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={clientData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {clientData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-slate-500">
                  Sem dados disponíveis
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Messages Table */}
        <Card>
          <CardHeader>
            <CardTitle>Últimas Mensagens</CardTitle>
            <CardDescription>Histórico das últimas 20 mensagens enviadas</CardDescription>
          </CardHeader>
          <CardContent>
            {messagesLoading ? (
              <div className="text-center py-8 text-slate-500">Carregando...</div>
            ) : recentMessages && recentMessages.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-4 font-semibold text-slate-700">Data/Hora</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-700">Cliente</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-700">Telefone</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-700">Status</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-700">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentMessages.map((msg: any, idx: number) => (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-3 px-4 text-slate-600">
                          {new Date(msg.sentAt).toLocaleString("pt-BR")}
                        </td>
                        <td className="py-3 px-4 text-slate-900 font-medium">{msg.clientId}</td>
                        <td className="py-3 px-4 text-slate-600">{msg.phoneNumber || "-"}</td>
                        <td className="py-3 px-4">
                          <Badge className={`${getStatusColor(msg.status)} flex w-fit gap-1`}>
                            {getStatusIcon(msg.status)}
                            {msg.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-slate-900 font-semibold">
                          {msg.amount ? `R$ ${(msg.amount / 100).toFixed(2)}` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500">Nenhuma mensagem encontrada</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
