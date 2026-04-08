import { useState, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle, Loader2, RefreshCw, TrendingUp, Users, DollarSign, AlertTriangle } from "lucide-react";

interface HealthStatus {
  ok: boolean;
  version?: string;
  environment?: string;
  message?: string;
  error?: string;
}

interface E2EStatus {
  success: boolean;
  system?: {
    tokenValid: boolean;
    tokenAvailable: boolean;
    baseUrl: string;
    timestamp: string;
  };
  error?: string;
}

interface DashboardMetrics {
  ok: boolean;
  traceId: string;
  timestamp: string;
  source: string;
  lastSyncAt: string | null;
  tenantId: string | null;
  reason?: string;
  message?: string;
  metrics?: {
    totalClients: number;
    activeClients: number;
    totalReceivables: number;
    overdueReceivables: number;
    totalOverdueAmount: number;
    averageOverdueDays: number;
  };
}

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [e2eStatus, setE2EStatus] = useState<E2EStatus | null>(null);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Test health endpoint
      const healthResponse = await fetch("/api/health", { method: "GET" });
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        setHealthStatus(healthData);
      } else {
        setError(`Health check retornou status ${healthResponse.status}`);
      }

      // Test E2E status endpoint
      const e2eResponse = await fetch("/api/test/e2e/status", { method: "GET" });
      if (e2eResponse.ok) {
        const e2eData = await e2eResponse.json();
        setE2EStatus(e2eData);
      } else if (e2eResponse.status !== 404) {
        // 404 é esperado se endpoint não existe
        setError(`E2E status retornou status ${e2eResponse.status}`);
      }

      // Fetch dashboard metrics
      const metricsResponse = await fetch("/api/dashboard/metrics", { method: "GET" });
      if (metricsResponse.ok) {
        const metricsData = await metricsResponse.json();
        setDashboardMetrics(metricsData);
      } else if (metricsResponse.status !== 404) {
        setError(`Dashboard metrics retornou status ${metricsResponse.status}`);
      }
    } catch (err: any) {
      setError(err.message || "Erro ao carregar dados do backend");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading) {
      loadData();
    }
  }, [authLoading]);

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-white text-lg">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Dashboard Fraga Contabilidade</h1>
          <p className="text-slate-400">Status do sistema e integração Conta Azul</p>
        </div>

        {/* Error Alert */}
        {error && (
          <Card className="mb-6 bg-red-950 border-red-800">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-red-200 font-semibold">Erro ao carregar dados</p>
                  <p className="text-red-300 text-sm mt-1">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Backend Status */}
        {healthStatus ? (
          <Card className="mb-6 bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-400" />
                Backend Status
              </CardTitle>
              <CardDescription className="text-slate-400">
                {healthStatus.ok ? "✅ Backend está rodando" : "❌ Backend offline"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-slate-400 text-sm">Versão</p>
                  <p className="text-white font-mono">{healthStatus.version || "N/A"}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Ambiente</p>
                  <p className="text-white font-mono">{healthStatus.environment || "N/A"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-slate-400 text-sm">Status</p>
                  <p className="text-white">{healthStatus.message || "Backend respondendo"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-6 bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-400" />
                <p className="text-yellow-200">Backend não publicado ou indisponível</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* E2E Status */}
        {e2eStatus && e2eStatus.success ? (
          <Card className="mb-6 bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-400" />
                Integração Conta Azul
              </CardTitle>
              <CardDescription className="text-slate-400">
                {e2eStatus.system?.tokenValid ? "✅ Token válido" : "⚠️ Token inválido"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-slate-400 text-sm">Token Disponível</p>
                  <p className="text-white">
                    {e2eStatus.system?.tokenAvailable ? "✅ Sim" : "❌ Não"}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Base URL</p>
                  <p className="text-white font-mono text-xs">{e2eStatus.system?.baseUrl}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Dashboard Metrics */}
        {dashboardMetrics && dashboardMetrics.ok && dashboardMetrics.metrics ? (
          <div className="space-y-6 mb-6">
            {/* Metrics Header */}
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-slate-400 text-sm">Fonte de Dados</p>
                  <p className="text-white font-semibold">{dashboardMetrics.source}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-400 text-sm">Última Sincronização</p>
                  <p className="text-white font-mono text-xs">
                    {dashboardMetrics.lastSyncAt ? new Date(dashboardMetrics.lastSyncAt).toLocaleString() : "N/A"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-slate-400 text-sm">Trace ID</p>
                  <p className="text-white font-mono text-xs">{dashboardMetrics.traceId}</p>
                </div>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white flex items-center gap-2 text-lg">
                    <Users className="w-5 h-5 text-blue-400" />
                    Clientes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div>
                      <p className="text-slate-400 text-sm">Total</p>
                      <p className="text-white text-2xl font-bold">{dashboardMetrics.metrics.totalClients}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm">Ativos</p>
                      <p className="text-green-400 font-semibold">{dashboardMetrics.metrics.activeClients}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white flex items-center gap-2 text-lg">
                    <DollarSign className="w-5 h-5 text-green-400" />
                    Receitas
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div>
                      <p className="text-slate-400 text-sm">Total a Receber</p>
                      <p className="text-white text-2xl font-bold">{dashboardMetrics.metrics.totalReceivables}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white flex items-center gap-2 text-lg">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                    Atrasos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div>
                      <p className="text-slate-400 text-sm">Quantidade</p>
                      <p className="text-red-400 text-2xl font-bold">{dashboardMetrics.metrics.overdueReceivables}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm">Valor Total</p>
                      <p className="text-red-400 font-semibold">R$ {dashboardMetrics.metrics.totalOverdueAmount.toFixed(2)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Average Overdue Days */}
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-yellow-400" />
                  Média de Dias em Atraso
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-white text-3xl font-bold">{dashboardMetrics.metrics.averageOverdueDays.toFixed(1)} dias</p>
              </CardContent>
            </Card>
          </div>
        ) : dashboardMetrics && !dashboardMetrics.ok ? (
          <Card className="mb-6 bg-yellow-950 border-yellow-800">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-yellow-200 font-semibold">Dados não disponíveis</p>
                  <p className="text-yellow-300 text-sm mt-1">
                    {dashboardMetrics.reason === "NOT_SYNCED" 
                      ? "Nenhuma sincronização com Conta Azul foi realizada ainda. Conecte via OAuth para sincronizar dados."
                      : dashboardMetrics.message || "Não foi possível carregar as métricas"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Sem Dados Ainda */}
        {!healthStatus && (
          <Card className="mb-6 bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Sem dados ainda</CardTitle>
              <CardDescription className="text-slate-400">
                O dashboard está pronto, mas precisa de dados reais
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="bg-slate-900 p-4 rounded-lg">
                  <h3 className="text-white font-semibold mb-3">Próximos passos:</h3>
                  <ol className="text-slate-300 space-y-2 text-sm list-decimal list-inside">
                    <li>✅ Valide que /api/health retorna 200</li>
                    <li>🔐 Conecte o Conta Azul (OAuth)</li>
                    <li>🔄 Rode o sync de dados</li>
                    <li>📊 Dados aparecerão aqui automaticamente</li>
                  </ol>
                </div>

                <div className="bg-blue-950 border border-blue-800 p-4 rounded-lg">
                  <p className="text-blue-200 text-sm">
                    💡 <strong>Dica:</strong> O dashboard busca dados apenas de APIs reais.
                    Nenhum arquivo JSON estático ou mock data.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Refresh Button */}
        <div className="flex justify-center">
          <Button
            onClick={loadData}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            {isLoading ? "Carregando..." : "Recarregar"}
          </Button>
        </div>

        {/* User Info */}
        {user && (
          <div className="mt-8 pt-8 border-t border-slate-700">
            <p className="text-slate-400 text-sm">
              Conectado como: <span className="text-white font-semibold">{user.email}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
