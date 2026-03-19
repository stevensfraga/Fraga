import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  ArrowLeft, RefreshCw, DollarSign, AlertTriangle, CheckCircle,
  XCircle, RotateCcw, Activity, Clock, WifiOff, Wifi,
} from "lucide-react";

function fmtBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtDate(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR");
}

function fmtDateTime(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtTime(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ── Indicador de frescor da sincronização ──────────────────────────────────
function SyncFreshnessIndicator({ minutesAgo, lastSyncAt, isSyncing }: {
  minutesAgo: number | null;
  lastSyncAt: Date | null;
  isSyncing: boolean;
}) {
  if (isSyncing) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full">
        <RefreshCw className="h-3 w-3 animate-spin" />
        <span>Sincronizando com Conta Azul...</span>
      </div>
    );
  }

  if (minutesAgo === null || lastSyncAt === null) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
        <WifiOff className="h-3 w-3" />
        <span>Nenhuma sincronização registrada</span>
      </div>
    );
  }

  if (minutesAgo > 120) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-full border border-red-200">
        <XCircle className="h-3 w-3" />
        <span>🔴 Sincronização atrasada — última há {minutesAgo} min ({fmtTime(lastSyncAt)})</span>
      </div>
    );
  }

  if (minutesAgo > 30) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-200">
        <Clock className="h-3 w-3" />
        <span>⚠️ Dados podem estar desatualizados — última sync às {fmtTime(lastSyncAt)} ({minutesAgo} min atrás)</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-full">
      <Wifi className="h-3 w-3" />
      <span>🔄 Última sincronização com Conta Azul: {fmtTime(lastSyncAt)} de hoje</span>
    </div>
  );
}

export default function PaymentsDivergences() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState("recent");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const days = useMemo(() => 30, []);
  const { data: recentData, isLoading: loadingRecent, refetch: refetchRecent } = trpc.payments.recent.useQuery({ days, limit: 50 });
  const { data: divData, isLoading: loadingDiv } = trpc.payments.divergences.useQuery({ limit: 50 });
  const syncDays = useMemo(() => 7, []);
  const { data: syncData, isLoading: loadingSync, refetch: refetchSync } = trpc.payments.syncErrors.useQuery({ days: syncDays });
  const { data: lastSyncData, refetch: refetchLastSync } = trpc.payments.lastSync.useQuery();

  const utils = trpc.useUtils();

  const syncNow = trpc.payments.syncNow.useMutation({
    onSuccess: (result) => {
      const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      setLastSyncedAt(new Date());
      if (result.success) {
        toast.success(`✅ Atualizado às ${time} — ${result.updatedCount} pagamentos atualizados`);
      } else {
        toast.error(`Sync concluído com erro: ${result.error}`);
      }
      // Invalidar queries para recarregar dados
      utils.payments.recent.invalidate();
      utils.payments.lastSync.invalidate();
      refetchSync();
    },
    onError: (err) => {
      toast.error(`Erro ao sincronizar: ${err.message}`);
    },
  });

  const retryFailed = trpc.payments.retryFailed.useMutation({
    onSuccess: (result) => {
      toast.success(`Reconciliação: ${result.success} sucesso, ${result.failed} falhas`);
      refetchRecent();
    },
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  // Calcular minutesAgo em tempo real (pode mudar sem refetch)
  const minutesAgo = lastSyncData?.lastSyncAt
    ? Math.floor((Date.now() - new Date(lastSyncData.lastSyncAt).getTime()) / 60000)
    : null;

  const syncButtonLabel = () => {
    if (syncNow.isPending) return "Sincronizando...";
    if (lastSyncedAt) {
      return `✅ Atualizado às ${lastSyncedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    }
    return "Atualizar agora";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}><ArrowLeft className="h-4 w-4" /></Button>
            <div>
              <h1 className="text-lg font-bold text-slate-800">Pagamentos & Divergências</h1>
              <p className="text-xs text-muted-foreground">Reconciliação CA × DB e status de sync</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={lastSyncedAt ? "outline" : "default"}
              size="sm"
              onClick={() => syncNow.mutate()}
              disabled={syncNow.isPending}
              className={lastSyncedAt ? "text-green-700 border-green-300 bg-green-50 hover:bg-green-100" : ""}
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${syncNow.isPending ? "animate-spin" : ""}`} />
              {syncButtonLabel()}
            </Button>
          </div>
        </div>
      </div>

      {/* Indicador de frescor */}
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <SyncFreshnessIndicator
          minutesAgo={minutesAgo}
          lastSyncAt={lastSyncData?.lastSyncAt ? new Date(lastSyncData.lastSyncAt) : null}
          isSyncing={syncNow.isPending}
        />
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-4 pb-3 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <div><div className="text-xs text-muted-foreground">Pagos (30d)</div><div className="text-xl font-bold">{recentData?.totals?.count ?? "—"}</div></div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-green-600" />
            <div><div className="text-xs text-muted-foreground">Total Recebido</div><div className="text-xl font-bold">{recentData?.totals ? fmtBRL(recentData.totals.totalAmount) : "—"}</div></div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            <div><div className="text-xs text-muted-foreground">Divergências</div><div className="text-xl font-bold text-orange-600">{divData?.unresolvedCount ?? "—"}</div></div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 flex items-center gap-3">
            <XCircle className="h-5 w-5 text-red-600" />
            <div><div className="text-xs text-muted-foreground">Erros Sync</div><div className="text-xl font-bold text-red-600">{syncData?.errors?.length ?? "—"}</div></div>
          </CardContent></Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="recent">Pagamentos Recentes</TabsTrigger>
            <TabsTrigger value="divergences">Divergências CA×DB</TabsTrigger>
            <TabsTrigger value="sync">Status Sync</TabsTrigger>
          </TabsList>

          <TabsContent value="recent">
            <Card><CardContent className="pt-0">
              {loadingRecent ? (
                <div className="flex items-center justify-center py-8"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Cliente</TableHead><TableHead>Valor</TableHead><TableHead>Vencimento</TableHead>
                    <TableHead>Pago em</TableHead><TableHead>Descrição</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {!recentData?.payments?.length ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum pagamento recente</TableCell></TableRow>
                    ) : (
                      recentData.payments.map((p: any) => (
                        <TableRow key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => p.clientId && navigate(`/cliente/${p.clientId}`)}>
                          <TableCell className="font-medium text-sm">{p.clientName || "—"}</TableCell>
                          <TableCell className="text-sm font-semibold text-green-600">{fmtBRL(p.amount)}</TableCell>
                          <TableCell className="text-xs">{fmtDate(p.dueDate)}</TableCell>
                          <TableCell className="text-xs">{fmtDate(p.paidDate || p.updatedAt)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">{p.description || "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="divergences">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" /> Divergências ({divData?.unresolvedCount || 0} alertas)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingDiv ? (
                  <div className="flex items-center justify-center py-8"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Run ID</TableHead><TableHead>CA Total</TableHead><TableHead>DB Total</TableHead>
                        <TableHead>Diferença</TableHead><TableHead>Status Mismatch</TableHead><TableHead>Valor Mismatch</TableHead>
                        <TableHead>Data</TableHead><TableHead>Ações</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {!divData?.divergences?.length ? (
                          <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                            <CheckCircle className="h-6 w-6 mx-auto mb-2 text-green-400" />Nenhuma divergência
                          </TableCell></TableRow>
                        ) : (
                          divData.divergences.map((d: any) => (
                            <TableRow key={d.id}>
                              <TableCell className="text-xs font-mono">{d.runId?.substring(0, 8) || "—"}</TableCell>
                              <TableCell className="text-xs">{fmtBRL(d.caTotal)}</TableCell>
                              <TableCell className="text-xs">{fmtBRL(d.dbTotal)}</TableCell>
                              <TableCell className="text-xs font-semibold text-orange-600">{fmtBRL(d.diffValue)} ({d.diffPercent.toFixed(1)}%)</TableCell>
                              <TableCell className="text-xs">{d.statusMismatchCount}</TableCell>
                              <TableCell className="text-xs">{d.valueMismatchCount}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{fmtDateTime(d.createdAt)}</TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                  onClick={() => retryFailed.mutate({ receivableIds: [d.id] })}
                                  disabled={retryFailed.isPending} title="Reprocessar">
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>

                    {divData?.staleReceivables && divData.staleReceivables.length > 0 && (
                      <div className="mt-6">
                        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                          <Activity className="h-4 w-4 text-yellow-500" /> Recebíveis Desatualizados ({divData.staleReceivables.length})
                        </h3>
                        <Table>
                          <TableHeader><TableRow>
                            <TableHead>Cliente</TableHead><TableHead>Valor</TableHead><TableHead>Vencimento</TableHead>
                            <TableHead>Status DB</TableHead><TableHead>Última Sync</TableHead>
                          </TableRow></TableHeader>
                          <TableBody>
                            {divData.staleReceivables.map((r: any) => (
                              <TableRow key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => r.clientId && navigate(`/cliente/${r.clientId}`)}>
                                <TableCell className="text-sm">{r.clientName || "—"}</TableCell>
                                <TableCell className="text-sm">{fmtBRL(r.amount)}</TableCell>
                                <TableCell className="text-xs">{fmtDate(r.dueDate)}</TableCell>
                                <TableCell><Badge variant="secondary" className="text-xs">{r.dbStatus}</Badge></TableCell>
                                <TableCell className="text-xs text-muted-foreground">{fmtDateTime(r.updatedAt)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sync">
            <div className="space-y-4">
              {/* Card de status do sync automático */}
              {lastSyncData && (
                <Card className={`border-l-4 ${
                  minutesAgo === null ? "border-l-slate-300" :
                  minutesAgo > 120 ? "border-l-red-400" :
                  minutesAgo > 30 ? "border-l-amber-400" :
                  "border-l-green-400"
                }`}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-700">Sync Automático de Pagamentos</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {lastSyncData.lastSyncAt
                            ? `Última execução: ${fmtDateTime(lastSyncData.lastSyncAt)} (${minutesAgo} min atrás)`
                            : "Nenhuma execução registrada"}
                        </p>
                        {lastSyncData.lastResult && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Verificados: {lastSyncData.lastResult.checkedLocal} · Atualizados: {lastSyncData.lastResult.updatedCount} · Duração: {lastSyncData.lastResult.durationMs}ms
                          </p>
                        )}
                      </div>
                      <Badge variant={
                        lastSyncData.lastStatus === "success" ? "default" :
                        lastSyncData.lastStatus === "failed" ? "destructive" : "secondary"
                      } className="text-xs">
                        {lastSyncData.lastStatus ?? "—"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm">Cursores de Sincronização</CardTitle></CardHeader>
                <CardContent>
                  {loadingSync ? (
                    <div className="flex items-center justify-center py-8"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Tipo</TableHead><TableHead>Última Sync</TableHead><TableHead>Status</TableHead><TableHead>Atualizado</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {!syncData?.cursors?.length ? (
                          <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground">Nenhum cursor</TableCell></TableRow>
                        ) : (
                          syncData.cursors.map((c: any) => (
                            <TableRow key={c.id}>
                              <TableCell className="font-medium text-sm">{c.syncType}</TableCell>
                              <TableCell className="text-xs">{fmtDateTime(c.lastSyncAt)}</TableCell>
                              <TableCell>
                                <Badge variant={c.lastStatus === "success" ? "default" : c.lastStatus === "failed" ? "destructive" : "secondary"} className="text-xs">
                                  {c.lastStatus}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{fmtDateTime(c.updatedAt)}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {syncData?.errors && syncData.errors.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-red-500" /> Erros de Reconciliação ({syncData.errors.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Run ID</TableHead><TableHead>Status</TableHead><TableHead>Erro</TableHead><TableHead>Data</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {syncData.errors.map((e: any) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-xs font-mono">{e.runId?.substring(0, 8) || "—"}</TableCell>
                            <TableCell><Badge variant="destructive" className="text-xs">{e.status}</Badge></TableCell>
                            <TableCell className="text-xs text-red-600 truncate max-w-[300px]">{e.errorMessage || "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
