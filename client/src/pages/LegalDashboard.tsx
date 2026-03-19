import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Scale, FileText, Download, CheckCircle, Send, XCircle,
  Loader2, ArrowLeft, AlertTriangle, Search, Filter, RefreshCw,
  Eye, Plus, ChevronDown, ChevronUp, HelpCircle, Info
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Candidate {
  clientId: number;
  name: string;
  document: string;
  email: string;
  whatsapp: string;
  totalDebt: number;
  titlesCount: number;
  maxDaysOverdue: number;
  oldestDueDate: string;
  lastSentAt: string;
  sentAttempts: number;
  lastTemplateUsed: string;
  lastMessageId: string;
  lastCorrelationId: string;
  legalStage: "LEGAL_RECOMMENDED" | "PRE_LEGAL";
  reasonFlags: string[];
}

interface BlockSummary {
  totalWithDebt: number;
  totalBlocked: number;
  reasons: Record<string, number>;
}

interface DebugClient {
  clientId: number;
  name: string;
  totalDebt: number;
  maxDaysOverdue: number;
  sentAttempts: number;
  daysSinceLastSent: number | null;
  blockReasons: string[];
}

interface DebugInfo {
  topBlockedClients: DebugClient[];
  explanation: Record<string, string>;
}

interface CandidatesResponse {
  success: boolean;
  filters: any;
  summary: {
    totalCandidates: number;
    legalRecommended: number;
    preLegal: number;
    totalDebt: number;
    totalTitles: number;
  };
  blockSummary: BlockSummary;
  candidates: Candidate[];
  debug?: DebugInfo;
}

interface LegalCase {
  id: number;
  clientId: number;
  status: "draft" | "approved" | "sent_to_legal" | "closed";
  approvedBy: string | null;
  approvedAt: string;
  sentToLegalAt: string;
  closedAt: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  clientName: string;
  document: string;
  whatsapp: string;
}

interface CasesResponse {
  success: boolean;
  cases: LegalCase[];
}

// ─── Config ─────────────────────────────────────────────────────────────────

const ADMIN_KEY_STORAGE = "fraga_admin_key";

function getAdminKey(): string {
  return localStorage.getItem(ADMIN_KEY_STORAGE) || "";
}

async function apiFetch(path: string, options?: RequestInit) {
  const key = getAdminKey();
  const headers: Record<string, string> = {
    "x-admin-key": key,
    ...(options?.headers as Record<string, string> || {}),
  };
  if (options?.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`/api/legal${path}`, { ...options, headers });
  return res;
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    draft: "Rascunho",
    approved: "Aprovado",
    sent_to_legal: "Enviado ao Jurídico",
    closed: "Encerrado",
  };
  return map[s] || s;
}

function statusColor(s: string): string {
  const map: Record<string, string> = {
    draft: "bg-yellow-100 text-yellow-800 border-yellow-300",
    approved: "bg-blue-100 text-blue-800 border-blue-300",
    sent_to_legal: "bg-purple-100 text-purple-800 border-purple-300",
    closed: "bg-gray-100 text-gray-600 border-gray-300",
  };
  return map[s] || "bg-gray-100 text-gray-600";
}

function blockReasonLabel(r: string): string {
  const map: Record<string, string> = {
    NO_DISPATCH: "Sem cobrança enviada",
    LOW_DISPATCH: "Poucas cobranças",
    RECENT_MESSAGE: "Cobrança recente",
    LOW_DAYS: "Atraso insuficiente",
    LOW_DEBT: "Dívida baixa",
  };
  return map[r] || r;
}

function blockReasonColor(r: string): string {
  const map: Record<string, string> = {
    NO_DISPATCH: "bg-gray-100 text-gray-700",
    LOW_DISPATCH: "bg-orange-100 text-orange-700",
    RECENT_MESSAGE: "bg-blue-100 text-blue-700",
    LOW_DAYS: "bg-yellow-100 text-yellow-700",
    LOW_DEBT: "bg-green-100 text-green-700",
  };
  return map[r] || "bg-gray-100 text-gray-700";
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

export default function LegalDashboard() {
  const [, navigate] = useLocation();
  const [adminKey, setAdminKey] = useState(getAdminKey());
  const [isAuthenticated, setIsAuthenticated] = useState(!!getAdminKey());

  // Data
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateSummary, setCandidateSummary] = useState<CandidatesResponse["summary"] | null>(null);
  const [blockSummary, setBlockSummary] = useState<BlockSummary | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [casesLoading, setCasesLoading] = useState(false);

  // Filters — novos defaults relaxados
  const [minDays, setMinDays] = useState("60");
  const [minDebt, setMinDebt] = useState("500");
  const [minDispatches, setMinDispatches] = useState("2");
  const [lastSentDays, setLastSentDays] = useState("15");
  const [showFilters, setShowFilters] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Selection
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());
  const [selectedCases, setSelectedCases] = useState<Set<number>>(new Set());

  // Tab
  const [activeTab, setActiveTab] = useState("candidates");

  // ─── Auth ───────────────────────────────────────────────────────────────

  const handleLogin = () => {
    localStorage.setItem(ADMIN_KEY_STORAGE, adminKey);
    setIsAuthenticated(true);
    toast.success("Autenticado com sucesso");
  };

  // ─── Data Loading ───────────────────────────────────────────────────────

  const loadCandidates = useCallback(async (debug = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        minDaysOverdue: minDays,
        minTotalDebt: minDebt,
        minSentAttempts: minDispatches,
        lastSentOlderThanDays: lastSentDays,
      });
      if (debug) params.set("debug", "1");
      const res = await apiFetch(`/candidates?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Erro ao carregar candidatos");
      }
      const data: CandidatesResponse = await res.json();
      setCandidates(data.candidates);
      setCandidateSummary(data.summary);
      setBlockSummary(data.blockSummary || null);
      if (data.debug) {
        setDebugInfo(data.debug);
        setShowDebug(true);
      }
    } catch (err: any) {
      toast.error(err.message);
      if (err.message.includes("403") || err.message.includes("FORBIDDEN")) {
        setIsAuthenticated(false);
      }
    } finally {
      setLoading(false);
    }
  }, [minDays, minDebt, minDispatches, lastSentDays]);

  const loadCases = useCallback(async () => {
    setCasesLoading(true);
    try {
      const res = await apiFetch("/cases");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Erro ao carregar casos");
      }
      const data: CasesResponse = await res.json();
      setCases(data.cases);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCasesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadCandidates();
      loadCases();
    }
  }, [isAuthenticated, loadCandidates, loadCases]);

  // ─── Actions ────────────────────────────────────────────────────────────

  const createCases = async () => {
    if (selectedCandidates.size === 0) {
      toast.warning("Selecione pelo menos um candidato");
      return;
    }
    try {
      const res = await apiFetch("/cases/create", {
        method: "POST",
        body: JSON.stringify({ clientIds: Array.from(selectedCandidates) }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${data.totalCreated} caso(s) criado(s)`);
        if (data.skipped.length > 0) {
          data.skipped.forEach((s: any) => toast.info(`Ignorado: ${s.reason}`));
        }
        setSelectedCandidates(new Set());
        loadCases();
        setActiveTab("cases");
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const approveCases = async () => {
    const draftIds = Array.from(selectedCases).filter(id =>
      cases.find(c => c.id === id)?.status === "draft"
    );
    if (draftIds.length === 0) {
      toast.warning("Selecione pelo menos um rascunho para aprovar");
      return;
    }
    try {
      const res = await apiFetch("/cases/approve", {
        method: "POST",
        body: JSON.stringify({ caseIds: draftIds, approvedBy: "Stevens" }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${data.totalApproved} caso(s) aprovado(s)`);
        setSelectedCases(new Set());
        loadCases();
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const markSent = async () => {
    const approvedIds = Array.from(selectedCases).filter(id =>
      cases.find(c => c.id === id)?.status === "approved"
    );
    if (approvedIds.length === 0) {
      toast.warning("Selecione pelo menos um caso aprovado");
      return;
    }
    try {
      const res = await apiFetch("/cases/mark-sent", {
        method: "POST",
        body: JSON.stringify({ caseIds: approvedIds }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${data.totalMarked} caso(s) marcado(s) como enviado`);
        setSelectedCases(new Set());
        loadCases();
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const closeCases = async () => {
    const ids = Array.from(selectedCases).filter(id => {
      const c = cases.find(c => c.id === id);
      return c && c.status !== "closed";
    });
    if (ids.length === 0) {
      toast.warning("Selecione pelo menos um caso para encerrar");
      return;
    }
    try {
      const res = await apiFetch("/cases/close", {
        method: "POST",
        body: JSON.stringify({ caseIds: ids }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${data.totalClosed} caso(s) encerrado(s)`);
        setSelectedCases(new Set());
        loadCases();
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const exportCase = async (caseId: number) => {
    try {
      const res = await apiFetch(`/cases/export?caseId=${caseId}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `case_${caseId}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Download iniciado");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const exportBatch = async (status: string) => {
    try {
      const res = await apiFetch(`/cases/export-batch?status=${status}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `juridico_batch_${status}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Download iniciado");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // ─── Candidate selection ────────────────────────────────────────────────

  const toggleCandidate = (id: number) => {
    const next = new Set(selectedCandidates);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedCandidates(next);
  };

  const toggleAllCandidates = () => {
    if (selectedCandidates.size === filteredCandidates.length) {
      setSelectedCandidates(new Set());
    } else {
      setSelectedCandidates(new Set(filteredCandidates.map(c => c.clientId)));
    }
  };

  const toggleCase = (id: number) => {
    const next = new Set(selectedCases);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedCases(next);
  };

  const toggleAllCases = () => {
    if (selectedCases.size === filteredCases.length) {
      setSelectedCases(new Set());
    } else {
      setSelectedCases(new Set(filteredCases.map(c => c.id)));
    }
  };

  // ─── Filtered data ─────────────────────────────────────────────────────

  const filteredCandidates = candidates.filter(c =>
    !searchTerm || c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.document.includes(searchTerm) || c.whatsapp.includes(searchTerm)
  );

  const filteredCases = cases.filter(c =>
    !searchTerm || c.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.document.includes(searchTerm)
  );

  const draftCases = cases.filter(c => c.status === "draft");
  const approvedCases = cases.filter(c => c.status === "approved");
  const sentCases = cases.filter(c => c.status === "sent_to_legal");
  const closedCases = cases.filter(c => c.status === "closed");

  // ─── Auth Gate ──────────────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Scale className="w-12 h-12 mx-auto text-slate-700 mb-2" />
            <CardTitle className="text-xl">Módulo Jurídico</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Insira a chave de administrador para acessar</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="password"
              placeholder="Admin Key"
              value={adminKey}
              onChange={e => setAdminKey(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
            />
            <Button className="w-full" onClick={handleLogin}>Entrar</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Main UI ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Scale className="w-6 h-6 text-slate-700" />
            <h1 className="text-lg font-semibold text-slate-800">Módulo Jurídico</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente..."
                className="pl-9 w-64"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <Button variant="outline" size="icon" onClick={() => { loadCandidates(); loadCases(); }}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Summary Cards */}
        {candidateSummary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-slate-800">{candidateSummary.totalCandidates}</p>
                <p className="text-xs text-muted-foreground">Candidatos</p>
              </CardContent>
            </Card>
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-red-700">{candidateSummary.legalRecommended}</p>
                <p className="text-xs text-red-600">Recomendados</p>
              </CardContent>
            </Card>
            <Card className="border-yellow-200 bg-yellow-50">
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-yellow-700">{candidateSummary.preLegal}</p>
                <p className="text-xs text-yellow-600">Pré-Legal</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-slate-800">{fmtBRL(candidateSummary.totalDebt)}</p>
                <p className="text-xs text-muted-foreground">Dívida Total</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold text-slate-800">{candidateSummary.totalTitles}</p>
                <p className="text-xs text-muted-foreground">Títulos</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Block Summary — sempre visível quando há dados */}
        {blockSummary && blockSummary.totalBlocked > 0 && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-medium text-amber-800">
                    {blockSummary.totalWithDebt} clientes com dívida vencida — {blockSummary.totalBlocked} bloqueados pelos filtros
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-amber-700 border-amber-300 hover:bg-amber-100"
                  onClick={() => {
                    if (!debugInfo) {
                      loadCandidates(true);
                    } else {
                      setShowDebug(!showDebug);
                    }
                  }}
                >
                  <HelpCircle className="w-4 h-4 mr-1" />
                  {showDebug ? "Ocultar detalhes" : "Ver por que está vazio"}
                </Button>
              </div>

              {/* Motivos de bloqueio — sempre visível */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(blockSummary.reasons).map(([reason, count]) => (
                  <Badge key={reason} variant="outline" className={`${blockReasonColor(reason)} text-xs`}>
                    {blockReasonLabel(reason)}: {count}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Debug Panel — top 10 bloqueados */}
        {showDebug && debugInfo && (
          <Card className="border-amber-300 bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-amber-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Top 10 Clientes Bloqueados (maior dívida)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-amber-50/50">
                      <th className="p-2 text-left font-medium text-slate-600">Cliente</th>
                      <th className="p-2 text-right font-medium text-slate-600">Dívida</th>
                      <th className="p-2 text-center font-medium text-slate-600">Atraso Máx</th>
                      <th className="p-2 text-center font-medium text-slate-600">Envios</th>
                      <th className="p-2 text-center font-medium text-slate-600">Dias desde último</th>
                      <th className="p-2 text-left font-medium text-slate-600">Motivos do Bloqueio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debugInfo.topBlockedClients.map(c => (
                      <tr key={c.clientId} className="border-b hover:bg-slate-50">
                        <td className="p-2">
                          <div className="font-medium text-slate-800 text-xs">{c.name}</div>
                          <div className="text-xs text-muted-foreground">ID: {c.clientId}</div>
                        </td>
                        <td className="p-2 text-right font-medium text-red-600 text-xs">{fmtBRL(c.totalDebt)}</td>
                        <td className="p-2 text-center text-xs">
                          <span className={c.maxDaysOverdue >= 90 ? "text-red-600 font-medium" : "text-yellow-600"}>
                            {c.maxDaysOverdue}d
                          </span>
                        </td>
                        <td className="p-2 text-center text-xs">{c.sentAttempts}</td>
                        <td className="p-2 text-center text-xs">
                          {c.daysSinceLastSent !== null ? `${c.daysSinceLastSent}d` : "—"}
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            {c.blockReasons.map(r => (
                              <Badge key={r} variant="outline" className={`${blockReasonColor(r)} text-[10px] px-1.5 py-0`}>
                                {blockReasonLabel(r)}
                              </Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Legenda */}
              <div className="mt-3 pt-3 border-t">
                <p className="text-xs font-medium text-slate-500 mb-2">Legenda dos motivos:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {Object.entries(debugInfo.explanation).map(([key, desc]) => (
                    <div key={key} className="flex items-center gap-2 text-xs text-slate-600">
                      <Badge variant="outline" className={`${blockReasonColor(key)} text-[10px] px-1.5 py-0`}>
                        {key}
                      </Badge>
                      <span>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cases Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-yellow-200">
            <CardContent className="pt-3 pb-2 flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">{draftCases.length}</p>
                <p className="text-xs text-muted-foreground">Rascunhos</p>
              </div>
              <FileText className="w-5 h-5 text-yellow-500" />
            </CardContent>
          </Card>
          <Card className="border-blue-200">
            <CardContent className="pt-3 pb-2 flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">{approvedCases.length}</p>
                <p className="text-xs text-muted-foreground">Aprovados</p>
              </div>
              <CheckCircle className="w-5 h-5 text-blue-500" />
            </CardContent>
          </Card>
          <Card className="border-purple-200">
            <CardContent className="pt-3 pb-2 flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">{sentCases.length}</p>
                <p className="text-xs text-muted-foreground">Enviados</p>
              </div>
              <Send className="w-5 h-5 text-purple-500" />
            </CardContent>
          </Card>
          <Card className="border-gray-200">
            <CardContent className="pt-3 pb-2 flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">{closedCases.length}</p>
                <p className="text-xs text-muted-foreground">Encerrados</p>
              </div>
              <XCircle className="w-5 h-5 text-gray-400" />
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="candidates">
              <AlertTriangle className="w-4 h-4 mr-2" />
              Candidatos ({filteredCandidates.length})
            </TabsTrigger>
            <TabsTrigger value="cases">
              <Scale className="w-4 h-4 mr-2" />
              Casos ({cases.length})
            </TabsTrigger>
          </TabsList>

          {/* ── Tab: Candidatos ─────────────────────────────────────────── */}
          <TabsContent value="candidates" className="space-y-4">
            {/* Filters */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
                <Filter className="w-4 h-4 mr-1" />
                Filtros
                {showFilters ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
              </Button>
              {selectedCandidates.size > 0 && (
                <Button size="sm" onClick={createCases}>
                  <Plus className="w-4 h-4 mr-1" />
                  Criar {selectedCandidates.size} caso(s)
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => loadCandidates()} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </Button>
            </div>

            {showFilters && (
              <Card>
                <CardContent className="pt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Dias Atraso Mín</label>
                    <Input value={minDays} onChange={e => setMinDays(e.target.value)} type="number" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Dívida Mín (R$)</label>
                    <Input value={minDebt} onChange={e => setMinDebt(e.target.value)} type="number" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Envios Mín</label>
                    <Input value={minDispatches} onChange={e => setMinDispatches(e.target.value)} type="number" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Último Envio (dias)</label>
                    <Input value={lastSentDays} onChange={e => setLastSentDays(e.target.value)} type="number" />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Candidates Table */}
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="p-3 text-left">
                        <input
                          type="checkbox"
                          checked={selectedCandidates.size === filteredCandidates.length && filteredCandidates.length > 0}
                          onChange={toggleAllCandidates}
                          className="rounded"
                        />
                      </th>
                      <th className="p-3 text-left font-medium text-slate-600">Cliente</th>
                      <th className="p-3 text-right font-medium text-slate-600">Dívida</th>
                      <th className="p-3 text-center font-medium text-slate-600">Títulos</th>
                      <th className="p-3 text-center font-medium text-slate-600">Atraso Máx</th>
                      <th className="p-3 text-center font-medium text-slate-600">Envios</th>
                      <th className="p-3 text-left font-medium text-slate-600">Último Envio</th>
                      <th className="p-3 text-center font-medium text-slate-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                        </td>
                      </tr>
                    ) : filteredCandidates.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-muted-foreground">
                          <div className="space-y-2">
                            <AlertTriangle className="w-8 h-8 mx-auto text-amber-400" />
                            <p>Nenhum candidato atende todos os filtros atuais</p>
                            <p className="text-xs">
                              Clique em <strong>"Ver por que está vazio"</strong> acima para entender os bloqueios,
                              ou relaxe os filtros.
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredCandidates.map(c => (
                        <tr
                          key={c.clientId}
                          className={`border-b hover:bg-slate-50 cursor-pointer ${
                            selectedCandidates.has(c.clientId) ? "bg-blue-50" : ""
                          }`}
                          onClick={() => toggleCandidate(c.clientId)}
                        >
                          <td className="p-3">
                            <input
                              type="checkbox"
                              checked={selectedCandidates.has(c.clientId)}
                              onChange={() => toggleCandidate(c.clientId)}
                              onClick={e => e.stopPropagation()}
                              className="rounded"
                            />
                          </td>
                          <td className="p-3">
                            <div className="font-medium text-slate-800">{c.name}</div>
                            <div className="text-xs text-muted-foreground">{c.whatsapp}</div>
                          </td>
                          <td className="p-3 text-right font-medium text-red-600">{fmtBRL(c.totalDebt)}</td>
                          <td className="p-3 text-center">{c.titlesCount}</td>
                          <td className="p-3 text-center">
                            <span className={`font-medium ${c.maxDaysOverdue >= 90 ? "text-red-600" : "text-yellow-600"}`}>
                              {c.maxDaysOverdue}d
                            </span>
                          </td>
                          <td className="p-3 text-center">{c.sentAttempts}</td>
                          <td className="p-3 text-xs text-muted-foreground">{c.lastSentAt || "—"}</td>
                          <td className="p-3 text-center">
                            <Badge
                              variant="outline"
                              className={c.legalStage === "LEGAL_RECOMMENDED"
                                ? "bg-red-100 text-red-700 border-red-300"
                                : "bg-yellow-100 text-yellow-700 border-yellow-300"
                              }
                            >
                              {c.legalStage === "LEGAL_RECOMMENDED" ? "Recomendado" : "Pré-Legal"}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* ── Tab: Casos ──────────────────────────────────────────────── */}
          <TabsContent value="cases" className="space-y-4">
            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              {selectedCases.size > 0 && (
                <>
                  <Button size="sm" onClick={approveCases} className="bg-blue-600 hover:bg-blue-700">
                    <CheckCircle className="w-4 h-4 mr-1" />
                    Aprovar ({Array.from(selectedCases).filter(id => cases.find(c => c.id === id)?.status === "draft").length})
                  </Button>
                  <Button size="sm" onClick={markSent} className="bg-purple-600 hover:bg-purple-700">
                    <Send className="w-4 h-4 mr-1" />
                    Marcar Enviado ({Array.from(selectedCases).filter(id => cases.find(c => c.id === id)?.status === "approved").length})
                  </Button>
                  <Button size="sm" variant="outline" onClick={closeCases}>
                    <XCircle className="w-4 h-4 mr-1" />
                    Encerrar
                  </Button>
                </>
              )}
              <div className="ml-auto flex gap-2">
                {approvedCases.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => exportBatch("approved")}>
                    <Download className="w-4 h-4 mr-1" />
                    Export Aprovados ({approvedCases.length})
                  </Button>
                )}
                {sentCases.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => exportBatch("sent_to_legal")}>
                    <Download className="w-4 h-4 mr-1" />
                    Export Enviados ({sentCases.length})
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={loadCases} disabled={casesLoading}>
                  {casesLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {/* Cases Table */}
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="p-3 text-left">
                        <input
                          type="checkbox"
                          checked={selectedCases.size === filteredCases.length && filteredCases.length > 0}
                          onChange={toggleAllCases}
                          className="rounded"
                        />
                      </th>
                      <th className="p-3 text-left font-medium text-slate-600">#</th>
                      <th className="p-3 text-left font-medium text-slate-600">Cliente</th>
                      <th className="p-3 text-center font-medium text-slate-600">Status</th>
                      <th className="p-3 text-left font-medium text-slate-600">Aprovado por</th>
                      <th className="p-3 text-left font-medium text-slate-600">Criado em</th>
                      <th className="p-3 text-center font-medium text-slate-600">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {casesLoading ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                        </td>
                      </tr>
                    ) : filteredCases.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-muted-foreground">
                          Nenhum caso criado ainda. Selecione candidatos e clique em "Criar caso(s)".
                        </td>
                      </tr>
                    ) : (
                      filteredCases.map(c => (
                        <tr
                          key={c.id}
                          className={`border-b hover:bg-slate-50 ${
                            selectedCases.has(c.id) ? "bg-blue-50" : ""
                          }`}
                        >
                          <td className="p-3">
                            <input
                              type="checkbox"
                              checked={selectedCases.has(c.id)}
                              onChange={() => toggleCase(c.id)}
                              className="rounded"
                            />
                          </td>
                          <td className="p-3 text-muted-foreground">{c.id}</td>
                          <td className="p-3">
                            <div className="font-medium text-slate-800">{c.clientName}</div>
                            <div className="text-xs text-muted-foreground">{c.whatsapp}</div>
                          </td>
                          <td className="p-3 text-center">
                            <Badge variant="outline" className={statusColor(c.status)}>
                              {statusLabel(c.status)}
                            </Badge>
                          </td>
                          <td className="p-3 text-xs">{c.approvedBy || "—"}</td>
                          <td className="p-3 text-xs text-muted-foreground">{c.createdAt}</td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => navigate(`/client/${c.clientId}`)}
                                title="Ver histórico"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              {["approved", "sent_to_legal"].includes(c.status) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => exportCase(c.id)}
                                  title="Download dossiê"
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
