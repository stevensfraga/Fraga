import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface SentimentAnalysisProps {
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  sentimentScore: number;
  explanation: string;
  suggestedAction: string;
  actionConfidence: number;
  suggestedNextTone: "friendly" | "administrative" | "formal" | "escalate";
  reasoning?: string;
}

export function SentimentAnalysisCard({
  sentiment,
  sentimentScore,
  explanation,
  suggestedAction,
  actionConfidence,
  suggestedNextTone,
  reasoning,
}: SentimentAnalysisProps) {
  // Cores por sentimento
  const sentimentColors: Record<string, string> = {
    positive: "bg-green-100 text-green-800 border-green-300",
    negative: "bg-red-100 text-red-800 border-red-300",
    neutral: "bg-gray-100 text-gray-800 border-gray-300",
    mixed: "bg-yellow-100 text-yellow-800 border-yellow-300",
  };

  const sentimentIcons: Record<string, React.ReactNode> = {
    positive: "😊",
    negative: "😞",
    neutral: "😐",
    mixed: "🤔",
  };

  const toneColors: Record<string, string> = {
    friendly: "bg-blue-100 text-blue-800",
    administrative: "bg-orange-100 text-orange-800",
    formal: "bg-red-100 text-red-800",
    escalate: "bg-purple-100 text-purple-800",
  };

  const actionLabels: Record<string, string> = {
    send_payment_link: "Enviar Link de Pagamento",
    schedule_call: "Agendar Ligação",
    offer_discount: "Oferecer Desconto",
    escalate_to_manager: "Escalar para Gerente",
    wait_and_retry: "Aguardar e Tentar Novamente",
    mark_as_paid: "Marcar como Pago",
    send_agreement: "Enviar Acordo",
  };

  const toneLabels: Record<string, string> = {
    friendly: "Amigável",
    administrative: "Administrativa",
    formal: "Formal",
    escalate: "Escalação",
  };

  return (
    <Card className="border-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-4xl">{sentimentIcons[sentiment]}</span>
            <div>
              <CardTitle>Análise de Sentimento</CardTitle>
              <CardDescription>{explanation}</CardDescription>
            </div>
          </div>
          <Badge className={`${sentimentColors[sentiment]} border`}>
            {sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Confiança da Análise */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">Confiança da Análise</label>
            <span className="text-sm font-semibold">
              {Math.round(sentimentScore * 100)}%
            </span>
          </div>
          <Progress value={sentimentScore * 100} className="h-2" />
        </div>

        {/* Ação Sugerida */}
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="font-semibold text-sm mb-1">Ação Sugerida</h4>
              <p className="text-sm text-gray-700 mb-3">
                {actionLabels[suggestedAction as keyof typeof actionLabels] ||
                  suggestedAction}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600">Confiança:</span>
                <div className="flex-1">
                  <Progress
                    value={actionConfidence * 100}
                    className="h-1.5"
                  />
                </div>
                <span className="text-xs font-semibold">
                  {Math.round(actionConfidence * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Próximo Tom Recomendado */}
        <div>
          <h4 className="font-semibold text-sm mb-3">Próximo Tom Recomendado</h4>
          <div className="flex gap-2">
            <Badge className={`${toneColors[suggestedNextTone]}`}>
              {toneLabels[suggestedNextTone as keyof typeof toneLabels] ||
                suggestedNextTone}
            </Badge>
            {suggestedNextTone === "escalate" && (
              <Badge variant="destructive">⚠️ Escalação Necessária</Badge>
            )}
          </div>
        </div>

        {/* Raciocínio (se disponível) */}
        {reasoning && (
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-sm mb-2 text-blue-900">
              Raciocínio da Análise
            </h4>
            <p className="text-sm text-blue-800">{reasoning}</p>
          </div>
        )}

        {/* Indicadores de Tendência */}
        <div className="grid grid-cols-3 gap-2 pt-4 border-t">
          <div className="text-center">
            {sentiment === "positive" && (
              <div className="flex flex-col items-center gap-1">
                <TrendingUp className="w-5 h-5 text-green-600" />
                <span className="text-xs text-gray-600">Tendência Positiva</span>
              </div>
            )}
            {sentiment === "negative" && (
              <div className="flex flex-col items-center gap-1">
                <TrendingDown className="w-5 h-5 text-red-600" />
                <span className="text-xs text-gray-600">Tendência Negativa</span>
              </div>
            )}
            {(sentiment === "neutral" || sentiment === "mixed") && (
              <div className="flex flex-col items-center gap-1">
                <Minus className="w-5 h-5 text-gray-600" />
                <span className="text-xs text-gray-600">Tendência Neutra</span>
              </div>
            )}
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-700">
              {Math.round(sentimentScore * 100)}
            </div>
            <span className="text-xs text-gray-600">Score</span>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {Math.round(actionConfidence * 100)}
            </div>
            <span className="text-xs text-gray-600">Confiança</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Componente para exibir histórico de análises
 */
interface SentimentHistoryProps {
  history: Array<{
    id: number;
    sentiment: string;
    score: number;
    explanation: string;
    responseText: string;
    date: Date;
  }>;
}

export function SentimentHistory({ history }: SentimentHistoryProps) {
  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Sentimentos</CardTitle>
          <CardDescription>Nenhuma análise disponível</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const sentimentIcons: Record<string, string> = {
    positive: "😊",
    negative: "😞",
    neutral: "😐",
    mixed: "🤔",
  };

  const sentimentColors: Record<string, string> = {
    positive: "bg-green-50 border-green-200",
    negative: "bg-red-50 border-red-200",
    neutral: "bg-gray-50 border-gray-200",
    mixed: "bg-yellow-50 border-yellow-200",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de Sentimentos</CardTitle>
        <CardDescription>
          Últimas {history.length} análises de resposta
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {history.map((item, idx) => (
            <div
              key={item.id}
              className={`p-3 rounded-lg border ${
                sentimentColors[item.sentiment as keyof typeof sentimentColors] ||
                "bg-gray-50 border-gray-200"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">
                  {sentimentIcons[item.sentiment as keyof typeof sentimentIcons] ||
                    "❓"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <Badge variant="outline" className="capitalize">
                      {item.sentiment}
                    </Badge>
                    <span className="text-xs text-gray-500">
                      {item.date
                        ? new Date(item.date).toLocaleDateString("pt-BR")
                        : "Data desconhecida"}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">
                    {item.explanation}
                  </p>
                  <p className="text-xs text-gray-600 italic line-clamp-2">
                    "{item.responseText}"
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={item.score * 100} className="h-1.5 flex-1" />
                    <span className="text-xs font-semibold text-gray-600">
                      {Math.round(item.score * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Componente para exibir tendência de sentimento
 */
interface SentimentTrendProps {
  trend: {
    dominantSentiment: string;
    averageScore: number;
    counts: Record<string, number>;
    trend: "improving" | "declining" | "stable";
  } | null;
}

export function SentimentTrend({ trend }: SentimentTrendProps) {
  if (!trend) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tendência de Sentimento</CardTitle>
          <CardDescription>Sem dados disponíveis</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const trendEmojis: Record<string, string> = {
    improving: "📈",
    declining: "📉",
    stable: "➡️",
  };

  const trendLabels: Record<string, string> = {
    improving: "Melhorando",
    declining: "Piorando",
    stable: "Estável",
  };

  const trendColors: Record<string, string> = {
    improving: "text-green-600 bg-green-50",
    declining: "text-red-600 bg-red-50",
    stable: "text-gray-600 bg-gray-50",
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Tendência de Sentimento</CardTitle>
            <CardDescription>
              Análise das últimas respostas do cliente
            </CardDescription>
          </div>
          <Badge className={`${trendColors[trend.trend]}`}>
            {trendEmojis[trend.trend]} {trendLabels[trend.trend]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Score Médio */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">Score Médio</label>
            <span className="text-lg font-bold">
              {Math.round(trend.averageScore * 100)}%
            </span>
          </div>
          <Progress value={trend.averageScore * 100} className="h-3" />
        </div>

        {/* Distribuição de Sentimentos */}
        <div>
          <h4 className="font-semibold text-sm mb-3">Distribuição</h4>
          <div className="space-y-2">
            {Object.entries(trend.counts).map(([sentiment, count]) => (
              <div key={sentiment} className="flex items-center gap-2">
                <span className="text-sm font-medium w-20 capitalize">
                  {sentiment}
                </span>
                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      sentiment === "positive"
                        ? "bg-green-500"
                        : sentiment === "negative"
                          ? "bg-red-500"
                          : sentiment === "neutral"
                            ? "bg-gray-500"
                            : "bg-yellow-500"
                    }`}
                    style={{
                      width: `${
                        (count /
                          Object.values(trend.counts).reduce(
                            (a, b) => a + b,
                            0
                          )) *
                        100
                      }%`,
                    }}
                  />
                </div>
                <span className="text-sm font-semibold w-8 text-right">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Sentimento Dominante */}
        <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-900">
            <span className="font-semibold">Sentimento Dominante:</span>{" "}
            {trend.dominantSentiment.charAt(0).toUpperCase() +
              trend.dominantSentiment.slice(1)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
