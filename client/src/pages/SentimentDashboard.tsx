import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, MessageCircle, Smile, Frown, Meh } from "lucide-react";

// Dados simulados para demonstração
const mockSentimentData = [
  {
    date: "2026-02-01",
    positive: 5,
    negative: 2,
    neutral: 3,
    mixed: 1,
  },
  {
    date: "2026-02-02",
    positive: 8,
    negative: 1,
    neutral: 2,
    mixed: 2,
  },
  {
    date: "2026-02-03",
    positive: 6,
    negative: 3,
    neutral: 4,
    mixed: 1,
  },
  {
    date: "2026-02-04",
    positive: 9,
    negative: 2,
    neutral: 3,
    mixed: 0,
  },
  {
    date: "2026-02-05",
    positive: 7,
    negative: 4,
    neutral: 2,
    mixed: 2,
  },
  {
    date: "2026-02-06",
    positive: 10,
    negative: 1,
    neutral: 3,
    mixed: 1,
  },
];

const mockClientSentiments = [
  {
    id: 1,
    name: "R7 GERADORES LTDA",
    lastMessage: "Vou pagar amanhã, sem problema!",
    sentiment: "positive",
    score: 0.95,
    date: "2026-02-06",
    suggestedAction: "wait_and_retry",
    suggestedTone: "friendly",
  },
  {
    id: 2,
    name: "ACAI LEPPAUS E SOUZA LTDA",
    lastMessage: "Não tenho como pagar agora",
    sentiment: "negative",
    score: 0.82,
    date: "2026-02-05",
    suggestedAction: "escalate",
    suggestedTone: "formal",
  },
  {
    id: 3,
    name: "ACOS CAPIXABA LTDA",
    lastMessage: "Qual é o valor exato?",
    sentiment: "neutral",
    score: 0.68,
    date: "2026-02-04",
    suggestedAction: "provide_info",
    suggestedTone: "administrative",
  },
  {
    id: 4,
    name: "A.C. XAVIER",
    lastMessage: "Já paguei, confere aí!",
    sentiment: "positive",
    score: 0.88,
    date: "2026-02-03",
    suggestedAction: "verify_payment",
    suggestedTone: "friendly",
  },
];

const sentimentColors = {
  positive: "#10b981",
  negative: "#ef4444",
  neutral: "#6b7280",
  mixed: "#f59e0b",
};

const sentimentLabels = {
  positive: "Positivo",
  negative: "Negativo",
  neutral: "Neutro",
  mixed: "Misto",
};

const sentimentIcons = {
  positive: <Smile className="w-4 h-4" />,
  negative: <Frown className="w-4 h-4" />,
  neutral: <Meh className="w-4 h-4" />,
  mixed: <MessageCircle className="w-4 h-4" />,
};

export default function SentimentDashboard() {
  const [selectedClient, setSelectedClient] = useState<typeof mockClientSentiments[0] | null>(null);

  // Calcular estatísticas
  const stats = useMemo(() => {
    const total = mockClientSentiments.length;
    const positive = mockClientSentiments.filter((c) => c.sentiment === "positive").length;
    const negative = mockClientSentiments.filter((c) => c.sentiment === "negative").length;
    const neutral = mockClientSentiments.filter((c) => c.sentiment === "neutral").length;
    const avgScore =
      mockClientSentiments.reduce((sum, c) => sum + c.score, 0) / total;

    return {
      total,
      positive,
      negative,
      neutral,
      avgScore: (avgScore * 100).toFixed(1),
      positiveRate: ((positive / total) * 100).toFixed(0),
    };
  }, []);

  // Dados para gráfico de pizza
  const pieData = [
    { name: "Positivo", value: stats.positive },
    { name: "Negativo", value: stats.negative },
    { name: "Neutro", value: stats.neutral },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard de Sentimento</h1>
        <p className="text-gray-600 mt-2">
          Análise de sentimento das respostas de clientes
        </p>
      </div>

      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total de Respostas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-gray-600 mt-1">Clientes analisados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Smile className="w-4 h-4 text-green-500" />
              Taxa Positiva
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.positiveRate}%</div>
            <p className="text-xs text-gray-600 mt-1">{stats.positive} respostas positivas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Score Médio</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgScore}%</div>
            <p className="text-xs text-gray-600 mt-1">Confiança média</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Ações Sugeridas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-gray-600 mt-1">Próximas ações</p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico de Linha - Tendência */}
        <Card>
          <CardHeader>
            <CardTitle>Tendência de Sentimento</CardTitle>
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
                <Line
                  type="monotone"
                  dataKey="positive"
                  stroke={sentimentColors.positive}
                  name="Positivo"
                />
                <Line
                  type="monotone"
                  dataKey="negative"
                  stroke={sentimentColors.negative}
                  name="Negativo"
                />
                <Line
                  type="monotone"
                  dataKey="neutral"
                  stroke={sentimentColors.neutral}
                  name="Neutro"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Gráfico de Pizza - Distribuição */}
        <Card>
          <CardHeader>
            <CardTitle>Distribuição de Sentimentos</CardTitle>
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
                            : sentimentColors.neutral
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
      <Card>
        <CardHeader>
          <CardTitle>Ações Sugeridas por Tipo</CardTitle>
          <CardDescription>Próximos passos recomendados</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={[
                { name: "Aguardar", value: 3 },
                { name: "Escalar", value: 2 },
                { name: "Informar", value: 1 },
                { name: "Verificar", value: 1 },
              ]}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Histórico de Clientes */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Análises</CardTitle>
          <CardDescription>Últimas respostas analisadas</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {mockClientSentiments.map((client) => (
              <div
                key={client.id}
                className="flex items-start justify-between p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition"
                onClick={() => setSelectedClient(client)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold">{client.name}</h3>
                    <Badge
                      variant="outline"
                      className={`flex items-center gap-1 ${
                        client.sentiment === "positive"
                          ? "bg-green-100 text-green-800"
                          : client.sentiment === "negative"
                            ? "bg-red-100 text-red-800"
                            : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {sentimentIcons[client.sentiment as keyof typeof sentimentIcons]}
                      {sentimentLabels[client.sentiment as keyof typeof sentimentLabels]}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600 italic">"{client.lastMessage}"</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                    <span>Score: {(client.score * 100).toFixed(0)}%</span>
                    <span>{client.date}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-blue-600 mb-1">
                    {client.suggestedTone === "friendly"
                      ? "Amigável"
                      : client.suggestedTone === "administrative"
                        ? "Administrativo"
                        : "Formal"}
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {client.suggestedAction === "wait_and_retry"
                      ? "Aguardar"
                      : client.suggestedAction === "escalate"
                        ? "Escalar"
                        : client.suggestedAction === "provide_info"
                          ? "Informar"
                          : "Verificar"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Detalhes do Cliente Selecionado */}
      {selectedClient && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle>Detalhes da Análise</CardTitle>
            <CardDescription>{selectedClient.name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600">Sentimento</p>
                <p className="text-lg font-semibold">
                  {sentimentLabels[selectedClient.sentiment as keyof typeof sentimentLabels]}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Score de Confiança</p>
                <p className="text-lg font-semibold">
                  {(selectedClient.score * 100).toFixed(0)}%
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Ação Sugerida</p>
                <p className="text-lg font-semibold">
                  {selectedClient.suggestedAction === "wait_and_retry"
                    ? "Aguardar e Fazer Retry"
                    : selectedClient.suggestedAction === "escalate"
                      ? "Escalar"
                      : selectedClient.suggestedAction === "provide_info"
                        ? "Fornecer Informação"
                        : "Verificar Pagamento"}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Tom Sugerido</p>
                <p className="text-lg font-semibold">
                  {selectedClient.suggestedTone === "friendly"
                    ? "Amigável"
                    : selectedClient.suggestedTone === "administrative"
                      ? "Administrativo"
                      : "Formal"}
                </p>
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-2">Mensagem Recebida</p>
              <p className="p-3 bg-white rounded border italic">"{selectedClient.lastMessage}"</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
