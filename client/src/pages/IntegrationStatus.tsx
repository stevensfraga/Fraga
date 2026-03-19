import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Network,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Download,
  Wrench,
  FileWarning,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

function formatCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return cnpj;
}

const INT_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; bg: string }> = {
  active:   { label: "Ativo",        color: "text-emerald-400", icon: <CheckCircle2 className="w-3.5 h-3.5" />, bg: "bg-emerald-500/10 border-emerald-500/20" },
  inactive: { label: "Inativo",      color: "text-gray-400",    icon: <XCircle className="w-3.5 h-3.5" />,      bg: "bg-gray-500/10 border-gray-500/20" },
  error:    { label: "Erro",         color: "text-red-400",     icon: <AlertTriangle className="w-3.5 h-3.5" />, bg: "bg-red-500/10 border-red-500/20" },
  unknown:  { label: "Desconhecido", color: "text-slate-400",   icon: <Activity className="w-3.5 h-3.5" />,     bg: "bg-slate-500/10 border-slate-500/20" },
};

function IntStatusBadge({ status }: { status: string }) {
  const cfg = INT_STATUS_CONFIG[status] ?? INT_STATUS_CONFIG.unknown;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${cfg.bg} ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

const CERT_STATUS_COLORS: Record<string, string> = {
  valid: "text-emerald-400",
  expiring_30: "text-yellow-400",
  expiring_15: "text-orange-400",
  expiring_7: "text-red-400",
  expired: "text-red-500",
  unknown: "text-slate-500",
};

// ─── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({ summary }: { summary: any }) {
  if (!summary) return null;
  const cards = [
    { label: "Total",          value: summary.total,                          color: "text-slate-300" },
    { label: "SIEG Ativo",     value: summary.sieg?.active ?? 0,              color: "text-emerald-400" },
    { label: "SIEG Inativo",   value: summary.sieg?.inactive ?? 0,            color: "text-gray-400" },
    { label: "SIEG Erro",      value: summary.sieg?.error ?? 0,               color: "text-red-400" },
    { label: "Dom. Ativo",     value: summary.dominio?.active ?? 0,           color: "text-emerald-400" },
    { label: "Dom. Inativo",   value: summary.dominio?.inactive ?? 0,         color: "text-gray-400" },
    { label: "Divergências",   value: summary.withDivergence,                 color: "text-amber-400" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
      {cards.map(c => (
        <div key={c.label} className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3 flex flex-col gap-1">
          <div className="text-xs font-medium text-slate-400">{c.label}</div>
          <div className={`text-2xl font-bold ${c.color}`}>{c.value ?? 0}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Edit Dialog ─────────────────────────────────────────────────────────────

function EditDialog({
  open, onClose, item, onSave,
}: {
  open: boolean;
  onClose: () => void;
  item: any;
  onSave: (data: any) => void;
}) {
  const [siegStatus, setSiegStatus] = useState<string>(item?.sieg_status ?? "unknown");
  const [siegNotes, setSiegNotes] = useState(item?.sieg_notes ?? "");
  const [dominioStatus, setDominioStatus] = useState<string>(item?.dominio_status ?? "unknown");
  const [dominioNotes, setDominioNotes] = useState(item?.dominio_notes ?? "");
  const [hasDivergence, setHasDivergence] = useState(item?.has_divergence ?? false);
  const [divergenceDetails, setDivergenceDetails] = useState(item?.divergence_details ?? "");
  const [manualNotes, setManualNotes] = useState(item?.manual_notes ?? "");

  const statusOptions = ["active", "inactive", "error", "unknown"];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-blue-400" />
            Editar Integração — {item ? formatCnpj(item.cnpj) : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {item?.company_name && (
            <div className="text-slate-300 font-medium">{item.company_name}</div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-slate-400 text-xs font-medium">Status SIEG</label>
              <Select value={siegStatus} onValueChange={setSiegStatus}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-100 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {statusOptions.map(s => <SelectItem key={s} value={s}>{INT_STATUS_CONFIG[s]?.label ?? s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-slate-400 text-xs font-medium">Status Domínio</label>
              <Select value={dominioStatus} onValueChange={setDominioStatus}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-100 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {statusOptions.map(s => <SelectItem key={s} value={s}>{INT_STATUS_CONFIG[s]?.label ?? s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-slate-400 text-xs font-medium">Observações SIEG</label>
            <Textarea value={siegNotes} onChange={e => setSiegNotes(e.target.value)}
              className="bg-slate-800 border-slate-600 text-slate-100 min-h-[60px] text-xs" />
          </div>
          <div className="space-y-1.5">
            <label className="text-slate-400 text-xs font-medium">Observações Domínio</label>
            <Textarea value={dominioNotes} onChange={e => setDominioNotes(e.target.value)}
              className="bg-slate-800 border-slate-600 text-slate-100 min-h-[60px] text-xs" />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="divergence" checked={hasDivergence}
              onChange={e => setHasDivergence(e.target.checked)}
              className="rounded border-slate-600" />
            <label htmlFor="divergence" className="text-slate-300 text-xs">Possui divergência</label>
          </div>
          {hasDivergence && (
            <div className="space-y-1.5">
              <label className="text-slate-400 text-xs font-medium">Detalhes da divergência</label>
              <Textarea value={divergenceDetails} onChange={e => setDivergenceDetails(e.target.value)}
                className="bg-slate-800 border-slate-600 text-slate-100 min-h-[60px] text-xs" />
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-slate-400 text-xs font-medium">Notas gerais</label>
            <Textarea value={manualNotes} onChange={e => setManualNotes(e.target.value)}
              className="bg-slate-800 border-slate-600 text-slate-100 min-h-[60px] text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-slate-400">Cancelar</Button>
          <Button onClick={() => onSave({ siegStatus, siegNotes, dominioStatus, dominioNotes, hasDivergence, divergenceDetails, manualNotes })}
            className="bg-blue-600 hover:bg-blue-700">Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IntegrationStatusPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [siegFilter, setSiegFilter] = useState("all");
  const [dominioFilter, setDominioFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [editItem, setEditItem] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("list");

  const summaryQ = trpc.integrationStatus.summary.useQuery(undefined, { refetchInterval: 60_000 });
  const listQ = trpc.integrationStatus.list.useQuery({
    siegStatus: siegFilter as any,
    dominioStatus: dominioFilter as any,
    search: search || undefined,
    page,
    pageSize: 50,
  });
  const diagnoseQ = trpc.integrationStatus.diagnose.useQuery(undefined, {
    enabled: activeTab === "diagnose",
  });

  const upsertMut = trpc.integrationStatus.upsert.useMutation({
    onSuccess: () => {
      toast.success("Integração atualizada");
      setEditItem(null);
      listQ.refetch();
      summaryQ.refetch();
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const resolveMut = trpc.integrationStatus.resolve.useMutation({
    onSuccess: () => {
      toast.success("Divergência marcada como resolvida");
      listQ.refetch();
      summaryQ.refetch();
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const importMut = trpc.integrationStatus.importFromClients.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.imported} empresas importadas`);
      listQ.refetch();
      summaryQ.refetch();
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
            <button onClick={() => navigate("/")} className="hover:text-slate-200 transition-colors">Dashboard</button>
            <ChevronRight className="w-3 h-3" />
            <span className="text-slate-200">Integrações Fiscais</span>
          </div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Network className="w-6 h-6 text-purple-400" />
            Integrações Fiscais
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Monitoramento de SIEG e Domínio por empresa
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { summaryQ.refetch(); listQ.refetch(); }}
            className="border-slate-600 text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Atualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => importMut.mutate()}
            disabled={importMut.isPending}
            className="border-slate-600 text-slate-300 hover:bg-slate-700"
          >
            <Download className="w-4 h-4 mr-1" />
            {importMut.isPending ? "Importando..." : "Importar Empresas"}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <SummaryCards summary={summaryQ.data} />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-800/60 border border-slate-700/50 mb-4">
          <TabsTrigger value="list" className="data-[state=active]:bg-slate-700 text-slate-300">
            Lista
          </TabsTrigger>
          <TabsTrigger value="diagnose" className="data-[state=active]:bg-slate-700 text-slate-300">
            Diagnóstico
          </TabsTrigger>
        </TabsList>

        {/* ─── Aba Lista ─── */}
        <TabsContent value="list">
          {/* Filtros */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar por CNPJ ou empresa..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500"
              />
            </div>
            <Select value={siegFilter} onValueChange={v => { setSiegFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36 bg-slate-800/60 border-slate-700 text-slate-100">
                <SelectValue placeholder="SIEG" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">SIEG: Todos</SelectItem>
                <SelectItem value="active">SIEG: Ativo</SelectItem>
                <SelectItem value="inactive">SIEG: Inativo</SelectItem>
                <SelectItem value="error">SIEG: Erro</SelectItem>
                <SelectItem value="unknown">SIEG: Desconhecido</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dominioFilter} onValueChange={v => { setDominioFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40 bg-slate-800/60 border-slate-700 text-slate-100">
                <SelectValue placeholder="Domínio" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">Domínio: Todos</SelectItem>
                <SelectItem value="active">Domínio: Ativo</SelectItem>
                <SelectItem value="inactive">Domínio: Inativo</SelectItem>
                <SelectItem value="error">Domínio: Erro</SelectItem>
                <SelectItem value="unknown">Domínio: Desconhecido</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-slate-400 text-sm self-center">{total} empresa(s)</span>
          </div>

          {/* Tabela */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
            {listQ.isLoading ? (
              <div className="p-12 text-center text-slate-400">Carregando...</div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center">
                <Network className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 font-medium">Nenhuma integração cadastrada</p>
                <p className="text-slate-500 text-sm mt-1">Clique em "Importar Empresas" para começar</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/50 bg-slate-900/40">
                      <th className="text-left px-4 py-3 text-slate-400 font-medium">Empresa / CNPJ</th>
                      <th className="text-left px-4 py-3 text-slate-400 font-medium">SIEG</th>
                      <th className="text-left px-4 py-3 text-slate-400 font-medium">Domínio</th>
                      <th className="text-left px-4 py-3 text-slate-400 font-medium hidden md:table-cell">Certificado</th>
                      <th className="text-left px-4 py-3 text-slate-400 font-medium hidden lg:table-cell">Divergência</th>
                      <th className="text-right px-4 py-3 text-slate-400 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30">
                    {items.map((item: any) => (
                      <tr key={item.id} className="hover:bg-slate-700/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-100">
                            {item.company_name || <span className="text-slate-500 italic">Sem nome</span>}
                          </div>
                          <div className="text-xs text-slate-400 font-mono">{formatCnpj(item.cnpj)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <IntStatusBadge status={item.sieg_status} />
                          {item.sieg_notes && (
                            <div className="text-xs text-slate-500 mt-0.5 max-w-[120px] truncate" title={item.sieg_notes}>
                              {item.sieg_notes}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <IntStatusBadge status={item.dominio_status} />
                          {item.dominio_notes && (
                            <div className="text-xs text-slate-500 mt-0.5 max-w-[120px] truncate" title={item.dominio_notes}>
                              {item.dominio_notes}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          {item.cert_status ? (
                            <div>
                              <span className={`text-xs font-medium ${CERT_STATUS_COLORS[item.cert_status] ?? "text-slate-400"}`}>
                                {item.cert_status === "valid" ? "Válido" :
                                 item.cert_status === "expired" ? "Vencido" :
                                 item.cert_status === "expiring_7" ? "Vence 7d" :
                                 item.cert_status === "expiring_15" ? "Vence 15d" :
                                 item.cert_status === "expiring_30" ? "Vence 30d" : "—"}
                              </span>
                              {item.cert_valid_to && (
                                <div className="text-xs text-slate-500">{formatDate(item.cert_valid_to)}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">Sem cert.</span>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {item.has_divergence ? (
                            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Divergência
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {item.has_divergence && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-amber-400 hover:text-amber-200"
                                title="Marcar como resolvido"
                                onClick={() => resolveMut.mutate({ cnpj: item.cnpj })}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-slate-400 hover:text-slate-200"
                              title="Editar"
                              onClick={() => setEditItem(item)}
                            >
                              <Wrench className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-slate-400 text-sm">Página {page} de {totalPages}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="border-slate-600 text-slate-300 hover:bg-slate-700">Anterior</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                  className="border-slate-600 text-slate-300 hover:bg-slate-700">Próxima</Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ─── Aba Diagnóstico ─── */}
        <TabsContent value="diagnose">
          {diagnoseQ.isLoading ? (
            <div className="p-12 text-center text-slate-400">Gerando diagnóstico...</div>
          ) : diagnoseQ.data ? (
            <div className="space-y-6">
              {/* Sem integração */}
              {diagnoseQ.data.noIntegration.length > 0 && (
                <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                  <h3 className="text-slate-200 font-semibold flex items-center gap-2 mb-3">
                    <FileWarning className="w-4 h-4 text-amber-400" />
                    Empresas ativas sem integração cadastrada ({diagnoseQ.data.noIntegration.length})
                  </h3>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {diagnoseQ.data.noIntegration.map((c: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-slate-700/30">
                        <span className="text-slate-300">{c.name || "—"}</span>
                        <span className="text-slate-500 font-mono text-xs">{formatCnpj(c.cnpj || "")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Problemas de certificado */}
              {diagnoseQ.data.certIssues.length > 0 && (
                <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                  <h3 className="text-slate-200 font-semibold flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    Integrações com certificado vencido ou ausente ({diagnoseQ.data.certIssues.length})
                  </h3>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {diagnoseQ.data.certIssues.map((c: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-slate-700/30">
                        <div>
                          <span className="text-slate-300">{c.company_name || "—"}</span>
                          <span className="text-slate-500 font-mono text-xs ml-2">{formatCnpj(c.cnpj || "")}</span>
                        </div>
                        <span className={`text-xs ${CERT_STATUS_COLORS[c.cert_status] ?? "text-slate-500"}`}>
                          {c.cert_status === "expired" ? "Vencido" : c.cert_status ? c.cert_status : "Sem cert."}
                          {c.cert_valid_to ? ` (${formatDate(c.cert_valid_to)})` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Erros SIEG */}
              {diagnoseQ.data.siegErrors.length > 0 && (
                <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                  <h3 className="text-slate-200 font-semibold flex items-center gap-2 mb-3">
                    <XCircle className="w-4 h-4 text-red-400" />
                    SIEG com erro ou inativo ({diagnoseQ.data.siegErrors.length})
                  </h3>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {diagnoseQ.data.siegErrors.map((c: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-slate-700/30">
                        <div>
                          <span className="text-slate-300">{c.company_name || "—"}</span>
                          <span className="text-slate-500 font-mono text-xs ml-2">{formatCnpj(c.cnpj || "")}</span>
                        </div>
                        <IntStatusBadge status={c.sieg_status} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Erros Domínio */}
              {diagnoseQ.data.dominioErrors.length > 0 && (
                <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                  <h3 className="text-slate-200 font-semibold flex items-center gap-2 mb-3">
                    <XCircle className="w-4 h-4 text-orange-400" />
                    Domínio com erro ou inativo ({diagnoseQ.data.dominioErrors.length})
                  </h3>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {diagnoseQ.data.dominioErrors.map((c: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-slate-700/30">
                        <div>
                          <span className="text-slate-300">{c.company_name || "—"}</span>
                          <span className="text-slate-500 font-mono text-xs ml-2">{formatCnpj(c.cnpj || "")}</span>
                        </div>
                        <IntStatusBadge status={c.dominio_status} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diagnoseQ.data.noIntegration.length === 0 &&
               diagnoseQ.data.certIssues.length === 0 &&
               diagnoseQ.data.siegErrors.length === 0 &&
               diagnoseQ.data.dominioErrors.length === 0 && (
                <div className="p-12 text-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                  <p className="text-emerald-300 font-medium">Nenhum problema encontrado</p>
                  <p className="text-slate-500 text-sm mt-1">Todas as integrações estão em ordem</p>
                </div>
              )}

              <p className="text-xs text-slate-500 text-right">
                Gerado em: {diagnoseQ.data.generatedAt ? new Date(diagnoseQ.data.generatedAt).toLocaleString("pt-BR") : "—"}
              </p>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      {/* Edit Dialog */}
      {editItem && (
        <EditDialog
          open={!!editItem}
          onClose={() => setEditItem(null)}
          item={editItem}
          onSave={(data) => upsertMut.mutate({
            cnpj: editItem.cnpj,
            companyName: editItem.company_name,
            ...data,
          })}
        />
      )}
    </div>
  );
}
