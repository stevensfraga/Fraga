import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  MessageSquare,
  Clock,
  DollarSign,
  Users,
  AlertCircle,
  TrendingUp,
  BarChart3,
} from "lucide-react";

// Mapeamento de stage para rótulo amigável e cor
const STAGE_META: Record<string, { label: string; color: string; bgColor: string; borderColor: string }> = {
  d_minus_3: { label: "D-3 (Preventivo)", color: "text-sky-700", bgColor: "bg-sky-50", borderColor: "border-sky-200" },
  d_0: { label: "D0 (Vencimento)", color: "text-blue-700", bgColor: "bg-blue-50", borderColor: "border-blue-200" },
  d_plus_3: { label: "D+3", color: "text-yellow-700", bgColor: "bg-yellow-50", borderColor: "border-yellow-200" },
  d_plus_7: { label: "D+7", color: "text-orange-700", bgColor: "bg-orange-50", borderColor: "border-orange-200" },
  d_plus_15: { label: "D+15", color: "text-amber-700", bgColor: "bg-amber-50", borderColor: "border-amber-200" },
  d_plus_30: { label: "D+30", color: "text-red-600", bgColor: "bg-red-50", borderColor: "border-red-200" },
  d_plus_45: { label: "D+45", color: "text-red-700", bgColor: "bg-red-50", borderColor: "border-red-300" },
  d_plus_60: { label: "D+60", color: "text-rose-700", bgColor: "bg-rose-50", borderColor: "border-rose-300" },
  d_plus_90: { label: "D+90", color: "text-rose-800", bgColor: "bg-rose-100", borderColor: "border-rose-400" },
  d_plus_180: { label: "D+180", color: "text-purple-700", bgColor: "bg-purple-50", borderColor: "border-purple-300" },
  d_plus_365: { label: "D+365+", color: "text-slate-700", bgColor: "bg-slate-100", borderColor: "border-slate-300" },
};

function fmtBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

export default function CollectionCanvas() {
  const { data: pipelineData, isLoading: pipelineLoading, refetch: refetchPipeline } = trpc.reguaPipeline.pipeline.useQuery({ days: 30 });
  const { data: statsData, isLoading: statsLoading } = trpc.regua.stats.useQuery({ days: 30 });

  const isLoading = pipelineLoading || statsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <RefreshCw className="h-6 w-6 animate-spin mr-2" />
        Carregando funil de cobrança...
      </div>
    );
  }

  const stages = (pipelineData?.stages ?? []).filter(s => s.count > 0);
  const totalClients = pipelineData?.summary?.totalClients ?? 0;
  const totalDebt = pipelineData?.summary?.totalDebt ?? 0;

  // Stats do período
  const totals = statsData?.totals;
  const sentTotal = Number(totals?.sent ?? 0);
  const skippedTotal = Number(totals?.skipped ?? 0);
  const totalRuns = Number(totals?.totalRuns ?? 0);
  const bySkipReason = statsData?.bySkipReason ?? [];

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">Funil de Cobrança</h2>
          <p className="text-sm text-muted-foreground">
            Clientes com dívida em aberto agrupados por estágio da régua — dados reais do banco
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchPipeline()} className="h-8 text-xs gap-1 self-start sm:self-auto">
          <RefreshCw className="h-3 w-3" /> Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-slate-200">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-blue-600" />
              <span className="text-xs text-muted-foreground">Clientes em Cobrança</span>
            </div>
            <p className="text-2xl font-bold text-slate-800">{totalClients}</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-red-600" />
              <span className="text-xs text-muted-foreground">Total em Aberto</span>
            </div>
            <p className="text-xl font-bold text-red-700">{fmtBRL(totalDebt)}</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-green-600" />
              <span className="text-xs text-muted-foreground">Msgs Enviadas (30d)</span>
            </div>
            <p className="text-2xl font-bold text-green-700">{sentTotal}</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-purple-600" />
              <span className="text-xs text-muted-foreground">Execuções (30d)</span>
            </div>
            <p className="text-2xl font-bold text-purple-700">{totalRuns}</p>
          </CardContent>
        </Card>
      </div>

      {/* Kanban por estágio */}
      {stages.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Nenhum cliente com dívida em aberto encontrado.</p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4" style={{ minWidth: `${stages.length * 280}px` }}>
            {stages.map((stage) => {
              const meta = STAGE_META[stage.stage] ?? {
                label: stage.stage,
                color: "text-slate-700",
                bgColor: "bg-slate-50",
                borderColor: "border-slate-200",
              };
              return (
                <div
                  key={stage.stage}
                  className={`flex-shrink-0 w-64 rounded-lg border ${meta.borderColor} ${meta.bgColor} p-3`}
                >
                  {/* Header da coluna */}
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className={`text-xs font-bold uppercase tracking-wide ${meta.color}`}>{meta.label}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{fmtBRL(stage.totalDebt)}</p>
                    </div>
                    <Badge variant="secondary" className="text-xs">{stage.count}</Badge>
                  </div>

                  {/* Cards de clientes */}
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {stage.clients.slice(0, 10).map((client: any) => (
                      <div
                        key={client.clientId}
                        className="bg-white rounded-md border border-white/80 shadow-sm p-2.5"
                      >
                        <p className="text-xs font-semibold text-slate-800 line-clamp-1 mb-1">
                          {client.clientName}
                        </p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="font-medium text-slate-700">{fmtBRL(client.totalDebt)}</span>
                          <span className={`font-semibold ${client.maxDaysOverdue > 30 ? "text-red-600" : "text-orange-500"}`}>
                            {client.maxDaysOverdue}d
                          </span>
                        </div>
                        {client.openCount > 1 && (
                          <p className="text-xs text-muted-foreground mt-0.5">{client.openCount} títulos</p>
                        )}
                        {client.optOut && (
                          <Badge variant="outline" className="text-xs mt-1 border-red-200 text-red-600">Opt-out</Badge>
                        )}
                        {client.billingPausedUntil && (
                          <Badge variant="outline" className="text-xs mt-1 border-yellow-200 text-yellow-700">Pausado</Badge>
                        )}
                        {client.lastSentAt && (
                          <p className="text-xs text-muted-foreground mt-1">
                            <Clock className="h-2.5 w-2.5 inline mr-0.5" />
                            {new Date(client.lastSentAt).toLocaleDateString("pt-BR")}
                          </p>
                        )}
                      </div>
                    ))}
                    {stage.count > 10 && (
                      <p className="text-xs text-center text-muted-foreground py-1">
                        +{stage.count - 10} clientes
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Motivos de Skip */}
      {bySkipReason.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="border-slate-200">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-slate-500" />
                Motivos de Skip (últimos 30 dias)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="space-y-2">
                {bySkipReason.map((r: any) => (
                  <div key={r.skipReason} className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-700">{r.skipReason || "N/A"}</span>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-1.5 rounded-full bg-slate-300"
                        style={{
                          width: `${Math.min(100, (Number(r.count) / (skippedTotal || 1)) * 100)}px`,
                        }}
                      />
                      <span className="text-xs text-muted-foreground w-8 text-right">{r.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-slate-500" />
                Resumo (últimos 30 dias)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Total processados</span>
                  <span className="text-sm font-semibold">{Number(totals?.total ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Enviados</span>
                  <span className="text-sm font-semibold text-green-700">{sentTotal}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Pulados</span>
                  <span className="text-sm font-semibold text-yellow-700">{skippedTotal}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Erros</span>
                  <span className="text-sm font-semibold text-red-600">{Number(totals?.errors ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Clientes únicos</span>
                  <span className="text-sm font-semibold">{Number(totals?.uniqueClients ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Execuções</span>
                  <span className="text-sm font-semibold">{totalRuns}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
