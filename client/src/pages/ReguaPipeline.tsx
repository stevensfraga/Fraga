import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useLocation } from "wouter";
import {
  ArrowLeft, RefreshCw, Users, DollarSign, ShieldOff, Clock,
  CheckCircle, Zap,
} from "lucide-react";

function fmtBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtDateTime(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const STAGE_LABELS: Record<string, string> = {
  d_minus_3: "D-3", d_0: "D0", d_plus_3: "D+3", d_plus_7: "D+7",
  d_plus_15: "D+15", d_plus_30: "D+30", d_plus_45: "D+45",
  d_plus_60: "D+60", d_plus_90: "D+90", d_plus_180: "D+180", d_plus_365: "D+365",
};

const STAGE_COLORS: Record<string, string> = {
  d_minus_3: "bg-blue-100 text-blue-800", d_0: "bg-green-100 text-green-800",
  d_plus_3: "bg-yellow-100 text-yellow-800", d_plus_7: "bg-orange-100 text-orange-800",
  d_plus_15: "bg-orange-200 text-orange-900", d_plus_30: "bg-red-100 text-red-800",
  d_plus_45: "bg-red-200 text-red-900", d_plus_60: "bg-red-300 text-red-950",
  d_plus_90: "bg-purple-100 text-purple-800", d_plus_180: "bg-purple-200 text-purple-900",
  d_plus_365: "bg-slate-300 text-slate-900",
};

const REASON_LABELS: Record<string, string> = {
  "opt-out": "Opt-Out", paused: "Pausado", negotiated: "Em Negociação",
  "no-whatsapp": "Sem WhatsApp", inactive: "Inativo",
};

export default function ReguaPipeline() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState("kanban");

  const days = useMemo(() => 30, []);
  const { data: pipelineData, isLoading: loadingPipeline, refetch } = trpc.reguaPipeline.pipeline.useQuery({ days });
  const { data: blockedData, isLoading: loadingBlocked } = trpc.reguaPipeline.blocked.useQuery({});
  const { data: timelineData, isLoading: loadingTimeline } = trpc.reguaPipeline.timeline.useQuery({ days: 7, limit: 50 });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}><ArrowLeft className="h-4 w-4" /></Button>
            <div>
              <h1 className="text-lg font-bold text-slate-800">Pipeline da Régua</h1>
              <p className="text-xs text-muted-foreground">Visão Kanban por estágio de cobrança</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {pipelineData?.summary && (
          <div className="grid grid-cols-3 gap-4">
            <Card><CardContent className="pt-4 pb-3 flex items-center gap-3">
              <Users className="h-5 w-5 text-blue-600" />
              <div><div className="text-xs text-muted-foreground">Clientes no Pipeline</div><div className="text-xl font-bold">{pipelineData.summary.totalClients}</div></div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3 flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-red-600" />
              <div><div className="text-xs text-muted-foreground">Valor Total em Aberto</div><div className="text-xl font-bold">{fmtBRL(pipelineData.summary.totalDebt)}</div></div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3 flex items-center gap-3">
              <Zap className="h-5 w-5 text-orange-600" />
              <div><div className="text-xs text-muted-foreground">Estágios Ativos</div><div className="text-xl font-bold">{pipelineData.summary.stageCount}</div></div>
            </CardContent></Card>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="kanban">Kanban</TabsTrigger>
            <TabsTrigger value="table">Tabela</TabsTrigger>
            <TabsTrigger value="blocked">Bloqueados</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>

          <TabsContent value="kanban">
            {loadingPipeline ? (
              <div className="flex items-center justify-center py-12"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-4">
                {pipelineData?.stages?.filter(s => s.count > 0).map((stage) => (
                  <div key={stage.stage} className="min-w-[220px] max-w-[260px] flex-shrink-0">
                    <Card>
                      <CardHeader className="pb-2 pt-3 px-3">
                        <div className="flex items-center justify-between">
                          <Badge className={`text-xs ${STAGE_COLORS[stage.stage] || "bg-slate-100"}`}>{STAGE_LABELS[stage.stage] || stage.stage}</Badge>
                          <span className="text-xs text-muted-foreground">{stage.count}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{fmtBRL(stage.totalDebt)}</div>
                      </CardHeader>
                      <CardContent className="px-3 pb-3 space-y-2 max-h-[400px] overflow-y-auto">
                        {stage.clients.slice(0, 10).map((c: any) => (
                          <div key={c.clientId} className="p-2 rounded border bg-white hover:bg-slate-50 cursor-pointer text-xs"
                            onClick={() => navigate(`/cliente/${c.clientId}`)}>
                            <div className="font-medium truncate">{c.clientName}</div>
                            <div className="text-muted-foreground">{fmtBRL(c.totalDebt)}</div>
                            <div className="flex gap-1 mt-1">
                              {c.optOut && <Badge variant="destructive" className="text-[10px] px-1 py-0">Opt-Out</Badge>}
                              {!c.whatsappNumber && <Badge variant="secondary" className="text-[10px] px-1 py-0">Sem WA</Badge>}
                            </div>
                          </div>
                        ))}
                        {stage.count > 10 && <div className="text-center text-xs text-muted-foreground py-1">+{stage.count - 10} mais</div>}
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="table">
            <Card><CardContent className="pt-0">
              {loadingPipeline ? (
                <div className="flex items-center justify-center py-8"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Cliente</TableHead><TableHead>Estágio</TableHead><TableHead>Dívida</TableHead>
                    <TableHead>Títulos</TableHead><TableHead>Dias Atraso</TableHead><TableHead>WhatsApp</TableHead><TableHead>Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pipelineData?.stages?.flatMap(s =>
                      s.clients.map((c: any) => (
                        <TableRow key={`${s.stage}-${c.clientId}`} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/cliente/${c.clientId}`)}>
                          <TableCell className="font-medium text-sm">{c.clientName}</TableCell>
                          <TableCell><Badge className={`text-xs ${STAGE_COLORS[s.stage] || ""}`}>{STAGE_LABELS[s.stage]}</Badge></TableCell>
                          <TableCell className="text-sm font-semibold text-red-600">{fmtBRL(c.totalDebt)}</TableCell>
                          <TableCell className="text-sm">{c.openCount}</TableCell>
                          <TableCell className="text-sm">{c.maxDaysOverdue}d</TableCell>
                          <TableCell className="text-xs">{c.whatsappNumber || "—"}</TableCell>
                          <TableCell>{c.optOut ? <Badge variant="destructive" className="text-xs">Opt-Out</Badge> : <Badge variant="outline" className="text-xs">{c.clientStatus}</Badge>}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="blocked">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><ShieldOff className="h-4 w-4 text-red-500" /> Clientes Bloqueados ({blockedData?.total || 0})</CardTitle>
                {blockedData?.byReason && (
                  <div className="flex gap-2 flex-wrap mt-2">
                    {Object.entries(blockedData.byReason).map(([reason, count]) => (
                      <Badge key={reason} variant="outline" className="text-xs">{REASON_LABELS[reason] || reason}: {count as number}</Badge>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {loadingBlocked ? (
                  <div className="flex items-center justify-center py-8"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Cliente</TableHead><TableHead>Motivo</TableHead><TableHead>Dívida</TableHead><TableHead>Dias Atraso</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {!blockedData?.blocked?.length ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground"><CheckCircle className="h-6 w-6 mx-auto mb-2 text-green-400" />Nenhum cliente bloqueado</TableCell></TableRow>
                      ) : (
                        blockedData.blocked.map((b: any) => (
                          <TableRow key={b.clientId} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/cliente/${b.clientId}`)}>
                            <TableCell className="font-medium text-sm">{b.clientName}</TableCell>
                            <TableCell><Badge variant="destructive" className="text-xs">{REASON_LABELS[b.blockReason] || b.blockReason}</Badge></TableCell>
                            <TableCell className="text-sm text-red-600">{fmtBRL(b.totalDebt)}</TableCell>
                            <TableCell className="text-sm">{b.maxDaysOverdue}d</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="timeline">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" /> Envios Recentes (7 dias)</CardTitle></CardHeader>
              <CardContent>
                {loadingTimeline ? (
                  <div className="flex items-center justify-center py-8"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Cliente</TableHead><TableHead>Estágio</TableHead><TableHead>Status</TableHead>
                      <TableHead>Valor</TableHead><TableHead>Telefone</TableHead><TableHead>Data</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {!timelineData?.entries?.length ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum envio recente</TableCell></TableRow>
                      ) : (
                        timelineData.entries.map((e: any) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-sm">{e.clientName || "—"}</TableCell>
                            <TableCell><Badge className={`text-xs ${STAGE_COLORS[e.stage] || ""}`}>{STAGE_LABELS[e.stage] || e.stage}</Badge></TableCell>
                            <TableCell>
                              <Badge variant={e.status === "sent" ? "default" : e.status === "skipped" ? "secondary" : "destructive"} className="text-xs">
                                {e.status} {e.dryRun && "(dry)"}
                              </Badge>
                              {e.skipReason && <span className="text-xs text-muted-foreground ml-1">{e.skipReason}</span>}
                            </TableCell>
                            <TableCell className="text-xs">{fmtBRL(e.totalDebt)}</TableCell>
                            <TableCell className="text-xs">{e.phoneE164 || "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
