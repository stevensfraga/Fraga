import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  RefreshCw,
  Search,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  History,
  FileKey,
  ScanLine,
  KeyRound,
  User,
  Send,
  SendHorizonal,
  Loader2,
  Wifi,
  WifiOff,
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

import { SiegReconPanel } from "@/components/SiegReconPanel";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

function daysUntil(d: string | Date | null | undefined): number | null {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  const diff = date.getTime() - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * Formata um nome extraído do arquivo PFX:
 * "ALCLARIN_CONSTRUCOES_LTDA" -> "Alclarin Construcoes Ltda"
 */
function formatFileName(name: string | null | undefined): string | null {
  if (!name) return null;
  // Remover CNPJ residual (11 ou 14 dígitos) e extensão
  const clean = name
    .replace(/\.(pfx|p12)$/i, "")
    .replace(/\d{11,14}/g, "")
    .replace(/_+/g, " ")
    .trim();
  if (!clean) return null;
  // Capitalizar cada palavra
  return clean
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatCnpj(cnpj: string): string {
  if (!cnpj || cnpj === "unknown") return cnpj || "—";
  const d = cnpj.replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return cnpj;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; bg: string }> = {
  valid:        { label: "Válido",        color: "text-emerald-400", icon: <ShieldCheck className="w-4 h-4" />, bg: "bg-emerald-500/10 border-emerald-500/20" },
  expiring_30:  { label: "Vence em 30d",  color: "text-yellow-400",  icon: <Shield className="w-4 h-4" />,      bg: "bg-yellow-500/10 border-yellow-500/20" },
  expiring_15:  { label: "Vence em 15d",  color: "text-orange-400",  icon: <ShieldAlert className="w-4 h-4" />, bg: "bg-orange-500/10 border-orange-500/20" },
  expiring_7:   { label: "Vence em 7d",   color: "text-red-400",     icon: <ShieldAlert className="w-4 h-4" />, bg: "bg-red-500/10 border-red-500/20" },
  expired:      { label: "Vencido",       color: "text-red-500",     icon: <ShieldX className="w-4 h-4" />,     bg: "bg-red-500/15 border-red-500/30" },
  invalid:      { label: "Inválido",      color: "text-gray-400",    icon: <XCircle className="w-4 h-4" />,     bg: "bg-gray-500/10 border-gray-500/20" },
  unknown:      { label: "Sem senha",     color: "text-amber-400",   icon: <KeyRound className="w-4 h-4" />,    bg: "bg-amber-500/10 border-amber-500/20" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${cfg.bg} ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({ summary, onFilterChange }: { summary: any; onFilterChange: (s: string) => void }) {
  if (!summary) return null;
  const cards = [
    { label: "Total",        value: summary.total,        color: "text-slate-300",  icon: <Shield className="w-5 h-5" />,       filter: "all" },
    { label: "Válidos",      value: summary.valid,        color: "text-emerald-400", icon: <ShieldCheck className="w-5 h-5" />, filter: "valid" },
    { label: "Vence 30d",    value: summary.expiring_30,  color: "text-yellow-400",  icon: <Shield className="w-5 h-5" />,       filter: "expiring_30" },
    { label: "Vence 15d",    value: summary.expiring_15,  color: "text-orange-400",  icon: <ShieldAlert className="w-5 h-5" />,  filter: "expiring_15" },
    { label: "Vence 7d",     value: summary.expiring_7,   color: "text-red-400",     icon: <ShieldAlert className="w-5 h-5" />,  filter: "expiring_7" },
    { label: "Vencidos",     value: summary.expired,      color: "text-red-500",     icon: <ShieldX className="w-5 h-5" />,      filter: "expired" },
    { label: "Sem senha",    value: summary.unknown,      color: "text-amber-400",   icon: <KeyRound className="w-5 h-5" />,     filter: "unknown" },
    { label: "Sem Cert.",    value: summary.withoutCertificate, color: "text-gray-400", icon: <AlertTriangle className="w-5 h-5" />, filter: "all" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
      {cards.map(c => (
        <button
          key={c.label}
          onClick={() => onFilterChange(c.filter)}
          className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3 flex flex-col gap-1 text-left hover:border-slate-500/70 transition-colors"
        >
          <div className={`flex items-center gap-1.5 ${c.color}`}>
            {c.icon}
            <span className="text-xs font-medium">{c.label}</span>
          </div>
          <div className={`text-2xl font-bold ${c.color}`}>{c.value ?? 0}</div>
        </button>
      ))}
    </div>
  );
}

// ─── Inline Password Input ────────────────────────────────────────────────────

function InlinePasswordInput({ cert, onSuccess, alwaysOpen = false }: { cert: any; onSuccess: () => void; alwaysOpen?: boolean }) {
  const [open, setOpen] = useState(alwaysOpen);
  const [pwd, setPwd] = useState("");

  const setPasswordMut = trpc.certificates.setPassword.useMutation({
    onSuccess: (data) => {
      if (data.certRead) {
        toast.success(`✅ Senha correta! Status: ${STATUS_CONFIG[data.status ?? ""]?.label ?? data.status}`);
        onSuccess();
        setOpen(alwaysOpen); // manter aberto se alwaysOpen
        setPwd("");
      } else {
        toast.error(data.error ?? "Senha incorreta — tente outra");
        setPwd("");
      }
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-amber-400 hover:text-amber-200 hover:bg-amber-500/10"
        title="Informar senha do certificado"
        onClick={() => setOpen(true)}
      >
        <KeyRound className="w-3.5 h-3.5 mr-1" />
        <span className="text-xs">Informar Senha</span>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="password"
        value={pwd}
        onChange={e => setPwd(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && pwd) setPasswordMut.mutate({ certificateId: cert.id, password: pwd });
          if (e.key === "Escape" && !alwaysOpen) { setOpen(false); setPwd(""); }
        }}
        placeholder="Digite a senha..."
        className="h-7 w-36 text-xs bg-slate-900 border-amber-500/40 text-slate-100 px-2"
      />
      <Button
        size="sm"
        className="h-7 px-2 bg-amber-600 hover:bg-amber-700 text-white text-xs"
        disabled={!pwd || setPasswordMut.isPending}
        onClick={() => setPasswordMut.mutate({ certificateId: cert.id, password: pwd })}
      >
        {setPasswordMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "OK"}
      </Button>
      {!alwaysOpen && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1 text-slate-500"
          onClick={() => { setOpen(false); setPwd(""); }}
        >
          ✕
        </Button>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Certificates() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedCert, setSelectedCert] = useState<any>(null);
  const [notesDialog, setNotesDialog] = useState(false);
  const [notesText, setNotesText] = useState("");
  const [historyDialog, setHistoryDialog] = useState(false);
  const [historyCnpj, setHistoryCnpj] = useState("");

  // Queries
  const summaryQ = trpc.certificates.summary.useQuery(undefined, { refetchInterval: 60_000 });
  const listQ = trpc.certificates.list.useQuery(
    { status: statusFilter as any, search: search || undefined, page, pageSize: 50 },
    {}
  );
  const folderQ = trpc.certificates.checkFolder.useQuery();
  const watcherQ = trpc.certificates.watcherStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const historyQ = trpc.certificates.history.useQuery(
    { cnpj: historyCnpj },
    { enabled: !!historyCnpj && historyDialog }
  );

  // Mutations
  const scannerMut = trpc.certificates.runScanner.useMutation({
    onSuccess: (data) => {
      toast.success(`Scanner concluído: ${data.scanned} escaneados, ${data.updated} atualizados${data.passwordFailed ? `, ${data.passwordFailed} sem senha` : ""}`);
      summaryQ.refetch();
      listQ.refetch();
    },
    onError: (e) => toast.error("Erro no scanner: " + e.message),
  });

  const updateNotesMut = trpc.certificates.updateNotes.useMutation({
    onSuccess: () => {
      toast.success("Notas salvas");
      setNotesDialog(false);
      listQ.refetch();
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);
  const unknownCount = summaryQ.data?.unknown ?? 0;

  // SIEG mutations
  const siegSendMut = trpc.certificates.siegSend.useMutation({
    onSuccess: (data: any) => {
      if (data.success) {
        toast.success(data.skipped ? "Certificado já enviado ao SIEG" : "✅ Certificado enviado ao SIEG com sucesso!");
      } else {
        toast.error("Erro SIEG: " + (data.error || "Erro desconhecido"));
      }
      listQ.refetch();
    },
    onError: (e) => toast.error("Erro ao enviar ao SIEG: " + e.message),
  });

  const siegSendAllMut = trpc.certificates.siegSendAll.useMutation({
    onSuccess: (data) => {
      toast.success(`SIEG: ${data.sent} enviados, ${data.failed} erros, ${data.skipped} ignorados`);
      listQ.refetch();
    },
    onError: (e) => toast.error("Erro ao enviar ao SIEG: " + e.message),
  });

  const siegTestQ = trpc.certificates.siegTestConnection.useQuery(undefined, { enabled: false });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
            <button onClick={() => navigate("/")} className="hover:text-slate-200 transition-colors">Dashboard</button>
            <ChevronRight className="w-3 h-3" />
            <span className="text-slate-200">Certificados Digitais</span>
          </div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-400" />
            Certificados Digitais A1
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Monitoramento de validade e gestão de certificados por empresa
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
            size="sm"
            onClick={() => scannerMut.mutate({ force: false })}
            disabled={scannerMut.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <ScanLine className="w-4 h-4 mr-1" />
            {scannerMut.isPending ? "Escaneando..." : "Escanear Pasta"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => siegSendAllMut.mutate({ force: false })}
            disabled={siegSendAllMut.isPending}
            className="border-purple-600/50 text-purple-300 hover:bg-purple-700/20"
            title="Enviar todos os certificados válidos ao SIEG"
          >
            <SendHorizonal className="w-4 h-4 mr-1" />
            {siegSendAllMut.isPending ? "Enviando..." : "Enviar ao SIEG"}
          </Button>
        </div>
      </div>

      {/* Alerta de certificados sem senha */}
      {unknownCount > 0 && (
        <div
          className="mb-4 px-4 py-3 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-300 text-sm flex items-center gap-2 cursor-pointer hover:bg-amber-500/15 transition-colors"
          onClick={() => { setStatusFilter("unknown"); setPage(1); }}
        >
          <KeyRound className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>{unknownCount} certificado{unknownCount !== 1 ? "s" : ""} sem senha válida</strong>
            {" "}— clique para filtrar e informar as senhas individualmente
          </span>
        </div>
      )}

      {/* Status do Watcher automático */}
      {watcherQ.data && (
        <div className={`mb-2 px-4 py-2 rounded-lg border text-xs flex items-center gap-2 ${
          watcherQ.data.active
            ? "bg-blue-500/10 border-blue-500/20 text-blue-300"
            : "bg-slate-700/40 border-slate-600/30 text-slate-400"
        }`}>
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
            watcherQ.data.active ? "bg-blue-400 animate-pulse" : "bg-slate-500"
          }`} />
          {watcherQ.data.active ? (
            <span>Watcher ativo — detecta novos certificados automaticamente em <code className="font-mono bg-black/20 px-1 rounded">{watcherQ.data.basePath}</code></span>
          ) : (
            <span>Watcher inativo — pasta não encontrada. Sincronize os arquivos para <code className="font-mono bg-black/20 px-1 rounded">/data/certificados</code> e reinicie o servidor.</span>
          )}
        </div>
      )}

      {/* Pasta monitorada */}
      {folderQ.data && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg border text-sm flex items-center gap-2 ${
          folderQ.data.found
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
            : "bg-amber-500/10 border-amber-500/20 text-amber-300"
        }`}>
          {folderQ.data.found ? (
            <>
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>Pasta monitorada: <code className="font-mono text-xs bg-black/20 px-1 rounded">{folderQ.data.basePath}</code> — {folderQ.data.fileCount} arquivo(s) encontrado(s)</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Nenhuma pasta de certificados encontrada. Crie a pasta <code className="font-mono text-xs bg-black/20 px-1 rounded">/data/certificados/CNPJ/</code> e coloque os arquivos .pfx lá.</span>
            </>
          )}
        </div>
      )}

      {/* Summary Cards — clicáveis para filtrar */}
      <SummaryCards
        summary={summaryQ.data}
        onFilterChange={(f) => { setStatusFilter(f); setPage(1); }}
      />

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Buscar por CNPJ, empresa ou cliente..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44 bg-slate-800/60 border-slate-700 text-slate-100">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="valid">Válidos</SelectItem>
            <SelectItem value="expiring_30">Vence em 30d</SelectItem>
            <SelectItem value="expiring_15">Vence em 15d</SelectItem>
            <SelectItem value="expiring_7">Vence em 7d</SelectItem>
            <SelectItem value="expired">Vencidos</SelectItem>
            <SelectItem value="unknown">Sem senha</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-slate-400 text-sm self-center">{total} resultado(s)</span>
      </div>

      {/* Tabela */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl overflow-hidden">
        {listQ.isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <Shield className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">Nenhum certificado encontrado</p>
            <p className="text-slate-500 text-sm mt-1">
              {folderQ.data?.found
                ? "Clique em 'Escanear Pasta' para importar os certificados"
                : "Configure a pasta de certificados no servidor"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50 bg-slate-900/40">
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Empresa / Cliente</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">CNPJ</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Vencimento</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium hidden md:table-cell">Arquivo</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium hidden lg:table-cell">SIEG</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {items.map((cert: any) => {
                  const days = daysUntil(cert.valid_to);
                  const isUnknown = cert.status === "unknown";
                  const displayName = cert.display_name || cert.company_name || formatFileName(cert.file_name);

                  return (
                    <tr key={cert.id} className={`hover:bg-slate-700/20 transition-colors ${isUnknown ? "bg-amber-500/5" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-100 flex items-center gap-1.5">
                          {cert.client_id && (
                            <User className="w-3 h-3 text-blue-400 flex-shrink-0" aria-label="Cliente vinculado" />
                          )}
                          {displayName || <span className="text-slate-500 italic">Sem nome</span>}
                        </div>
                        {cert.client_id && cert.company_name && cert.company_name !== displayName && (
                          <div className="text-xs text-slate-500 mt-0.5">{cert.company_name}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-slate-400 font-mono">
                          {cert.cnpj && cert.cnpj !== "unknown" ? formatCnpj(cert.cnpj) : <span className="text-slate-600">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={cert.status} />
                      </td>
                      <td className="px-4 py-3">
                        {isUnknown ? (
                          <span className="text-slate-600 text-xs">—</span>
                        ) : (
                          <>
                            <div className="text-slate-200">{formatDate(cert.valid_to)}</div>
                            {days !== null && (
                              <div className={`text-xs ${days < 0 ? "text-red-400" : days <= 7 ? "text-red-400" : days <= 15 ? "text-orange-400" : days <= 30 ? "text-yellow-400" : "text-slate-500"}`}>
                                {days < 0 ? `Venceu há ${Math.abs(days)} dias` : `Em ${days} dias`}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-xs text-slate-400 font-mono truncate max-w-[160px] block">
                          {cert.file_name || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {cert.sieg_status === "sent" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-500/10 border border-purple-500/20 text-purple-300">
                            <CheckCircle2 className="w-3 h-3" />
                            Enviado
                          </span>
                        ) : cert.sieg_status === "error" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 border border-red-500/20 text-red-400" title={cert.sieg_error}>
                            <XCircle className="w-3 h-3" />
                            Erro
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-700/40 border border-slate-600/30 text-slate-500">
                            <Clock className="w-3 h-3" />
                            Pendente
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Botão Informar Senha — apenas para unknown */}
                          {isUnknown && (
                            <InlinePasswordInput
                              cert={cert}
                              onSuccess={() => { listQ.refetch(); summaryQ.refetch(); }}
                              alwaysOpen={statusFilter === "unknown"}
                            />
                          )}
                          {/* Botão enviar ao SIEG — apenas para certificados não-unknown */}
                          {!isUnknown && cert.sieg_status !== "sent" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-purple-400 hover:text-purple-200 hover:bg-purple-500/10"
                              title="Enviar ao SIEG"
                              disabled={siegSendMut.isPending}
                              onClick={() => siegSendMut.mutate({ certificateId: cert.id })}
                            >
                              <Send className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-slate-400 hover:text-slate-200"
                            title="Histórico"
                            onClick={() => {
                              setHistoryCnpj(cert.cnpj);
                              setHistoryDialog(true);
                            }}
                          >
                            <History className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-slate-400 hover:text-slate-200"
                            title="Editar notas"
                            onClick={() => {
                              setSelectedCert(cert);
                              setNotesText(cert.notes ?? "");
                              setNotesDialog(true);
                            }}
                          >
                            <FileKey className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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

      {/* Painel de Reconciliação SIEG */}
      <div className="mt-6 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <SiegReconPanel />
      </div>

      {/* Dialog: Editar notas */}
      <Dialog open={notesDialog} onOpenChange={setNotesDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileKey className="w-5 h-5 text-blue-400" />
              Notas do Certificado
            </DialogTitle>
          </DialogHeader>
          {selectedCert && (
            <div className="space-y-3">
              <div className="text-sm text-slate-400">
                <span className="font-medium text-slate-200">{selectedCert.display_name || selectedCert.company_name || "Sem nome"}</span>
                <span className="mx-2">·</span>
                <span className="font-mono">{formatCnpj(selectedCert.cnpj)}</span>
              </div>
              <Textarea
                value={notesText}
                onChange={e => setNotesText(e.target.value)}
                placeholder="Observações sobre este certificado..."
                className="bg-slate-800 border-slate-600 text-slate-100 min-h-[100px]"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNotesDialog(false)} className="text-slate-400">Cancelar</Button>
            <Button
              onClick={() => selectedCert && updateNotesMut.mutate({ id: selectedCert.id, notes: notesText })}
              disabled={updateNotesMut.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Histórico */}
      <Dialog open={historyDialog} onOpenChange={setHistoryDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-blue-400" />
              Histórico de Versões — {formatCnpj(historyCnpj)}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {historyQ.isLoading ? (
              <p className="text-slate-400 text-sm">Carregando...</p>
            ) : (historyQ.data ?? []).length === 0 ? (
              <p className="text-slate-400 text-sm">Nenhum histórico encontrado</p>
            ) : (
              (historyQ.data ?? []).map((h: any) => (
                <div key={h.id} className={`p-3 rounded-lg border text-sm ${h.is_active ? "bg-blue-500/10 border-blue-500/20" : "bg-slate-800/40 border-slate-700/30"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <StatusBadge status={h.status} />
                    <span className="text-xs text-slate-500">{formatDate(h.created_at)}</span>
                  </div>
                  <div className="text-slate-300">Vence: {formatDate(h.valid_to)}</div>
                  <div className="text-xs text-slate-500 font-mono">{h.file_name}</div>
                  {h.is_active && <Badge className="mt-1 bg-blue-600/20 text-blue-300 text-xs">Versão ativa</Badge>}
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setHistoryDialog(false)} className="text-slate-400">Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
