/**
 * Tela de Precificação de Honorários
 * Cards de resumo + tabela de empresas + simulador + ações
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  DollarSign, AlertTriangle, Calculator, RefreshCw, ArrowLeft,
  TrendingUp, Users, Building2, Search, ChevronLeft, ChevronRight,
  Clock, Pause, Check, X, ArrowUpDown, Database, Link2
} from "lucide-react";
import { useLocation } from "wouter";

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatCNPJ(cnpj: string): string {
  const clean = (cnpj || "").replace(/\D/g, "");
  if (clean.length !== 14) return cnpj || "";
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

// ── Summary Cards ──────────────────────────────────────────────────────
function SummaryCards() {
  const { data, isLoading } = trpc.pricing.summary.useQuery();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="pt-4 pb-4">
              <div className="h-4 bg-muted rounded w-24 mb-2" />
              <div className="h-8 bg-muted rounded w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const cards = [
    {
      title: "Empresas Ativas",
      value: data?.activeCompanies || 0,
      sub: `${data?.withFee || 0} com honorário`,
      icon: Building2,
      color: "text-blue-600",
    },
    {
      title: "Defasados",
      value: data?.defasados || 0,
      sub: `${data?.pendingSuggestions || 0} sugestões pendentes`,
      icon: AlertTriangle,
      color: data?.defasados ? "text-amber-600" : "text-green-600",
    },
    {
      title: "Fee Total Atual",
      value: formatBRL(data?.totalFeeAtual || 0),
      sub: "Receita mensal honorários",
      icon: DollarSign,
      color: "text-emerald-600",
    },
    {
      title: "Fee Sugerido Total",
      value: formatBRL(data?.totalFeeSugerido || 0),
      sub: data?.totalFeeSugerido && data?.totalFeeAtual
        ? `${data.totalFeeSugerido > data.totalFeeAtual ? "+" : ""}${formatBRL(data.totalFeeSugerido - data.totalFeeAtual)} diferença`
        : "Após recálculo",
      icon: TrendingUp,
      color: "text-indigo-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {cards.map((c) => (
        <Card key={c.title}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{c.title}</span>
              <c.icon className={`w-4 h-4 ${c.color}`} />
            </div>
            <div className="text-xl font-bold">{c.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{c.sub}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Company Table ──────────────────────────────────────────────────────
function CompanyTable() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("razaoSocial");
  const [sortDir, setSortDir] = useState<string>("asc");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [snoozeDialog, setSnoozeDialog] = useState<{ id: number; name: string } | null>(null);
  const [snoozeDays, setSnoozeDays] = useState(30);

  const debouncedSearch = useMemo(() => search, [search]);

  const { data, isLoading, refetch } = trpc.pricing.list.useQuery({
    page,
    perPage: 20,
    search: debouncedSearch || undefined,
    filter: filter as any,
    sortBy: sortBy as any,
    sortDir: sortDir as any,
  });

  const syncMutation = trpc.pricing.syncNow.useMutation({
    onSuccess: (result) => {
      toast.success(`Sync concluído: ${result.syncResult.synced} empresas, ${result.feesResult?.updated || 0} fees atualizados, ${result.pricingResult.defasados} defasados`);
      refetch();
    },
    onError: (err) => toast.error(`Erro no sync: ${err.message}`),
  });

  const syncCnpjMutation = trpc.pricing.syncCnpjAndFees.useMutation({
    onSuccess: (result) => {
      toast.success(`CNPJ Sync: ${result.cnpjSync.updated} CNPJs, ${result.match.matched} matches, ${result.fees.updated} fees atualizados`);
      refetch();
    },
    onError: (err) => toast.error(`Erro no sync CNPJ: ${err.message}`),
  });

  const snoozeMutation = trpc.pricing.snooze.useMutation({
    onSuccess: () => {
      toast.success("Snooze aplicado com sucesso");
      setSnoozeDialog(null);
      refetch();
    },
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
    setPage(1);
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por razão social ou CNPJ..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={filter} onValueChange={(v) => { setFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filtrar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="defasado">Defasadas</SelectItem>
            <SelectItem value="manual">Precificação Manual</SelectItem>
            <SelectItem value="pending">Sugestão Pendente</SelectItem>
            <SelectItem value="withFee">Com Honorário</SelectItem>
            <SelectItem value="noFee">Sem Honorário</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncCnpjMutation.mutate()}
          disabled={syncCnpjMutation.isPending}
        >
          <Link2 className={`w-4 h-4 mr-1 ${syncCnpjMutation.isPending ? "animate-spin" : ""}`} />
          {syncCnpjMutation.isPending ? "Vinculando..." : "Sync CNPJ + Fees"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          <RefreshCw className={`w-4 h-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Sincronizando..." : "Sync eKontrol"}
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="text-left p-3 font-medium cursor-pointer" onClick={() => toggleSort("razaoSocial")}>
                <div className="flex items-center gap-1">
                  Empresa <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="text-left p-3 font-medium">Regime</th>
              <th className="text-right p-3 font-medium cursor-pointer" onClick={() => toggleSort("feeAtual")}>
                <div className="flex items-center justify-end gap-1">
                  Fee Atual <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="text-right p-3 font-medium cursor-pointer" onClick={() => toggleSort("feeSugerido")}>
                <div className="flex items-center justify-end gap-1">
                  Fee Sugerido <ArrowUpDown className="w-3 h-3" />
                </div>
              </th>
              <th className="text-center p-3 font-medium">Status</th>
              <th className="text-center p-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b">
                  <td colSpan={6} className="p-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                </tr>
              ))
            ) : data?.items?.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  Nenhuma empresa encontrada
                </td>
              </tr>
            ) : (
              data?.items?.map((item: any) => {
                const feeAtual = parseFloat(item.honorarios_atual || "0");
                const feeSugerido = parseFloat(item.fee_sugerido || "0");
                const diff = feeSugerido - feeAtual;
                const diffPct = feeAtual > 0 ? ((diff / feeAtual) * 100) : 0;
                const isSnoozed = item.snoozed_until && new Date(item.snoozed_until) > new Date();

                return (
                  <tr
                    key={item.id}
                    className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedId(item.id)}
                  >
                    <td className="p-3">
                      <div className="font-medium text-sm">{item.razao_social}</div>
                      <div className="text-xs text-muted-foreground">{formatCNPJ(item.inscricao_federal)}</div>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-xs">
                        {item.regime_tributario || "N/I"}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      <div className="font-mono text-sm">
                        {feeAtual > 0 ? formatBRL(feeAtual) : <span className="text-muted-foreground">—</span>}
                      </div>
                      {feeAtual > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {item.honorarios_fonte === 'conta_azul_receivables' ? (
                            <span className="text-blue-500">via Conta Azul</span>
                          ) : item.honorarios_fonte === 'receivables_recorrentes' ? (
                            <span className="text-cyan-500">via Receivables</span>
                          ) : (
                            <span className="text-slate-400">via eKontrol</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {feeSugerido > 0 ? (
                        <div>
                          <span className="font-mono text-sm">{formatBRL(feeSugerido)}</span>
                          {diff !== 0 && feeAtual > 0 && (
                            <span className={`text-xs ml-1 ${diff > 0 ? "text-amber-600" : "text-green-600"}`}>
                              ({diff > 0 ? "+" : ""}{diffPct.toFixed(0)}%)
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {item.is_precificacao_manual ? (
                        <Badge className="bg-purple-100 text-purple-800 text-xs">Manual</Badge>
                      ) : item.is_defasado && !isSnoozed ? (
                        <Badge className="bg-amber-100 text-amber-800 text-xs">Defasado</Badge>
                      ) : isSnoozed ? (
                        <Badge className="bg-blue-100 text-blue-800 text-xs">
                          <Pause className="w-3 h-3 mr-1" />Snooze
                        </Badge>
                      ) : feeSugerido > 0 ? (
                        <Badge className="bg-green-100 text-green-800 text-xs">OK</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">Pendente</Badge>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {item.is_defasado && !isSnoozed && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setSnoozeDialog({ id: item.id, name: item.razao_social })}
                          >
                            <Clock className="w-3 h-3 mr-1" />Snooze
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            {data.total} empresas — Página {data.page} de {data.totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Dialog */}
      {selectedId && (
        <CompanyDetail id={selectedId} onClose={() => setSelectedId(null)} onRefresh={refetch} />
      )}

      {/* Snooze Dialog */}
      <Dialog open={!!snoozeDialog} onOpenChange={() => setSnoozeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Snooze Alerta — {snoozeDialog?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-3">Pausar alerta de defasagem por quantos dias?</p>
            <div className="flex gap-2">
              {[30, 60, 90].map((d) => (
                <Button
                  key={d}
                  variant={snoozeDays === d ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSnoozeDays(d)}
                >
                  {d} dias
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSnoozeDialog(null)}>Cancelar</Button>
            <Button
              onClick={() => snoozeDialog && snoozeMutation.mutate({ ekCompanyId: snoozeDialog.id, days: snoozeDays })}
              disabled={snoozeMutation.isPending}
            >
              {snoozeMutation.isPending ? "Aplicando..." : `Snooze ${snoozeDays} dias`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Company Detail ──────────────────────────────────────────────────────
function CompanyDetail({ id, onClose, onRefresh }: { id: number; onClose: () => void; onRefresh: () => void }) {
  const { data, isLoading } = trpc.pricing.detail.useQuery({ id });

  const applyMutation = trpc.pricing.applySuggestion.useMutation({
    onSuccess: () => {
      toast.success("Reajuste aplicado com sucesso");
      onRefresh();
      onClose();
    },
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  const dismissMutation = trpc.pricing.dismissSuggestion.useMutation({
    onSuccess: () => {
      toast.success("Sugestão dispensada");
      onRefresh();
    },
    onError: (err) => toast.error(`Erro: ${err.message}`),
  });

  if (isLoading) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-muted rounded w-48" />
            <div className="h-32 bg-muted rounded" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const company = data?.company;
  if (!company) return null;

  const feeAtual = parseFloat(company.honorarios_atual || "0");
  const feeSugerido = parseFloat(company.fee_sugerido || "0");
  const diff = feeSugerido - feeAtual;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{company.razao_social}</DialogTitle>
          <p className="text-sm text-muted-foreground">{formatCNPJ(company.inscricao_federal)} — {company.regime_tributario || "Regime N/I"}</p>
        </DialogHeader>

        {/* Fee Comparison */}
        <div className="grid grid-cols-3 gap-4 py-4">
          <Card>
            <CardContent className="pt-3 pb-3 text-center">
              <div className="text-xs text-muted-foreground">Fee Atual</div>
              <div className="text-lg font-bold">{feeAtual > 0 ? formatBRL(feeAtual) : "—"}</div>
              {feeAtual > 0 && (
                <div className="text-[10px] mt-1">
                  {company.honorarios_fonte === 'conta_azul_receivables' ? (
                    <span className="text-blue-500">Fonte: Conta Azul (recorrente)</span>
                  ) : company.honorarios_fonte === 'receivables_recorrentes' ? (
                    <span className="text-cyan-500">Fonte: Receivables</span>
                  ) : (
                    <span className="text-slate-400">Fonte: eKontrol</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 text-center">
              <div className="text-xs text-muted-foreground">Fee Sugerido</div>
              <div className="text-lg font-bold text-indigo-600">{feeSugerido > 0 ? formatBRL(feeSugerido) : "—"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-3 pb-3 text-center">
              <div className="text-xs text-muted-foreground">Diferença</div>
              <div className={`text-lg font-bold ${diff > 0 ? "text-amber-600" : diff < 0 ? "text-green-600" : ""}`}>
                {diff !== 0 ? `${diff > 0 ? "+" : ""}${formatBRL(diff)}` : "—"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Fee Breakdown */}
        {feeSugerido > 0 && (
          <div className="border rounded-lg p-4 mb-4">
            <h4 className="font-medium text-sm mb-3">Composição do Fee Sugerido</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Base ({company.regime_tributario})</span>
                <span className="font-mono">{formatBRL(parseFloat(company.fee_base || "0"))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Funcionários</span>
                <span className="font-mono">{formatBRL(parseFloat(company.fee_funcionarios || "0"))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Faturamento</span>
                <span className="font-mono">{formatBRL(parseFloat(company.fee_faturamento || "0"))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Complexidade (score {company.complexity_score || 0})</span>
                <span className="font-mono">{formatBRL(parseFloat(company.fee_complexidade || "0"))}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-medium">
                <span>Total</span>
                <span className="font-mono">{formatBRL(feeSugerido)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Suggestions */}
        {data?.suggestions && data.suggestions.length > 0 && (
          <div className="border rounded-lg p-4 mb-4">
            <h4 className="font-medium text-sm mb-3">Sugestões de Reajuste</h4>
            {data.suggestions.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <span className="text-sm">
                    {formatBRL(parseFloat(s.fee_anterior || "0"))} → {formatBRL(parseFloat(s.fee_sugerido || "0"))}
                  </span>
                  <Badge className="ml-2 text-xs" variant={s.status === "pending" ? "default" : "outline"}>
                    {s.status}
                  </Badge>
                </div>
                {s.status === "pending" && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-green-600"
                      onClick={() => applyMutation.mutate({
                        suggestionId: s.id,
                        feeAplicado: parseFloat(s.fee_sugerido),
                      })}
                      disabled={applyMutation.isPending}
                    >
                      <Check className="w-3 h-3 mr-1" />Aplicar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-red-600"
                      onClick={() => dismissMutation.mutate({ suggestionId: s.id })}
                      disabled={dismissMutation.isPending}
                    >
                      <X className="w-3 h-3 mr-1" />Dispensar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Audit */}
        {data?.audit && data.audit.length > 0 && (
          <div className="border rounded-lg p-4">
            <h4 className="font-medium text-sm mb-3">Histórico de Ações</h4>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {data.audit.slice(0, 10).map((a: any) => (
                <div key={a.id} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {new Date(a.created_at).toLocaleDateString("pt-BR")} — {a.action}
                  </span>
                  {a.performed_by && <span className="text-muted-foreground">{a.performed_by}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Fee Simulator ──────────────────────────────────────────────────────
function FeeSimulator() {
  const [regime, setRegime] = useState("Simples Nacional");
  const [funcionarios, setFuncionarios] = useState(0);
  const [faturamento, setFaturamento] = useState(0);
  const [notas, setNotas] = useState(0);
  const [lancamentos, setLancamentos] = useState(0);

  const { data } = trpc.pricing.simulate.useQuery({
    regime,
    funcionarios,
    faturamentoMensal: faturamento,
    notasEmitidas: notas,
    lancamentos,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          Simulador de Honorários
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Regime Tributário</label>
            <Select value={regime} onValueChange={setRegime}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Simples Nacional">Simples Nacional</SelectItem>
                <SelectItem value="Lucro Presumido">Lucro Presumido</SelectItem>
                <SelectItem value="Lucro Real">Lucro Real</SelectItem>
                <SelectItem value="MEI">MEI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Funcionários</label>
            <Input
              type="number"
              value={funcionarios}
              onChange={(e) => setFuncionarios(Number(e.target.value))}
              min={0}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Faturamento Mensal (R$)</label>
            <Input
              type="number"
              value={faturamento}
              onChange={(e) => setFaturamento(Number(e.target.value))}
              min={0}
              step={1000}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notas Emitidas/mês</label>
            <Input
              type="number"
              value={notas}
              onChange={(e) => setNotas(Number(e.target.value))}
              min={0}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Lançamentos/mês</label>
            <Input
              type="number"
              value={lancamentos}
              onChange={(e) => setLancamentos(Number(e.target.value))}
              min={0}
            />
          </div>
        </div>

        {data && (
          <div className="border rounded-lg p-4 bg-muted/30">
            <div className="flex items-center justify-between mb-4">
              <span className="font-medium">Fee Sugerido</span>
              <span className="text-2xl font-bold text-indigo-600">
                {data.isPrecificacaoManual ? "CONSULTAR" : formatBRL(data.feeSugerido)}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="text-center p-2 bg-background rounded">
                <div className="text-xs text-muted-foreground">Base</div>
                <div className="font-mono font-medium">{formatBRL(data.feeBase)}</div>
              </div>
              <div className="text-center p-2 bg-background rounded">
                <div className="text-xs text-muted-foreground">Funcionários</div>
                <div className="font-mono font-medium">{formatBRL(data.feeFuncionarios)}</div>
              </div>
              <div className="text-center p-2 bg-background rounded">
                <div className="text-xs text-muted-foreground">Faturamento</div>
                <div className="font-mono font-medium">{formatBRL(data.feeFaturamento)}</div>
              </div>
              <div className="text-center p-2 bg-background rounded">
                <div className="text-xs text-muted-foreground">Complexidade ({data.complexityScore}pts)</div>
                <div className="font-mono font-medium">{formatBRL(data.feeComplexidade)}</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function PricingDashboard() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Header */}
      <div className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="w-4 h-4 mr-1" />Voltar
            </Button>
            <div>
              <h1 className="text-lg font-bold text-slate-800">Precificação de Honorários</h1>
              <p className="text-xs text-muted-foreground">eKontrol × Motor de Precificação Fraga</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              <Building2 className="w-3 h-3 mr-1" />eKontrol
            </Badge>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <SummaryCards />

        <Tabs defaultValue="empresas" className="space-y-4">
          <TabsList>
            <TabsTrigger value="empresas">Empresas</TabsTrigger>
            <TabsTrigger value="simulador">Simulador</TabsTrigger>
          </TabsList>

          <TabsContent value="empresas">
            <CompanyTable />
          </TabsContent>

          <TabsContent value="simulador">
            <FeeSimulator />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
