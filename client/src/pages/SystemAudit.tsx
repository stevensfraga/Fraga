/**
 * 🔍 Página de Auditoria do Sistema Manos
 * 
 * Valida todos os componentes antes de disparar boletos reais
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, AlertTriangle, RefreshCw, Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface AuditResult {
  timestamp: string;
  status: "healthy" | "warning" | "critical";
  checks: Record<string, any>;
  summary: {
    totalChecks: number;
    passed: number;
    warnings: number;
    failed: number;
    successRate: number;
  };
  recommendations: string[];
}

export default function SystemAudit() {
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Queries tRPC
  const runAudit = trpc.systemAudit.runFullAudit.useQuery(
    { verbose: false },
    { enabled: false }
  );

  const getStatus = trpc.systemAudit.getSystemStatus.useQuery();

  const isReady = trpc.systemAudit.isReadyForDispatch.useQuery();

  // Executar auditoria
  const handleRunAudit = async () => {
    setIsLoading(true);
    try {
      const result = await runAudit.refetch();
      if (result.data?.data) {
        setAuditResult(result.data.data);
      }
    } catch (error) {
      console.error("Erro ao executar auditoria:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      handleRunAudit();
    }, 30000); // 30 segundos

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Exportar resultado como JSON
  const handleExportJSON = () => {
    if (!auditResult) return;

    const dataStr = JSON.stringify(auditResult, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Renderizar status de um check
  const renderCheckStatus = (status: string) => {
    switch (status) {
      case "pass":
        return (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle className="w-5 h-5" />
            <span>Passou</span>
          </div>
        );
      case "warning":
        return (
          <div className="flex items-center gap-2 text-yellow-600">
            <AlertTriangle className="w-5 h-5" />
            <span>Aviso</span>
          </div>
        );
      case "fail":
        return (
          <div className="flex items-center gap-2 text-red-600">
            <AlertCircle className="w-5 h-5" />
            <span>Falha</span>
          </div>
        );
      default:
        return <span className="text-gray-500">Desconhecido</span>;
    }
  };

  // Renderizar status geral
  const renderOverallStatus = (status: string) => {
    const statusConfig = {
      healthy: {
        icon: CheckCircle,
        color: "text-green-600",
        bg: "bg-green-50",
        label: "Sistema Saudável",
      },
      warning: {
        icon: AlertTriangle,
        color: "text-yellow-600",
        bg: "bg-yellow-50",
        label: "Avisos Detectados",
      },
      critical: {
        icon: AlertCircle,
        color: "text-red-600",
        bg: "bg-red-50",
        label: "Problemas Críticos",
      },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.critical;
    const Icon = config.icon;

    return (
      <div className={`${config.bg} p-4 rounded-lg flex items-center gap-3`}>
        <Icon className={`${config.color} w-8 h-8`} />
        <div>
          <p className={`${config.color} font-semibold`}>{config.label}</p>
          <p className="text-sm text-gray-600">
            {auditResult?.summary.successRate.toFixed(1)}% de sucesso
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">🔍 Auditoria do Sistema Manos</h1>
        <p className="text-gray-600">
          Valida todos os componentes antes de disparar boletos reais
        </p>
      </div>

      {/* Controles */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <Button
          onClick={handleRunAudit}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          {isLoading ? "Auditando..." : "Executar Auditoria"}
        </Button>

        <Button
          variant="outline"
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={autoRefresh ? "bg-blue-50" : ""}
        >
          {autoRefresh ? "⏸️ Parar Auto-Refresh" : "▶️ Auto-Refresh (30s)"}
        </Button>

        {auditResult && (
          <Button
            variant="outline"
            onClick={handleExportJSON}
            className="gap-2"
          >
            <Download className="w-4 h-4" />
            Exportar JSON
          </Button>
        )}
      </div>

      {/* Status Geral */}
      {auditResult && (
        <div className="mb-8">
          {renderOverallStatus(auditResult.status)}
        </div>
      )}

      {/* Resumo */}
      {auditResult && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{auditResult.summary.totalChecks}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600">Passou</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{auditResult.summary.passed}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-600">Avisos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">
                {auditResult.summary.warnings}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-600">Falhas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{auditResult.summary.failed}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Detalhes de Cada Check */}
      {auditResult && (
        <div className="space-y-4 mb-8">
          <h2 className="text-xl font-bold">Detalhes dos Componentes</h2>

          {Object.entries(auditResult.checks).map(([key, check]) => (
            <Card key={key}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {renderCheckStatus(check.status)}
                    <div>
                      <CardTitle className="text-base">{check.name}</CardTitle>
                      <CardDescription>{check.message}</CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>

              {(check.details || check.suggestedCommand) && (
                <CardContent className="space-y-3">
                  {check.details && (
                    <div>
                      <p className="text-sm font-semibold text-gray-600 mb-1">Detalhes:</p>
                      <pre className="bg-gray-100 p-2 rounded text-xs overflow-auto">
                        {JSON.stringify(check.details, null, 2)}
                      </pre>
                    </div>
                  )}

                  {check.suggestedCommand && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        <p className="font-semibold mb-1">💡 Sugestão:</p>
                        <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                          {check.suggestedCommand}
                        </code>
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Recomendações */}
      {auditResult && auditResult.recommendations.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold">💡 Recomendações</h2>

          <Card>
            <CardContent className="pt-6">
              <ul className="space-y-2">
                {auditResult.recommendations.map((rec, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="text-lg">{rec.split(" ")[0]}</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Estado Inicial */}
      {!auditResult && (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-gray-600 mb-4">
              Clique em "Executar Auditoria" para validar todos os componentes do sistema
            </p>
            <Button onClick={handleRunAudit} size="lg">
              Iniciar Auditoria
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Timestamp */}
      {auditResult && (
        <p className="text-xs text-gray-500 mt-8">
          Auditoria executada em: {new Date(auditResult.timestamp).toLocaleString("pt-BR")}
        </p>
      )}
    </div>
  );
}
