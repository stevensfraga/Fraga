import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  ArrowLeft, User, Phone, FileText, Clock, AlertTriangle,
  CheckCircle, XCircle, MessageSquare, Bot, ChevronRight,
  Download, ExternalLink, Copy, Send, Ban, Scale, Loader2
} from "lucide-react";
import { toast } from "sonner";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (v: string | null | undefined) => {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const fmtDateShort = (v: string | null | undefined) => {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
};

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "Pendente", variant: "secondary" },
    overdue: { label: "Vencido", variant: "destructive" },
    paid: { label: "Pago", variant: "default" },
    cancelled: { label: "Cancelado", variant: "outline" },
  };
  const s = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function reguaStageBadge(stage: string | null) {
  if (!stage) return <Badge variant="outline">Sem estágio</Badge>;
  const map: Record<string, string> = {
    d_minus_3: "D-3 (pré-vencimento)",
    d_0: "D0 (vencimento)",
    d_plus_3: "D+3",
    d_plus_7: "D+7",
    d_plus_15: "D+15",
  };
  return <Badge variant="secondary">{map[stage] ?? stage}</Badge>;
}

// ─── Componente de timeline ───────────────────────────────────────────────────

function TimelineEvent({ event }: { event: any }) {
  const [expanded, setExpanded] = useState(false);

  const icons = {
    regua: <MessageSquare className="w-4 h-4 text-blue-400" />,
    collection: <MessageSquare className="w-4 h-4 text-purple-400" />,
    inbound: <MessageSquare className="w-4 h-4 text-green-400" />,
    ai: <Bot className="w-4 h-4 text-yellow-400" />,
  };

  const labels = {
    regua: "Régua de cobrança",
    collection: "Mensagem de cobrança",
    inbound: "Resposta do cliente",
    ai: "IA processou",
  };

  const icon = icons[event.type as keyof typeof icons] ?? <Clock className="w-4 h-4 text-gray-400" />;
  const label = labels[event.type as keyof typeof labels] ?? event.type;

  let summary = "";
  if (event.type === "regua") {
    summary = `${event.data.stage} — ${event.data.status}${event.data.skipReason ? ` (${event.data.skipReason})` : ""}`;
  } else if (event.type === "collection") {
    summary = `${event.data.messageType} — ${event.data.status}`;
  } else if (event.type === "inbound") {
    summary = event.data.text?.slice(0, 80) ?? "";
  } else if (event.type === "ai") {
    summary = `Intent: ${event.data.intent}${event.data.handoffToHuman ? " → Handoff" : ""}`;
  }

  return (
    <div className="flex gap-3 py-3 border-b border-slate-700 last:border-0">
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-300">{label}</span>
          <span className="text-xs text-slate-500 whitespace-nowrap">{fmtDate(event.createdAt)}</span>
        </div>
        <p className="text-sm text-slate-400 mt-0.5 truncate">{summary}</p>
        {expanded && (
          <pre className="text-xs text-slate-500 mt-2 bg-slate-800 rounded p-2 overflow-auto max-h-40">
            {JSON.stringify(event.data, null, 2)}
          </pre>
        )}
        <button
          className="text-xs text-slate-500 hover:text-slate-300 mt-1"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? "Ocultar detalhes" : "Ver detalhes"}
        </button>
      </div>
    </div>
  );
}

// ─── Exportar CSV ─────────────────────────────────────────────────────────────

function exportCSV(rows: any[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? "")).join(","))
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function ClienteDossie() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const clientId = parseInt(id ?? "0", 10);

  // ── Modais de confirmação ──────────────────────────────────────────────────
  const [showLembrete, setShowLembrete] = useState(false);
  const [showOptOut, setShowOptOut] = useState(false);
  const [showJuridico, setShowJuridico] = useState(false);
  const [lembreteStage, setLembreteStage] = useState<string>("auto");

  const utils = trpc.useUtils();

  const sendLembreteMutation = trpc.clienteDossie.sendManual.useMutation({
    onSuccess: (data) => {
      toast.success(data.ok ? "Lembrete enviado!" : "Erro ao enviar", {
        description: data.ok
          ? `Estágio: ${data.stage} — ID: ${data.correlationId}`
          : String(data.error ?? "Falha desconhecida"),
      });
      setShowLembrete(false);
      utils.clienteDossie.timeline.invalidate({ clientId });
    },
    onError: (e: any) => toast.error("Erro ao enviar lembrete", { description: e.message }),
  });

  const setOptOutMutation = trpc.clienteDossie.setOptOut.useMutation({
    onSuccess: (data) => {
      toast.success(data.optOut ? "Opt-out registrado" : "Opt-out removido", {
        description: data.optOut
          ? "Cliente não receberá mais cobranças automáticas."
          : "Cliente voltará a receber cobranças automáticas.",
      });
      setShowOptOut(false);
      utils.clienteDossie.resumo.invalidate({ clientId });
    },
    onError: (e: any) => toast.error("Erro ao registrar opt-out", { description: e.message }),
  });

  const setJuridicoMutation = trpc.clienteDossie.setJuridico.useMutation({
    onSuccess: () => {
      toast.success("Escalado para jurídico", {
        description: "Cliente marcado como jurídico. Régua automática pausada.",
      });
      setShowJuridico(false);
      utils.clienteDossie.resumo.invalidate({ clientId });
      utils.clienteDossie.timeline.invalidate({ clientId });
    },
    onError: (e: any) => toast.error("Erro ao escalar para jurídico", { description: e.message }),
  });

  const resumoQuery = trpc.clienteDossie.resumo.useQuery({ clientId }, { enabled: clientId > 0 });
  const titulosQuery = trpc.clienteDossie.titulos.useQuery({ clientId }, { enabled: clientId > 0 });
  const timelineQuery = trpc.clienteDossie.timeline.useQuery({ clientId }, { enabled: clientId > 0 });

  const resumo = resumoQuery.data;
  const titulos = titulosQuery.data ?? [];
  const timeline = timelineQuery.data ?? [];

  const titulosAbertos = titulos.filter(t => t.status === "pending" || t.status === "overdue");
  const titulosPagos = titulos.filter(t => t.status === "paid");

  if (resumoQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Carregando dossiê...</div>
      </div>
    );
  }

  if (resumoQuery.isError || !resumo) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-red-400 text-sm">Cliente não encontrado ou erro ao carregar.</div>
      </div>
    );
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success("Copiado!", { description: text.slice(0, 40) });
    });
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="text-slate-400 hover:text-slate-100 gap-1 flex-shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              Voltar
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold truncate">{resumo.name}</h1>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {resumo.document && (
                  <span className="text-xs text-slate-400">{resumo.document}</span>
                )}
                {resumo.optOut && (
                  <Badge variant="destructive" className="text-xs">Opt-out</Badge>
                )}
                {(resumo as any).status === "juridico" && (
                  <Badge variant="destructive" className="text-xs bg-purple-700">Jurídico</Badge>
                )}
                <Badge variant={resumo.status === "active" ? "default" : "secondary"} className="text-xs">
                  {resumo.status === "active" ? "Ativo" : resumo.status}
                </Badge>
              </div>
            </div>
          </div>
          {/* Botões de ação */}
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs border-blue-600 text-blue-400 hover:bg-blue-900/30"
              onClick={() => setShowLembrete(true)}
              disabled={sendLembreteMutation.isPending}
            >
              {sendLembreteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Lembrete
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={`gap-1 text-xs ${
                resumo.optOut
                  ? "border-green-600 text-green-400 hover:bg-green-900/30"
                  : "border-yellow-600 text-yellow-400 hover:bg-yellow-900/30"
              }`}
              onClick={() => setShowOptOut(true)}
              disabled={setOptOutMutation.isPending}
            >
              {setOptOutMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
              {resumo.optOut ? "Remover Opt-out" : "Opt-out"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs border-purple-600 text-purple-400 hover:bg-purple-900/30"
              onClick={() => setShowJuridico(true)}
              disabled={setJuridicoMutation.isPending}
            >
              {setJuridicoMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scale className="w-3 h-3" />}
              Jurídico
            </Button>
          </div>
        </div>
      </div>

      {/* Modal: Lembrete Manual */}
      <Dialog open={showLembrete} onOpenChange={setShowLembrete}>
        <DialogContent className="bg-slate-800 border-slate-700 text-slate-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-4 h-4 text-blue-400" />
              Enviar Lembrete Manual
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-300">
              Enviar mensagem de cobrança manual para <strong>{resumo.name}</strong>.
              Será registrado em <code className="text-xs bg-slate-700 px-1 rounded">regua_audit</code> com <code className="text-xs bg-slate-700 px-1 rounded">trigger=manual</code>.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Estágio da mensagem</label>
              <Select value={lembreteStage} onValueChange={setLembreteStage}>
                <SelectTrigger className="bg-slate-700 border-slate-600 text-slate-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-700 border-slate-600">
                  <SelectItem value="auto">Auto (estágio atual calculado)</SelectItem>
                  <SelectItem value="d_minus_3">D-3 (pré-vencimento)</SelectItem>
                  <SelectItem value="d_0">D0 (vencimento)</SelectItem>
                  <SelectItem value="d_plus_3">D+3</SelectItem>
                  <SelectItem value="d_plus_7">D+7</SelectItem>
                  <SelectItem value="d_plus_15">D+15</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!resumo.whatsappNumber && (
              <div className="flex items-center gap-2 text-yellow-400 text-xs bg-yellow-900/20 border border-yellow-700 rounded p-2">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                Cliente sem WhatsApp cadastrado. O envio poderá falhar.
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowLembrete(false)}>Cancelar</Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
              disabled={sendLembreteMutation.isPending}
              onClick={() => sendLembreteMutation.mutate({
                clientId,
                stage: lembreteStage === "auto" ? undefined : lembreteStage as any,
              })}
            >
              {sendLembreteMutation.isPending ? (
                <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Enviando...</>
              ) : (
                <><Send className="w-3 h-3 mr-1" /> Enviar agora</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Opt-out */}
      <Dialog open={showOptOut} onOpenChange={setShowOptOut}>
        <DialogContent className="bg-slate-800 border-slate-700 text-slate-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="w-4 h-4 text-yellow-400" />
              {resumo.optOut ? "Remover Opt-out" : "Registrar Opt-out"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {resumo.optOut ? (
              <p className="text-sm text-slate-300">
                Remover o opt-out de <strong>{resumo.name}</strong>? O cliente voltará a receber cobranças automáticas da régua.
              </p>
            ) : (
              <p className="text-sm text-slate-300">
                Registrar opt-out para <strong>{resumo.name}</strong>? A régua automática será pausada e o motivo será gravado como <code className="text-xs bg-slate-700 px-1 rounded">OPT_OUT</code>.
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowOptOut(false)}>Cancelar</Button>
            <Button
              size="sm"
              className={resumo.optOut ? "bg-green-600 hover:bg-green-700" : "bg-yellow-600 hover:bg-yellow-700"}
              disabled={setOptOutMutation.isPending}
              onClick={() => setOptOutMutation.mutate({ clientId, optOut: !resumo.optOut })}
            >
              {setOptOutMutation.isPending ? (
                <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Salvando...</>
              ) : (
                resumo.optOut ? "Remover opt-out" : "Confirmar opt-out"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Jurídico */}
      <Dialog open={showJuridico} onOpenChange={setShowJuridico}>
        <DialogContent className="bg-slate-800 border-slate-700 text-slate-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-purple-400" />
              Escalar para Jurídico
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-slate-300">
              Marcar <strong>{resumo.name}</strong> como caso jurídico? A régua automática será pausada e o histórico completo (títulos + tentativas) será registrado para export.
            </p>
            <div className="mt-3 text-xs text-slate-400 bg-slate-700 rounded p-2">
              Total em aberto: <strong className="text-red-400">{fmtBRL(resumo.totalOpen)}</strong>
              {" • "}
              Maior atraso: <strong className="text-orange-400">{resumo.maxDaysOverdue}d</strong>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowJuridico(false)}>Cancelar</Button>
            <Button
              size="sm"
              className="bg-purple-600 hover:bg-purple-700"
              disabled={setJuridicoMutation.isPending}
              onClick={() => setJuridicoMutation.mutate({ clientId })}
            >
              {setJuridicoMutation.isPending ? (
                <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Salvando...</>
              ) : (
                <><Scale className="w-3 h-3 mr-1" /> Confirmar—escalar para jurídico</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Cards de resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-slate-400 mb-1">Total em aberto</div>
              <div className="text-xl font-bold text-red-400">{fmtBRL(resumo.totalOpen)}</div>
              <div className="text-xs text-slate-500 mt-1">{resumo.openCount} título(s)</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-slate-400 mb-1">Maior atraso</div>
              <div className="text-xl font-bold text-orange-400">{resumo.maxDaysOverdue}d</div>
              <div className="text-xs text-slate-500 mt-1">dias de atraso</div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-slate-400 mb-1">Estágio régua</div>
              <div className="mt-1">{reguaStageBadge(resumo.reguaStage)}</div>
              <div className="text-xs text-slate-500 mt-1">
                {resumo.lastDispatchAt ? `Último: ${fmtDateShort(resumo.lastDispatchAt)}` : "Sem disparos"}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4 pb-3">
              <div className="text-xs text-slate-400 mb-1">WhatsApp</div>
              <div className="text-sm font-medium text-slate-200 mt-1 truncate">
                {resumo.whatsappNumber ?? "Não cadastrado"}
              </div>
              {resumo.whatsappNumber && (
                <button
                  className="text-xs text-blue-400 hover:text-blue-300 mt-1 flex items-center gap-1"
                  onClick={() => copyToClipboard(resumo.whatsappNumber!)}
                >
                  <Copy className="w-3 h-3" /> Copiar
                </button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="titulos">
          <TabsList className="bg-slate-800 border border-slate-700 w-full overflow-x-auto flex-nowrap">
            <TabsTrigger value="titulos" className="flex-shrink-0">
              Títulos ({titulos.length})
            </TabsTrigger>
            <TabsTrigger value="timeline" className="flex-shrink-0">
              Timeline ({timeline.length})
            </TabsTrigger>
            <TabsTrigger value="info" className="flex-shrink-0">
              Informações
            </TabsTrigger>
          </TabsList>

          {/* Aba Títulos */}
          <TabsContent value="titulos" className="mt-4 space-y-4">
            {/* Em aberto */}
            {titulosAbertos.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-red-400">
                    Em aberto ({titulosAbertos.length})
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-slate-400"
                    onClick={() => exportCSV(titulosAbertos, `titulos_abertos_${clientId}.csv`)}
                  >
                    <Download className="w-3 h-3 mr-1" /> CSV
                  </Button>
                </div>
                <div className="space-y-2">
                  {titulosAbertos.map(t => (
                    <div
                      key={t.id}
                      className="bg-slate-800 border border-slate-700 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {statusBadge(t.status)}
                          <span className="text-sm font-semibold text-slate-100">{fmtBRL(t.amount)}</span>
                          {t.daysOverdue > 0 && (
                            <Badge variant="destructive" className="text-xs">{t.daysOverdue}d atraso</Badge>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Vencimento: {fmtDateShort(t.dueDate)}
                          {t.description && ` • ${t.description}`}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {t.dispatchCount} disparo(s)
                          {t.lastDispatchedAt && ` • Último: ${fmtDateShort(t.lastDispatchedAt)}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {t.link && (
                          <a
                            href={t.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" /> Boleto
                          </a>
                        )}
                        {t.linhaDigitavel && (
                          <button
                            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
                            onClick={() => copyToClipboard(t.linhaDigitavel!)}
                          >
                            <Copy className="w-3 h-3" /> Linha
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pagos */}
            {titulosPagos.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-green-400">
                    Pagos ({titulosPagos.length})
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-slate-400"
                    onClick={() => exportCSV(titulosPagos, `titulos_pagos_${clientId}.csv`)}
                  >
                    <Download className="w-3 h-3 mr-1" /> CSV
                  </Button>
                </div>
                <div className="space-y-2">
                  {titulosPagos.slice(0, 20).map(t => (
                    <div
                      key={t.id}
                      className="bg-slate-800 border border-slate-700 rounded-lg p-3 flex items-center gap-3"
                    >
                      <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-100">{fmtBRL(t.amount)}</span>
                          {t.daysOverdue > 0 && (
                            <span className="text-xs text-slate-400">({t.daysOverdue}d de atraso)</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">
                          Vencimento: {fmtDateShort(t.dueDate)}
                          {t.paidDate && ` • Pago: ${fmtDateShort(t.paidDate)}`}
                          {t.daysOverdue > 0 && ` • ${t.daysOverdue}d de atraso`}
                        </div>
                      </div>
                    </div>
                  ))}
                  {titulosPagos.length > 20 && (
                    <p className="text-xs text-slate-500 text-center">
                      + {titulosPagos.length - 20} títulos pagos (exporte CSV para ver todos)
                    </p>
                  )}
                </div>
              </div>
            )}

            {titulos.length === 0 && (
              <div className="text-center text-slate-500 py-8 text-sm">
                Nenhum título encontrado para este cliente.
              </div>
            )}
          </TabsContent>

          {/* Aba Timeline */}
          <TabsContent value="timeline" className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-300">
                Histórico de cobrança ({timeline.length} eventos)
              </h3>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-slate-400"
                onClick={() => exportCSV(
                  timeline.map(e => ({ type: e.type, createdAt: e.createdAt, ...e.data })),
                  `timeline_${clientId}.csv`
                )}
              >
                <Download className="w-3 h-3 mr-1" /> CSV
              </Button>
            </div>
            {timelineQuery.isLoading ? (
              <div className="text-center text-slate-500 py-8 text-sm">Carregando timeline...</div>
            ) : timeline.length === 0 ? (
              <div className="text-center text-slate-500 py-8 text-sm">
                Nenhum evento registrado para este cliente.
              </div>
            ) : (
              <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 divide-y divide-slate-700">
                {timeline.map((event, i) => (
                  <TimelineEvent key={`${event.type}-${event.id}-${i}`} event={event} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Aba Informações */}
          <TabsContent value="info" className="mt-4">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-sm text-slate-300">Dados cadastrais</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <InfoRow label="Nome" value={resumo.name} />
                  <InfoRow label="CNPJ/CPF" value={resumo.document} />
                  <InfoRow label="E-mail" value={resumo.email} />
                  <InfoRow label="CNAE" value={resumo.cnae} />
                  <InfoRow label="WhatsApp" value={resumo.whatsappNumber} />
                  <InfoRow label="Fonte WhatsApp" value={resumo.whatsappSource} />
                  <InfoRow label="Status" value={resumo.status} />
                  <InfoRow label="Opt-out" value={resumo.optOut ? "Sim" : "Não"} />
                  <InfoRow label="Próximo estágio" value={resumo.nextStage ?? "—"} />
                  <InfoRow label="Último disparo" value={fmtDate(resumo.lastDispatchAt)} />
                  <InfoRow label="Cadastrado em" value={fmtDate(resumo.createdAt)} />
                  <InfoRow label="Atualizado em" value={fmtDate(resumo.updatedAt)} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm text-slate-200">{value ?? "—"}</span>
    </div>
  );
}
