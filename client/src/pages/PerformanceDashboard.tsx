import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, MessageSquare, CheckCircle, Clock, DollarSign } from 'lucide-react';
import { trpc } from '@/lib/trpc';

/**
 * Dashboard de Performance do Agente de Cobrança
 * Exibe métricas de taxa de resposta, tempo de resolução e valor recuperado
 */

export default function PerformanceDashboard() {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');
  
  // Buscar métricas gerais
  const overallMetricsMutation = trpc.metrics.getOverallMetrics.useMutation();
  const loadingOverall = overallMetricsMutation.isPending;
  
  // Chamar mutation ao carregar
  useEffect(() => {
    overallMetricsMutation.mutate({});
  }, []);
  
  const overallMetrics = overallMetricsMutation.data;
  
  // Buscar métricas por tipo de mensagem
  const { data: metricsByType, isLoading: loadingByType } = trpc.metrics.getMetricsByMessageType.useQuery();
  
  // Buscar métricas diárias
  const { data: dailyMetrics, isLoading: loadingDaily } = trpc.metrics.getDailyMetrics.useQuery({
    days: timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
  });
  
  // Buscar tempo de resposta
  const { data: responseTimeMetrics, isLoading: loadingResponseTime } = trpc.metrics.getResponseTimeMetrics.useQuery();

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  if (loadingOverall || loadingByType || loadingDaily || loadingResponseTime) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando métricas de performance...</p>
        </div>
      </div>
    );
  }

  // Preparar dados para gráfico de métricas diárias
  const dailyChartData = dailyMetrics?.metrics?.map((item: any) => ({
    date: new Date(item.date).toLocaleDateString('pt-BR'),
    sent: item.totalSent || 0,
    delivered: item.totalDelivered || 0,
    responses: item.totalResponses || 0,
    agreed: item.totalAgreed || 0,
    paid: item.totalPaid || 0
  })) || [];

  // Preparar dados para gráfico de tipos de mensagem
  const messageTypeData = metricsByType?.metrics?.map((item: any) => ({
    name: item.messageType === 'friendly' ? 'Amigável' : 
           item.messageType === 'administrative' ? 'Administrativa' : 'Formal',
    value: item.totalSent || 0,
    responses: item.totalResponses || 0,
    agreed: item.totalAgreed || 0
  })) || [];

  // Preparar dados para tempo de resposta
  const responseTimeData = responseTimeMetrics?.metrics?.map((item: any) => ({
    type: item.messageType === 'friendly' ? 'Amigável' : 
          item.messageType === 'administrative' ? 'Administrativa' : 'Formal',
    avg: Math.round(item.avgResponseTime || 0),
    min: Math.round(item.minResponseTime || 0),
    max: Math.round(item.maxResponseTime || 0)
  })) || [];

  const metrics = overallMetrics?.metrics || {
    totalMessagesSent: 0,
    totalDelivered: 0,
    totalRead: 0,
    totalResponses: 0,
    totalAgreed: 0,
    totalPaid: 0,
    totalRejected: 0,
    deliveryRate: '0.00',
    responseRate: '0.00',
    conversionRate: '0.00'
  };

  return (
    <div className="space-y-6 p-6">
      {/* Cabeçalho */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Dashboard de Performance</h1>
          <p className="text-muted-foreground mt-2">Métricas do Agente de Cobrança</p>
        </div>
        <div className="flex gap-2">
          {(['7d', '30d', '90d'] as const).map(range => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                timeRange === range
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {range === '7d' ? '7 dias' : range === '30d' ? '30 dias' : '90 dias'}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Taxa de Entrega */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Entrega</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{String(metrics.deliveryRate)}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              {String(metrics.totalDelivered)} de {String(metrics.totalMessagesSent)} mensagens
            </p>
          </CardContent>
        </Card>

        {/* Taxa de Resposta */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Resposta</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{String(metrics.responseRate)}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              {String(metrics.totalResponses)} respostas recebidas
            </p>
          </CardContent>
        </Card>

        {/* Taxa de Conversão */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Conversão</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{String(metrics.conversionRate)}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              {String(metrics.totalAgreed)} acordos realizados
            </p>
          </CardContent>
        </Card>

        {/* Pagamentos Recebidos */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pagamentos</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{String(metrics.totalPaid)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              pagamentos confirmados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Evolução de Mensagens */}
        <Card>
          <CardHeader>
            <CardTitle>Evolução de Mensagens</CardTitle>
            <CardDescription>Mensagens enviadas, entregues e respondidas</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dailyChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sent" stroke="#3b82f6" name="Enviadas" />
                <Line type="monotone" dataKey="delivered" stroke="#10b981" name="Entregues" />
                <Line type="monotone" dataKey="responses" stroke="#f59e0b" name="Respostas" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Distribuição por Tipo de Mensagem */}
        <Card>
          <CardHeader>
            <CardTitle>Distribuição por Tipo</CardTitle>
            <CardDescription>Mensagens enviadas por faixa de escalação</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={messageTypeData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {messageTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Resultados por Tipo */}
        <Card>
          <CardHeader>
            <CardTitle>Resultados por Tipo de Mensagem</CardTitle>
            <CardDescription>Respostas e acordos por faixa</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={messageTypeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="responses" fill="#3b82f6" name="Respostas" />
                <Bar dataKey="agreed" fill="#10b981" name="Acordos" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Tempo de Resposta */}
        <Card>
          <CardHeader>
            <CardTitle>Tempo de Resposta (minutos)</CardTitle>
            <CardDescription>Tempo médio, mínimo e máximo por tipo</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={responseTimeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="type" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="avg" fill="#3b82f6" name="Média" />
                <Bar dataKey="min" fill="#10b981" name="Mínimo" />
                <Bar dataKey="max" fill="#ef4444" name="Máximo" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Resumo de Resultados */}
      <Card>
        <CardHeader>
          <CardTitle>Resumo de Resultados</CardTitle>
          <CardDescription>Estatísticas gerais de performance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Total Enviadas</p>
              <p className="text-2xl font-bold">{String(metrics.totalMessagesSent)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Total Entregues</p>
              <p className="text-2xl font-bold">{String(metrics.totalDelivered)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Total Lidas</p>
              <p className="text-2xl font-bold">{String(metrics.totalRead)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Acordos Realizados</p>
              <p className="text-2xl font-bold">{String(metrics.totalAgreed)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Pagamentos Recebidos</p>
              <p className="text-2xl font-bold">{String(metrics.totalPaid)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Rejeições</p>
              <p className="text-2xl font-bold">{String(metrics.totalRejected)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Taxa Entrega</p>
              <p className="text-2xl font-bold">{String(metrics.deliveryRate)}%</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Taxa Resposta</p>
              <p className="text-2xl font-bold">{String(metrics.responseRate)}%</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
