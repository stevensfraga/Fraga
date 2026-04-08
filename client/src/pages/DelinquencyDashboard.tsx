import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, TrendingUp, TrendingDown, Clock, Users, DollarSign, Target } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
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
import { useState, useEffect } from "react";

interface DelinquencyData {
  totalOverdue: number;
  totalClients: number;
  overdueByStageDays: {
    "0-15": number;
    "16-30": number;
    "31-45": number;
    "46-60": number;
    "60+": number;
  };
  overdueByStageDaysAmount: {
    "0-15": number;
    "16-30": number;
    "31-45": number;
    "46-60": number;
    "60+": number;
  };
  percentageOfRevenue: number;
  avgDaysOverdue: number;
  recoveryRate: number;
  alerts: string[];
}

// Dados padrão para demonstração
const defaultData: DelinquencyData = {
  totalOverdue: 202305.21,
  totalClients: 119,
  overdueByStageDays: {
    "0-15": 45,
    "16-30": 32,
    "31-45": 18,
    "46-60": 15,
    "60+": 9,
  },
  overdueByStageDaysAmount: {
    "0-15": 65000,
    "16-30": 48000,
    "31-45": 35000,
    "46-60": 32000,
    "60+": 22305.21,
  },
  percentageOfRevenue: 18.5,
  avgDaysOverdue: 22,
  recoveryRate: 68.5,
  alerts: [
    "🚨 Inadimplência acima de 15% da receita (18.5%)",
    "⚠️ 9 clientes com atraso superior a 60 dias",
    "⚠️ 47 clientes com atraso entre 16-60 dias",
  ],
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export default function DelinquencyDashboard() {
  const [data, setData] = useState<DelinquencyData>(defaultData);

  // Preparar dados para gráficos
  const stageData = [
    { range: "0-15 dias", clients: data.overdueByStageDays["0-15"], amount: data.overdueByStageDaysAmount["0-15"] },
    { range: "16-30 dias", clients: data.overdueByStageDays["16-30"], amount: data.overdueByStageDaysAmount["16-30"] },
    { range: "31-45 dias", clients: data.overdueByStageDays["31-45"], amount: data.overdueByStageDaysAmount["31-45"] },
    { range: "46-60 dias", clients: data.overdueByStageDays["46-60"], amount: data.overdueByStageDaysAmount["46-60"] },
    { range: "60+ dias", clients: data.overdueByStageDays["60+"], amount: data.overdueByStageDaysAmount["60+"] },
  ];

  const pieData = [
    { name: "0-15 dias", value: data.overdueByStageDays["0-15"] },
    { name: "16-30 dias", value: data.overdueByStageDays["16-30"] },
    { name: "31-45 dias", value: data.overdueByStageDays["31-45"] },
    { name: "46-60 dias", value: data.overdueByStageDays["46-60"] },
    { name: "60+ dias", value: data.overdueByStageDays["60+"] },
  ];

  const colors = ["#10b981", "#f59e0b", "#f97316", "#ef4444", "#dc2626"];

  const healthStatus =
    data.percentageOfRevenue <= 10
      ? { label: "Saudável", color: "text-green-400", bg: "bg-green-900/30" }
      : data.percentageOfRevenue <= 20
      ? { label: "Atenção", color: "text-yellow-400", bg: "bg-yellow-900/30" }
      : { label: "Crítico", color: "text-red-400", bg: "bg-red-900/30" };

  return (
    <div className="space-y-6">
      {/* ALERTAS */}
      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((alert, idx) => (
            <Alert key={idx} className="bg-red-900/30 border-red-700/50">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <AlertDescription className="text-red-300">{alert}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* KPIs PRINCIPAIS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Total em Aberto */}
        <Card className="bg-red-900/30 border-red-700/50">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="text-red-400 text-sm font-medium">Total em Aberto</div>
              <div className="text-4xl font-bold text-red-300">{formatCurrency(data.totalOverdue)}</div>
              <div className="flex items-center gap-2 text-xs text-red-300">
                <DollarSign className="w-4 h-4" />
                {data.percentageOfRevenue.toFixed(1)}% da receita
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Clientes Inadimplentes */}
        <Card className="bg-orange-900/30 border-orange-700/50">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="text-orange-400 text-sm font-medium">Clientes Inadimplentes</div>
              <div className="text-4xl font-bold text-orange-300">{data.totalClients}</div>
              <div className="flex items-center gap-2 text-xs text-orange-300">
                <Users className="w-4 h-4" />
                {((data.totalClients / 229) * 100).toFixed(1)}% do total
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Dias Médios de Atraso */}
        <Card className="bg-purple-900/30 border-purple-700/50">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="text-purple-400 text-sm font-medium">Dias Médios de Atraso</div>
              <div className="text-4xl font-bold text-purple-300">{data.avgDaysOverdue}</div>
              <div className="flex items-center gap-2 text-xs text-purple-300">
                <Clock className="w-4 h-4" />
                Tempo até regularização
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Taxa de Recuperação */}
        <Card className="bg-blue-900/30 border-blue-700/50">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="text-blue-400 text-sm font-medium">Taxa de Recuperação</div>
              <div className="text-4xl font-bold text-blue-300">{data.recoveryRate.toFixed(1)}%</div>
              <div className="flex items-center gap-2 text-xs text-blue-300">
                <Target className="w-4 h-4" />
                Cobranças bem-sucedidas
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* DISTRIBUIÇÃO POR FAIXA DE ATRASO */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Gráfico de Barras */}
        <Card className="bg-slate-900/50 border-slate-700/50">
          <CardHeader>
            <CardTitle className="text-white">Clientes por Faixa de Atraso</CardTitle>
            <CardDescription className="text-slate-400">Distribuição de inadimplência</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stageData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="range" stroke="#9ca3af" angle={-45} textAnchor="end" height={80} />
                  <YAxis stroke="#9ca3af" />
                  <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }} />
                  <Bar dataKey="clients" fill="#ef4444" name="Clientes" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Gráfico de Pizza */}
        <Card className="bg-slate-900/50 border-slate-700/50">
          <CardHeader>
            <CardTitle className="text-white">Distribuição de Clientes</CardTitle>
            <CardDescription className="text-slate-400">Por dias de atraso</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* VALOR EM ABERTO POR FAIXA */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-white">Valor em Aberto por Faixa de Atraso</CardTitle>
          <CardDescription className="text-slate-400">Impacto financeiro por estágio</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="range" stroke="#9ca3af" angle={-45} textAnchor="end" height={80} />
                <YAxis stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
                  formatter={(value) => formatCurrency(value as number)}
                />
                <Bar dataKey="amount" fill="#3b82f6" name="Valor" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* INDICADOR DE SAÚDE */}
      <Card className={`${healthStatus.bg} border-slate-700/50`}>
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Indicador de Saúde de Inadimplência
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-slate-300">Inadimplência / Receita</span>
                <span className={`text-2xl font-bold ${healthStatus.color}`}>
                  {data.percentageOfRevenue.toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    data.percentageOfRevenue <= 10
                      ? "bg-green-500"
                      : data.percentageOfRevenue <= 20
                      ? "bg-yellow-500"
                      : "bg-red-500"
                  }`}
                  style={{ width: `${Math.min(data.percentageOfRevenue, 100)}%` }}
                ></div>
              </div>
              <div className="text-xs text-slate-400">
                {data.percentageOfRevenue <= 10 && "Saudável: Inadimplência controlada"}
                {data.percentageOfRevenue > 10 && data.percentageOfRevenue <= 20 && "Atenção: Inadimplência crescendo"}
                {data.percentageOfRevenue > 20 && "Crítico: Inadimplência muito alta"}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-700">
              <div className="text-sm text-slate-300">
                <p>
                  <strong>Status:</strong> <span className={healthStatus.color}>{healthStatus.label}</span>
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {healthStatus.label === "Saudável"
                    ? "Parabéns! Sua inadimplência está controlada. Continue monitorando."
                    : healthStatus.label === "Atenção"
                    ? "Fique atento! Sua inadimplência está crescendo. Intensifique as cobranças."
                    : "Ação necessária! Sua inadimplência está crítica. Revise sua estratégia de cobrança urgentemente."}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PRÓXIMAS AÇÕES */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-white">Próximas Ações Recomendadas</CardTitle>
          <CardDescription className="text-slate-400">Baseado na análise de inadimplência</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
              <div className="text-yellow-400 text-lg">⚠️</div>
              <div>
                <p className="font-semibold text-white">Intensificar cobrança para 60+ dias</p>
                <p className="text-sm text-slate-400">9 clientes com atraso crítico. Enviar notificação de suspensão.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
              <div className="text-orange-400 text-lg">⚠️</div>
              <div>
                <p className="font-semibold text-white">Oferecer parcelamento para 16-60 dias</p>
                <p className="text-sm text-slate-400">47 clientes podem ser recuperados com acordo.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
              <div className="text-green-400 text-lg">✅</div>
              <div>
                <p className="font-semibold text-white">Manter contato com 0-15 dias</p>
                <p className="text-sm text-slate-400">45 clientes podem ser recuperados com lembrete simples.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
