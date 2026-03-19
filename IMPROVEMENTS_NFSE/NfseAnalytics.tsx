import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, Clock, AlertCircle, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface StatCard {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number;
  color: string;
}

export function NfseAnalytics() {
  // Buscar stats agregados
  const statsQuery = trpc.nfse.analytics.stats.useQuery({
    period: "30days",
  });

  const chartDataQuery = trpc.nfse.analytics.timeline.useQuery({
    period: "30days",
  });

  const statusDistQuery = trpc.nfse.analytics.statusDistribution.useQuery({});

  if (statsQuery.isPending) {
    return <AnalyticsSkeleton />;
  }

  const stats = statsQuery.data;
  const chartData = chartDataQuery.data || [];
  const statusDist = statusDistQuery.data || [];

  const statCards: StatCard[] = [
    {
      label: "Emitidas",
      value: stats?.emitted || 0,
      icon: <CheckCircle2 className="h-5 w-5" />,
      trend: stats?.emittedTrend,
      color: "bg-green-50 border-green-200",
    },
    {
      label: "Em Processamento",
      value: stats?.processing || 0,
      icon: <Clock className="h-5 w-5" />,
      color: "bg-blue-50 border-blue-200",
    },
    {
      label: "Erros",
      value: stats?.failed || 0,
      icon: <AlertCircle className="h-5 w-5" />,
      trend: stats?.failedTrend,
      color: "bg-red-50 border-red-200",
    },
    {
      label: "Valor Total",
      value: `R$ ${(stats?.totalValue || 0).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
      icon: <TrendingUp className="h-5 w-5" />,
      color: "bg-purple-50 border-purple-200",
    },
  ];

  const COLORS = ["#22c55e", "#3b82f6", "#ef4444", "#f59e0b"];

  return (
    <div className="space-y-6 mb-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, i) => (
          <Card key={i} className={`${stat.color} border`}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-600">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                  {stat.trend !== undefined && (
                    <p
                      className={`text-xs mt-1 ${
                        stat.trend >= 0
                          ? "text-green-600"
                          : "text-red-600"
                      }`}
                    >
                      {stat.trend >= 0 ? "↑" : "↓"} {Math.abs(
                        stat.trend
                      )}% vs período anterior
                    </p>
                  )}
                </div>
                <div className="text-gray-400">{stat.icon}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Emissões por Dia (últimos 30 dias)</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="emitidas"
                    stroke="#22c55e"
                    name="Emitidas"
                  />
                  <Line
                    type="monotone"
                    dataKey="processando"
                    stroke="#3b82f6"
                    name="Processando"
                  />
                  <Line
                    type="monotone"
                    dataKey="erros"
                    stroke="#ef4444"
                    name="Erros"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-gray-500 text-center py-12">
                Sem dados disponíveis
              </p>
            )}
          </CardContent>
        </Card>

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribuição por Status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusDist.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusDist}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                  >
                    {statusDist.map((_, i) => (
                      <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-gray-500 text-center py-12">
                Sem dados
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Insights */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">📊 Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <span className="text-green-600 mt-0.5">✓</span>
              <span>
                Taxa de sucesso:{" "}
                <strong>
                  {stats?.successRate
                    ? stats.successRate.toFixed(1)
                    : 0}%
                </strong>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-600 mt-0.5">ℹ</span>
              <span>
                Tempo médio de processamento:{" "}
                <strong>{stats?.avgProcessingTime || "N/A"}</strong>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-purple-600 mt-0.5">★</span>
              <span>
                Top prestador: <strong>{stats?.topProvider || "N/A"}</strong>
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-8 w-1/2 mb-2" />
              <Skeleton className="h-6 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

