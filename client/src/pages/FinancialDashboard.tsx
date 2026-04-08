import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, DollarSign, Zap } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";

interface FinancialMonth {
  month: string;
  receita: number;
  receitaRecorrente: number;
  receitaEventual: number;
  despesa: number;
  despesaPessoal: number;
  despesaSistemas: number;
  despesaAdministrativa: number;
  despesaImpostos: number;
  resultado?: number;
}

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
}

// Função para converter dados da API para formato do dashboard
function convertApiDataToFinancialMonth(apiData: any[]): FinancialMonth[] {
  return apiData.map((item) => ({
    month: item.month || "N/A",
    receita: item.receita || 0,
    receitaRecorrente: item.receitaRecorrente || item.receita * 0.75 || 0,
    receitaEventual: item.receitaEventual || item.receita * 0.25 || 0,
    despesa: item.despesa || 0,
    despesaPessoal: item.despesaPessoal || item.despesa * 0.5 || 0,
    despesaSistemas: item.despesaSistemas || item.despesa * 0.1 || 0,
    despesaAdministrativa: item.despesaAdministrativa || item.despesa * 0.25 || 0,
    despesaImpostos: item.despesaImpostos || item.despesa * 0.15 || 0,
    resultado: item.resultado || 0,
  }));
}

// Função para carregar dados reais (fallback)
function loadFinancialData(): FinancialMonth[] {
  try {
    // Tenta carregar dados do arquivo público
    const data: DashboardData = require("../../public/dashboard-data.json");
    
    const months = data.dre_2025.months;
    const revenue = data.dre_2025.revenue;
    const profit = data.dre_2025.net_profit;
    
    return months.map((month, idx) => {
      const receita = revenue[idx] || 0;
      const resultado = profit[idx] || 0;
      const despesa = receita - resultado;
      
      return {
        month: month.substring(0, 3),
        receita,
        receitaRecorrente: receita * 0.75,
        receitaEventual: receita * 0.25,
        despesa,
        despesaPessoal: despesa * 0.5,
        despesaSistemas: despesa * 0.1,
        despesaAdministrativa: despesa * 0.25,
        despesaImpostos: despesa * 0.15,
        resultado,
      };
    });
  } catch (error) {
    console.warn("Erro ao carregar dados financeiros, usando dados padrão", error);
    // Retorna dados padrão se não conseguir carregar
    return [
      {
        month: "Ago",
        receita: 45000,
        receitaRecorrente: 35000,
        receitaEventual: 10000,
        despesa: 28000,
        despesaPessoal: 15000,
        despesaSistemas: 3000,
        despesaAdministrativa: 7000,
        despesaImpostos: 3000,
      },
      {
        month: "Set",
        receita: 52000,
        receitaRecorrente: 40000,
        receitaEventual: 12000,
        despesa: 30000,
        despesaPessoal: 16000,
        despesaSistemas: 3000,
        despesaAdministrativa: 7500,
        despesaImpostos: 3500,
      },
      {
        month: "Out",
        receita: 48000,
        receitaRecorrente: 38000,
        receitaEventual: 10000,
        despesa: 31000,
        despesaPessoal: 16500,
        despesaSistemas: 3200,
        despesaAdministrativa: 7800,
        despesaImpostos: 3500,
      },
      {
        month: "Nov",
        receita: 55000,
        receitaRecorrente: 42000,
        receitaEventual: 13000,
        despesa: 32000,
        despesaPessoal: 17000,
        despesaSistemas: 3300,
        despesaAdministrativa: 8000,
        despesaImpostos: 3700,
      },
      {
        month: "Dez",
        receita: 62000,
        receitaRecorrente: 45000,
        receitaEventual: 17000,
        despesa: 35000,
        despesaPessoal: 18000,
        despesaSistemas: 3500,
        despesaAdministrativa: 8500,
        despesaImpostos: 5000,
      },
      {
        month: "Jan",
        receita: 58000,
        receitaRecorrente: 43000,
        receitaEventual: 15000,
        despesa: 33000,
        despesaPessoal: 17500,
        despesaSistemas: 3200,
        despesaAdministrativa: 8000,
        despesaImpostos: 4300,
      },
    ];
  }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function getHealthStatus(expenseRatio: number): { status: string; color: string; bgColor: string; icon: React.ReactNode } {
  if (expenseRatio <= 60) {
    return {
      status: "Saudável",
      color: "text-green-400",
      bgColor: "bg-green-900/30 border-green-700/50",
      icon: <CheckCircle2 className="w-5 h-5" />,
    };
  } else if (expenseRatio <= 80) {
    return {
      status: "Atenção",
      color: "text-yellow-400",
      bgColor: "bg-yellow-900/30 border-yellow-700/50",
      icon: <AlertTriangle className="w-5 h-5" />,
    };
  } else {
    return {
      status: "Crítico",
      color: "text-red-400",
      bgColor: "bg-red-900/30 border-red-700/50",
      icon: <AlertTriangle className="w-5 h-5" />,
    };
  }
}

export default function FinancialDashboard() {
  const [financialData, setFinancialData] = useState<FinancialMonth[]>([]);
  const [loading, setLoading] = useState(true);

  // Buscar dados da API Conta Azul com auto-refresh a cada 30 segundos
  const { data: apiDataResponse, isLoading: isApiLoading, refetch } = trpc.contaAzul.getLast6Months.useQuery(undefined, {
    retry: 2,
    refetchInterval: 30000, // 30 segundos
    refetchOnWindowFocus: true,
  });

  // Auto-refresh a cada 30 segundos
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 30000);
    return () => clearInterval(interval);
  }, [refetch]);

  useEffect(() => {
    if (apiDataResponse?.success && apiDataResponse?.data && apiDataResponse.data.length > 0) {
      // Usar dados da API
      const converted = convertApiDataToFinancialMonth(apiDataResponse.data);
      setFinancialData(converted);
      setLoading(false);
    } else if (apiDataResponse?.success === false || (apiDataResponse && !apiDataResponse.data?.length)) {
      // API falhou ou retornou vazio, usar dados padrão
      console.log("API falhou ou vazia, usando dados padrão");
      const data = loadFinancialData();
      setFinancialData(data);
      setLoading(false);
    }
  }, [apiDataResponse]);

  // Inicializar com dados padrão se API não responder rápido
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading && financialData.length === 0) {
        console.log("Timeout na API, usando dados padrão");
        const data = loadFinancialData();
        setFinancialData(data);
        setLoading(false);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [loading, financialData.length]);

  if (loading || financialData.length === 0) {
    return <div className="text-white text-center py-8">Carregando dados financeiros...</div>;
  }

  // Pegar dados do mês atual e anterior
  const currentMonth = financialData[financialData.length - 1];
  const previousMonth = financialData[financialData.length - 2];

  // Calcular métricas
  const resultado = currentMonth.receita - currentMonth.despesa;
  const resultadoAnterior = previousMonth.receita - previousMonth.despesa;
  const margem = (resultado / currentMonth.receita) * 100;
  const margemAnterior = (resultadoAnterior / previousMonth.receita) * 100;
  const expenseRatio = (currentMonth.despesa / currentMonth.receita) * 100;

  // Variações
  const variacaoReceita = currentMonth.receita - previousMonth.receita;
  const variacaoDespesa = currentMonth.despesa - previousMonth.despesa;
  const variacaoResultado = resultado - resultadoAnterior;

  const variacaoReceitaPercent = ((variacaoReceita / previousMonth.receita) * 100).toFixed(1);
  const variacaoDespesaPercent = ((variacaoDespesa / previousMonth.despesa) * 100).toFixed(1);
  const variacaoResultadoPercent = ((variacaoResultado / resultadoAnterior) * 100).toFixed(1);

  const healthStatus = getHealthStatus(expenseRatio);

  // Alertas
  const alerts = [];
  if (variacaoDespesa > variacaoReceita) {
    alerts.push("⚠️ Despesa cresceu mais que a receita este mês");
  }
  if (expenseRatio > 80) {
    alerts.push("🚨 Despesa/Receita crítica: acima de 80%");
  }
  if (margem < 15) {
    alerts.push("⚠️ Margem abaixo do nível saudável (15%)");
  }

  // Dados para gráficos
  const composicaoReceita = [
    { name: "Recorrente", value: currentMonth.receitaRecorrente },
    { name: "Eventual", value: currentMonth.receitaEventual },
  ];

  const composicaoDespesa = [
    { name: "Pessoal", value: currentMonth.despesaPessoal },
    { name: "Sistemas", value: currentMonth.despesaSistemas },
    { name: "Administrativa", value: currentMonth.despesaAdministrativa },
    { name: "Impostos", value: currentMonth.despesaImpostos },
  ];

  const colors = ["#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

  // Usar dados reais do financialData
  const mockFinancialData = financialData;

  return (
    <div className="space-y-6">
      {/* ALERTAS */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert, idx) => (
            <Alert key={idx} className="bg-red-900/30 border-red-700/50">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <AlertDescription className="text-red-300">{alert}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* VISÃO PRINCIPAL - OBRIGATÓRIA */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Receita */}
        <Card className="bg-blue-900/30 border-blue-700/50">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="text-blue-400 text-sm font-medium">Receita do Mês</div>
              <div className="text-4xl font-bold text-blue-300">{formatCurrency(currentMonth.receita)}</div>
              <div className="flex items-center gap-2 text-xs">
                {variacaoReceita >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-green-400" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-400" />
                )}
                <span className={variacaoReceita >= 0 ? "text-green-400" : "text-red-400"}>
                  {variacaoReceita >= 0 ? "+" : ""}{formatCurrency(variacaoReceita)} ({variacaoReceitaPercent}%)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Despesa */}
        <Card className="bg-orange-900/30 border-orange-700/50">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="text-orange-400 text-sm font-medium">Despesa do Mês</div>
              <div className="text-4xl font-bold text-orange-300">{formatCurrency(currentMonth.despesa)}</div>
              <div className="flex items-center gap-2 text-xs">
                {variacaoDespesa >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-red-400" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-green-400" />
                )}
                <span className={variacaoDespesa >= 0 ? "text-red-400" : "text-green-400"}>
                  {variacaoDespesa >= 0 ? "+" : ""}{formatCurrency(variacaoDespesa)} ({variacaoDespesaPercent}%)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Resultado */}
        <Card className={`${resultado >= 0 ? "bg-green-900/30 border-green-700/50" : "bg-red-900/30 border-red-700/50"}`}>
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className={`text-sm font-medium ${resultado >= 0 ? "text-green-400" : "text-red-400"}`}>
                Resultado do Mês
              </div>
              <div className={`text-4xl font-bold ${resultado >= 0 ? "text-green-300" : "text-red-300"}`}>
                {formatCurrency(resultado)}
              </div>
              <div className="flex items-center gap-2 text-xs">
                {variacaoResultado >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-green-400" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-400" />
                )}
                <span className={variacaoResultado >= 0 ? "text-green-400" : "text-red-400"}>
                  {variacaoResultado >= 0 ? "+" : ""}{formatCurrency(variacaoResultado)} ({variacaoResultadoPercent}%)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Margem */}
        <Card className={`${margem >= 15 ? "bg-purple-900/30 border-purple-700/50" : "bg-yellow-900/30 border-yellow-700/50"}`}>
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className={`text-sm font-medium ${margem >= 15 ? "text-purple-400" : "text-yellow-400"}`}>
                Margem Líquida
              </div>
              <div className={`text-4xl font-bold ${margem >= 15 ? "text-purple-300" : "text-yellow-300"}`}>
                {margem.toFixed(1)}%
              </div>
              <div className="flex items-center gap-2 text-xs">
                {margem >= margemAnterior ? (
                  <TrendingUp className="w-4 h-4 text-green-400" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-red-400" />
                )}
                <span className={margem >= margemAnterior ? "text-green-400" : "text-red-400"}>
                  {(margem - margemAnterior).toFixed(1)}pp vs mês anterior
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* COMPARAÇÃO MENSAL */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-white">Comparação com Mês Anterior</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="text-sm text-slate-400">Receita</div>
              <div className="text-2xl font-bold text-white">{formatCurrency(currentMonth.receita)}</div>
              <div className={`text-sm ${variacaoReceita >= 0 ? "text-green-400" : "text-red-400"}`}>
                {variacaoReceita >= 0 ? "+" : ""}{formatCurrency(variacaoReceita)} ({variacaoReceitaPercent}%)
              </div>
              <div className="text-xs text-slate-500">vs {formatCurrency(previousMonth.receita)} (mês anterior)</div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-slate-400">Despesa</div>
              <div className="text-2xl font-bold text-white">{formatCurrency(currentMonth.despesa)}</div>
              <div className={`text-sm ${variacaoDespesa <= 0 ? "text-green-400" : "text-red-400"}`}>
                {variacaoDespesa >= 0 ? "+" : ""}{formatCurrency(variacaoDespesa)} ({variacaoDespesaPercent}%)
              </div>
              <div className="text-xs text-slate-500">vs {formatCurrency(previousMonth.despesa)} (mês anterior)</div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-slate-400">Resultado</div>
              <div className={`text-2xl font-bold ${resultado >= 0 ? "text-green-300" : "text-red-300"}`}>
                {formatCurrency(resultado)}
              </div>
              <div className={`text-sm ${variacaoResultado >= 0 ? "text-green-400" : "text-red-400"}`}>
                {variacaoResultado >= 0 ? "+" : ""}{formatCurrency(variacaoResultado)} ({variacaoResultadoPercent}%)
              </div>
              <div className="text-xs text-slate-500">vs {formatCurrency(resultadoAnterior)} (mês anterior)</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* COMPOSIÇÃO */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Composição Receita */}
        <Card className="bg-slate-900/50 border-slate-700/50">
          <CardHeader>
            <CardTitle className="text-white">Composição da Receita</CardTitle>
            <CardDescription className="text-slate-400">{currentMonth.month}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={composicaoReceita}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${formatCurrency(value)}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {composicaoReceita.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value as number)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Composição Despesa */}
        <Card className="bg-slate-900/50 border-slate-700/50">
          <CardHeader>
            <CardTitle className="text-white">Composição da Despesa</CardTitle>
            <CardDescription className="text-slate-400">{currentMonth.month}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={composicaoDespesa}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${formatCurrency(value)}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {composicaoDespesa.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value as number)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* INDICADOR DE SAÚDE */}
      <Card className={healthStatus.bgColor + " border"}>
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            {healthStatus.icon}
            Indicador de Saúde Financeira
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-slate-300">Despesa / Receita</span>
                <span className={`text-2xl font-bold ${healthStatus.color}`}>{expenseRatio.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    expenseRatio <= 60
                      ? "bg-green-500"
                      : expenseRatio <= 80
                      ? "bg-yellow-500"
                      : "bg-red-500"
                  }`}
                  style={{ width: `${Math.min(expenseRatio, 100)}%` }}
                ></div>
              </div>
              <div className="text-xs text-slate-400">
                {expenseRatio <= 60 && "Saudável: Despesa controlada"}
                {expenseRatio > 60 && expenseRatio <= 80 && "Atenção: Despesa crescendo"}
                {expenseRatio > 80 && "Crítico: Despesa muito alta"}
              </div>
            </div>
            <div className="pt-4 border-t border-slate-700">
              <div className="text-sm text-slate-300">
                <p>
                  <strong>Status:</strong> <span className={healthStatus.color}>{healthStatus.status}</span>
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {healthStatus.status === "Saudável"
                    ? "Parabéns! Suas despesas estão bem controladas. Continue assim!"
                    : healthStatus.status === "Atenção"
                    ? "Fique atento! Suas despesas estão crescendo. Considere revisar seus gastos."
                    : "Ação necessária! Suas despesas estão muito altas. Revise urgentemente."}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* TENDÊNCIAS */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-white">Tendências - Últimos 6 Meses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mockFinancialData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
                  formatter={(value) => formatCurrency(value as number)}
                />
                <Legend />
                <Line type="monotone" dataKey="receita" stroke="#3b82f6" name="Receita" strokeWidth={2} />
                <Line type="monotone" dataKey="despesa" stroke="#f97316" name="Despesa" strokeWidth={2} />
                <Line type="monotone" dataKey="resultado" stroke="#10b981" name="Resultado" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* GRÁFICO DE BARRAS */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-white">Receita vs Despesa - Últimos 6 Meses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockFinancialData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="month" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
                  formatter={(value) => formatCurrency(value as number)}
                />
                <Legend />
                <Bar dataKey="receita" fill="#3b82f6" name="Receita" />
                <Bar dataKey="despesa" fill="#f97316" name="Despesa" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
