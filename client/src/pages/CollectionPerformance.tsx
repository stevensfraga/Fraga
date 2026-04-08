import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { TrendingUp, MessageSquare, CheckCircle, Clock, AlertCircle } from 'lucide-react';

interface PerformanceMetrics {
  stage: string;
  totalSent: number;
  delivered: number;
  read: number;
  responded: number;
  converted: number;
  responseRate: number;
  conversionRate: number;
  avgResponseTime: number;
}

interface DashboardData {
  metrics: PerformanceMetrics[];
  totalClients: number;
  totalMessages: number;
  totalResponses: number;
  totalConversions: number;
  overallResponseRate: number;
  overallConversionRate: number;
  timeSeriesData: Array<{
    date: string;
    friendly: number;
    administrative: number;
    formal: number;
  }>;
}

const STAGE_COLORS = {
  friendly: '#10b981',
  administrative: '#f59e0b',
  formal: '#ef4444'
};

const STAGE_NAMES = {
  friendly: 'Amigável',
  administrative: 'Administrativa',
  formal: 'Formal'
};

export default function CollectionPerformance() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30'); // days

  useEffect(() => {
    loadPerformanceData();
  }, [period]);

  const loadPerformanceData = async () => {
    setLoading(true);
    try {
      // Simulated data - replace with actual API call
      const mockData: DashboardData = {
        metrics: [
          {
            stage: 'friendly',
            totalSent: 54,
            delivered: 52,
            read: 48,
            responded: 18,
            converted: 12,
            responseRate: 33.3,
            conversionRate: 22.2,
            avgResponseTime: 2.5
          },
          {
            stage: 'administrative',
            totalSent: 36,
            delivered: 35,
            read: 32,
            responded: 14,
            converted: 8,
            responseRate: 38.9,
            conversionRate: 22.2,
            avgResponseTime: 1.8
          },
          {
            stage: 'formal',
            totalSent: 22,
            delivered: 21,
            read: 19,
            responded: 8,
            converted: 6,
            responseRate: 36.4,
            conversionRate: 27.3,
            avgResponseTime: 1.2
          }
        ],
        totalClients: 54,
        totalMessages: 112,
        totalResponses: 40,
        totalConversions: 26,
        overallResponseRate: 35.7,
        overallConversionRate: 23.2,
        timeSeriesData: [
          { date: '01/02', friendly: 12, administrative: 0, formal: 0 },
          { date: '02/02', friendly: 15, administrative: 0, formal: 0 },
          { date: '03/02', friendly: 18, administrative: 8, formal: 0 },
          { date: '04/02', friendly: 9, administrative: 12, formal: 0 },
          { date: '05/02', friendly: 0, administrative: 16, formal: 4 },
          { date: '06/02', friendly: 0, administrative: 0, formal: 18 }
        ]
      };

      setData(mockData);
    } catch (error) {
      console.error('Erro ao carregar dados de desempenho:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando dados de desempenho...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600">Erro ao carregar dados</p>
        </div>
      </div>
    );
  }

  const stageMetrics = data.metrics.map(m => ({
    ...m,
    stageName: STAGE_NAMES[m.stage as keyof typeof STAGE_NAMES]
  }));

  const chartData = stageMetrics.map(m => ({
    name: m.stageName,
    'Taxa de Resposta': m.responseRate,
    'Taxa de Conversão': m.conversionRate,
    'Mensagens Entregues': (m.delivered / m.totalSent) * 100
  }));

  const deliveryData = stageMetrics.map(m => ({
    name: m.stageName,
    'Enviadas': m.totalSent,
    'Entregues': m.delivered,
    'Lidas': m.read,
    'Respondidas': m.responded
  }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            📊 Desempenho de Cobrança
          </h1>
          <p className="text-slate-600">
            Acompanhe o desempenho das etapas de cobrança em tempo real
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex gap-2 mb-6">
          {['7', '30', '90'].map(p => (
            <Button
              key={p}
              variant={period === p ? 'default' : 'outline'}
              onClick={() => setPeriod(p)}
            >
              Últimos {p} dias
            </Button>
          ))}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">
                Total de Clientes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">
                {data.totalClients}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Clientes em cobrança
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">
                Total de Mensagens
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">
                {data.totalMessages}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Mensagens enviadas
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">
                Taxa de Resposta
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">
                {data.overallResponseRate.toFixed(1)}%
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {data.totalResponses} respostas
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">
                Taxa de Conversão
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">
                {data.overallConversionRate.toFixed(1)}%
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {data.totalConversions} pagamentos
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Performance by Stage */}
          <Card>
            <CardHeader>
              <CardTitle>Desempenho por Etapa</CardTitle>
              <CardDescription>
                Taxa de resposta e conversão por etapa
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Taxa de Resposta" fill="#10b981" />
                  <Bar dataKey="Taxa de Conversão" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Message Delivery Status */}
          <Card>
            <CardHeader>
              <CardTitle>Status de Entrega</CardTitle>
              <CardDescription>
                Progressão de mensagens por etapa
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={deliveryData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Enviadas" fill="#94a3b8" />
                  <Bar dataKey="Entregues" fill="#10b981" />
                  <Bar dataKey="Lidas" fill="#3b82f6" />
                  <Bar dataKey="Respondidas" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Time Series */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Evolução de Mensagens Enviadas</CardTitle>
            <CardDescription>
              Histórico de envios por etapa ao longo do tempo
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="friendly"
                  stroke={STAGE_COLORS.friendly}
                  name="Amigável"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="administrative"
                  stroke={STAGE_COLORS.administrative}
                  name="Administrativa"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="formal"
                  stroke={STAGE_COLORS.formal}
                  name="Formal"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Detailed Metrics Table */}
        <Card>
          <CardHeader>
            <CardTitle>Métricas Detalhadas por Etapa</CardTitle>
            <CardDescription>
              Análise completa de cada etapa de cobrança
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-900">
                      Etapa
                    </th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-900">
                      Enviadas
                    </th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-900">
                      Entregues
                    </th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-900">
                      Lidas
                    </th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-900">
                      Respondidas
                    </th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-900">
                      Conversões
                    </th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-900">
                      Taxa Resposta
                    </th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-900">
                      Taxa Conversão
                    </th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-900">
                      Tempo Médio
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stageMetrics.map(metric => (
                    <tr key={metric.stage} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold">
                        <span
                          className="inline-block w-3 h-3 rounded-full mr-2"
                          style={{
                            backgroundColor:
                              STAGE_COLORS[metric.stage as keyof typeof STAGE_COLORS]
                          }}
                        ></span>
                        {metric.stageName}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {metric.totalSent}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {metric.delivered} ({((metric.delivered / metric.totalSent) * 100).toFixed(0)}%)
                      </td>
                      <td className="px-4 py-3 text-center">
                        {metric.read} ({((metric.read / metric.totalSent) * 100).toFixed(0)}%)
                      </td>
                      <td className="px-4 py-3 text-center">
                        {metric.responded}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-green-600">
                        {metric.converted}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          {metric.responseRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block bg-green-100 text-green-800 px-2 py-1 rounded">
                          {metric.conversionRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {metric.avgResponseTime.toFixed(1)}h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Insights */}
        <Card className="mt-8 bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-600" />
              Insights e Recomendações
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-slate-900">
                  Etapa Formal tem melhor taxa de conversão
                </p>
                <p className="text-sm text-slate-600">
                  A etapa Formal apresenta 27.3% de taxa de conversão, a mais alta entre as etapas.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-slate-900">
                  Oportunidade na etapa Administrativa
                </p>
                <p className="text-sm text-slate-600">
                  A taxa de resposta é 38.9%, mas apenas 22.2% convertem. Considere ajustar a mensagem.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <TrendingUp className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-slate-900">
                  Tempo de resposta diminui nas etapas posteriores
                </p>
                <p className="text-sm text-slate-600">
                  Clientes respondem mais rápido na etapa Formal (1.2h) comparado à Amigável (2.5h).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
