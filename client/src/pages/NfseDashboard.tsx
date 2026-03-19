import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  FileText,
  Plus,
  Settings,
  RefreshCw,
  Download,
  XCircle,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Send,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Eye,
  Users,
  Building2,
  Trash2,
  UserPlus,
  ChevronDown,
  ChevronUp,
  Phone,
  TrendingUp,
  DollarSign,
  Activity,
  Zap,
} from "lucide-react";

// ─── Formatadores ──────────────────────────────────────────────────
function fmtBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(v);
}

function fmtCnpj(v: string): string {
  const d = (v || "").replace(/\D/g, "");
  if (d.length <= 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

function fmtDate(d: string | Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  rascunho: { label: "Rascunho", color: "bg-gray-100 text-gray-700", icon: FileText },
  em_processamento: { label: "Processando", color: "bg-blue-100 text-blue-700", icon: Clock },
  em_cancelamento: { label: "Cancelando...", color: "bg-orange-100 text-orange-700", icon: Clock },
  emitida: { label: "Emitida", color: "bg-green-100 text-green-700", icon: CheckCircle2 },
  erro: { label: "Erro", color: "bg-red-100 text-red-700", icon: AlertTriangle },
  cancelada: { label: "Cancelada", color: "bg-gray-200 text-gray-500", icon: XCircle },
};

// ─── Nova Emissão Dialog ───────────────────────────────────────────
function NovaEmissaoDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const configQuery = trpc.nfse.config.list.useQuery();
  const configs = configQuery.data || [];

  const [configId, setConfigId] = useState<number | null>(configs[0]?.id || null);
  const [tomadorSearch, setTomadorSearch] = useState("");

  const tomadoresQuery = trpc.nfse.tomadores.list.useQuery({
    configId: configId || undefined,
    search: tomadorSearch || undefined,
  });
  const tomadores = tomadoresQuery.data || [];

  const [form, setForm] = useState({
    tomadorId: null as number | null,
    tomadorNome: "",
    tomadorCpfCnpj: "",
    valor: "",
    competencia: (() => {
      const now = new Date();
      return `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
    })(),
    descricaoServico: "",
    emitirAgora: false,
  });

  const createMut = trpc.nfse.emissoes.create.useMutation({
    onSuccess: () => {
      utils.nfse.emissoes.list.invalidate();
      onClose();
      toast.success("Emissão criada com sucesso!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSelectTomador = (t: any) => {
    setForm({
      ...form,
      tomadorId: t.id,
      tomadorNome: t.nome,
      tomadorCpfCnpj: t.cpfCnpj,
    });
    setTomadorSearch(t.nome);
  };

  const handleSave = () => {
    if (!configId) { toast.error("Selecione o prestador"); return; }
    if (!form.valor || Number(form.valor) <= 0) { toast.error("Informe o valor"); return; }
    if (!form.competencia.match(/^\d{2}\/\d{4}$/)) { toast.error("Competência inválida (MM/AAAA)"); return; }

    createMut.mutate({
      configId,
      tomadorId: form.tomadorId || undefined,
      tomadorNome: form.tomadorNome || "N/A",
      tomadorCpfCnpj: form.tomadorCpfCnpj || "00000000000",
      valor: Number(form.valor),
      competencia: form.competencia,
      descricaoServico: form.descricaoServico || undefined,

    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" /> Nova Emissão de NFS-e
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Prestador *</Label>
            <Select
              value={configId?.toString() || ""}
              onValueChange={(v) => setConfigId(Number(v))}
            >
              <SelectTrigger><SelectValue placeholder="Selecione o prestador" /></SelectTrigger>
              <SelectContent>
                {configs.map((c: any) => (
                  <SelectItem key={c.id} value={c.id.toString()}>{c.razaoSocial}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Tomador (cliente)</Label>
            <Input
              value={tomadorSearch}
              onChange={(e) => { setTomadorSearch(e.target.value); setForm({ ...form, tomadorId: null, tomadorNome: e.target.value, tomadorCpfCnpj: "" }); }}
              placeholder="Buscar tomador cadastrado ou digitar nome..."
            />
            {tomadorSearch && tomadores.length > 0 && !form.tomadorId && (
              <div className="border rounded-md mt-1 max-h-32 overflow-y-auto bg-white shadow-sm">
                {tomadores.slice(0, 5).map((t: any) => (
                  <button
                    key={t.id}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b last:border-0"
                    onClick={() => handleSelectTomador(t)}
                  >
                    <span className="font-medium">{t.nome}</span>
                    <span className="text-gray-400 ml-2 font-mono text-xs">{fmtCnpj(t.cpfCnpj)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {!form.tomadorId && tomadorSearch && (
            <div>
              <Label>CPF/CNPJ do Tomador</Label>
              <Input
                value={form.tomadorCpfCnpj}
                onChange={(e) => setForm({ ...form, tomadorCpfCnpj: e.target.value })}
                placeholder="000.000.000-00 ou 00.000.000/0000-00"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Valor (R$) *</Label>
              <Input
                type="number"
                step="0.01"
                value={form.valor}
                onChange={(e) => setForm({ ...form, valor: e.target.value })}
                placeholder="0,00"
              />
            </div>
            <div>
              <Label>Competência *</Label>
              <Input
                value={form.competencia}
                onChange={(e) => setForm({ ...form, competencia: e.target.value })}
                placeholder="MM/AAAA"
              />
            </div>
          </div>

          <div>
            <Label>Descrição do Serviço</Label>
            <Textarea
              value={form.descricaoServico}
              onChange={(e) => setForm({ ...form, descricaoServico: e.target.value })}
              placeholder="Deixe em branco para usar a descrição padrão do prestador"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            variant="outline"
            onClick={() => { setForm({ ...form, emitirAgora: false }); handleSave(); }}
            disabled={createMut.isPending}
          >
            <FileText className="h-4 w-4 mr-1" /> Salvar Rascunho
          </Button>
          <Button
            onClick={() => { setForm({ ...form, emitirAgora: true }); handleSave(); }}
            disabled={createMut.isPending}
          >
            {createMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            Emitir Agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Detalhe Dialog ────────────────────────────────────────────────
function DetalheDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const detailQuery = trpc.nfse.emissoes.get.useQuery({ id });
  const d = detailQuery.data;

  if (!d?.emissao) return null;
  const e = d.emissao;
  const st = STATUS_MAP[e.status] || STATUS_MAP.rascunho;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            NFS-e #{e.id}
            <Badge className={`${st.color} text-xs ml-2`}>{st.label}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-gray-500">Prestador:</span>
              <p className="font-medium">{e.prestadorNome || "—"}</p>
            </div>
            <div>
              <span className="text-gray-500">CNPJ Prestador:</span>
              <p className="font-mono text-xs">{e.prestadorCnpj ? fmtCnpj(e.prestadorCnpj) : "—"}</p>
            </div>
            <div>
              <span className="text-gray-500">Tomador:</span>
              <p className="font-medium">{e.tomadorNome || "—"}</p>
            </div>
            <div>
              <span className="text-gray-500">CPF/CNPJ Tomador:</span>
              <p className="font-mono text-xs">{e.tomadorCpfCnpj ? fmtCnpj(e.tomadorCpfCnpj) : "—"}</p>
            </div>
            <div>
              <span className="text-gray-500">Valor:</span>
              <p className="font-bold text-lg">{fmtBRL(Number(e.valor))}</p>
            </div>
            <div>
              <span className="text-gray-500">Competência:</span>
              <p className="font-medium">{e.competencia}</p>
            </div>
            {e.numeroNf && (
              <div>
                <span className="text-gray-500">Número NF:</span>
                <p className="font-bold text-green-700">{e.numeroNf}</p>
              </div>
            )}
            {e.codigoVerificacao && (
              <div>
                <span className="text-gray-500">Cód. Verificação:</span>
                <p className="font-mono text-xs">{e.codigoVerificacao}</p>
              </div>
            )}
            <div>
              <span className="text-gray-500">Solicitado via:</span>
              <p>{e.solicitadoVia === "whatsapp" ? "WhatsApp" : "Dashboard"}</p>
            </div>
            <div>
              <span className="text-gray-500">Criado em:</span>
              <p>{fmtDate(e.createdAt)}</p>
            </div>
          </div>

          {e.descricaoServico && (
            <div>
              <span className="text-gray-500">Descrição:</span>
              <p className="mt-1 text-gray-700">{e.descricaoServico}</p>
            </div>
          )}

          {e.erroDetalhes && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <span className="text-red-600 font-medium">Erro:</span>
              <p className="text-red-700 text-xs mt-1">{e.erroDetalhes}</p>
            </div>
          )}

          {e.pdfUrl && (
            <div>
              <a href={e.pdfUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-1">
                  <Download className="h-4 w-4" /> Baixar PDF
                </Button>
              </a>
            </div>
          )}

          {d.audit && d.audit.length > 0 && (
            <div>
              <span className="text-gray-500 font-medium">Histórico:</span>
              <div className="mt-2 space-y-1">
                {d.audit.map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded px-2 py-1">
                    <Clock className="h-3 w-3" />
                    <span>{fmtDate(a.createdAt)}</span>
                    <Badge variant="outline" className="text-xs">{a.action}</Badge>
                    <span className="text-gray-400">{a.performedBy}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Empresas & Usuários Tab ───────────────────────────────────────
function EmpresasTab() {
  const utils = trpc.useUtils();
  const configsQuery = trpc.nfse.config.list.useQuery();
  const configs = (configsQuery.data || []) as any[];

  const toggleAtivoMut = trpc.nfse.config.toggleAtivo.useMutation({
    onSuccess: () => utils.nfse.config.list.invalidate(),
    onError: (e: any) => toast.error(e.message),
  });

  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {configs.length} empresa{configs.length !== 1 ? "s" : ""} cadastrada{configs.length !== 1 ? "s" : ""}
        </p>
        <Button variant="outline" size="sm" onClick={() => utils.nfse.config.list.invalidate()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
        </Button>
      </div>

      {configs.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Building2 className="h-10 w-10 mx-auto mb-2 text-gray-300" />
          <p>Nenhuma empresa cadastrada.</p>
          <p className="text-sm mt-1">Acesse Configurações para cadastrar empresas.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {configs.map((c: any) => (
            <Card key={c.id} className={`border ${!c.ativo ? "opacity-60" : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-gray-400 shrink-0" />
                    <div>
                      <p className="font-medium text-sm">{c.razaoSocial}</p>
                      <p className="text-xs text-gray-400 font-mono">{fmtCnpj(c.cnpj)}</p>
                      {c.portalNome && (
                        <p className="text-xs text-gray-400">Portal: {c.portalNome}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">{c.ativo ? "Ativo" : "Inativo"}</span>
                      <Switch
                        checked={!!c.ativo}
                        onCheckedChange={(v) => toggleAtivoMut.mutate({ id: c.id, ativo: v })}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                      className="gap-1 text-xs"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Usuários
                      {expandedId === c.id
                        ? <ChevronUp className="h-3.5 w-3.5" />
                        : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>

                {expandedId === c.id && (
                  <div className="mt-4 border-t pt-3">
                    <UsuariosSection configId={c.id} empresaNome={c.razaoSocial} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Usuários Section (dentro de cada empresa) ─────────────────────
function UsuariosSection({ configId, empresaNome }: { configId: number; empresaNome: string }) {
  const utils = trpc.useUtils();
  const listQuery = trpc.nfse.usuariosAutorizados.list.useQuery({ configId });
  const usuarios = (listQuery.data || []) as any[];

  const [showAdd, setShowAdd] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTel, setNovoTel] = useState("");

  const createMut = trpc.nfse.usuariosAutorizados.create.useMutation({
    onSuccess: () => {
      utils.nfse.usuariosAutorizados.list.invalidate({ configId });
      setNovoNome(""); setNovoTel(""); setShowAdd(false);
      toast.success("Usuário adicionado!");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleMut = trpc.nfse.usuariosAutorizados.toggle.useMutation({
    onSuccess: () => utils.nfse.usuariosAutorizados.list.invalidate({ configId }),
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = trpc.nfse.usuariosAutorizados.delete.useMutation({
    onSuccess: () => {
      utils.nfse.usuariosAutorizados.list.invalidate({ configId });
      toast.success("Usuário removido");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-600 flex items-center gap-1">
          <Phone className="h-3.5 w-3.5" />
          Usuários autorizados WhatsApp — {empresaNome}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => setShowAdd(!showAdd)}
        >
          <UserPlus className="h-3.5 w-3.5" /> Adicionar
        </Button>
      </div>

      {showAdd && (
        <div className="bg-gray-50 rounded-md p-3 mb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input
                className="h-8 text-sm"
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Nome do usuário"
              />
            </div>
            <div>
              <Label className="text-xs">Telefone (com DDD)</Label>
              <Input
                className="h-8 text-sm"
                value={novoTel}
                onChange={(e) => setNovoTel(e.target.value)}
                placeholder="5527999999999"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAdd(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!novoNome || !novoTel || createMut.isPending}
              onClick={() => createMut.mutate({ configId, nome: novoNome, telefone: novoTel })}
            >
              {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
            </Button>
          </div>
        </div>
      )}

      {listQuery.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando...
        </div>
      ) : usuarios.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">Nenhum usuário autorizado. Qualquer telefone pode usar enquanto a lista estiver vazia.</p>
      ) : (
        <div className="space-y-1">
          {usuarios.map((u: any) => (
            <div key={u.id} className="flex items-center justify-between bg-white border rounded px-3 py-1.5">
              <div>
                <span className="text-sm font-medium">{u.nome}</span>
                <span className="text-xs text-gray-400 font-mono ml-2">{u.telefone}</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!u.ativo}
                  onCheckedChange={(v) => toggleMut.mutate({ id: u.id, ativo: v })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-red-400 hover:text-red-600"
                  onClick={() => {
                    if (confirm(`Remover ${u.nome}?`)) deleteMut.mutate({ id: u.id });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────
export default function NfseDashboard() {
  const [, navigate] = useLocation();
  const [showNovaEmissao, setShowNovaEmissao] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Competência atual (MM/AAAA)
  const now = new Date();
  const competenciaAtual = `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;

  // Métricas reais do mês
  const metricsQuery = trpc.nfse.emissoes.metrics.useQuery({ competencia: competenciaAtual });
  const metrics = metricsQuery.data;

  // Fila em tempo real — polling a cada 5 segundos
  const filaQuery = trpc.nfse.emissoes.fila.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const fila = filaQuery.data;

  // Re-buscar métricas quando a fila mudar (item saiu do processamento)
  useEffect(() => {
    metricsQuery.refetch();
  }, [fila?.processando?.length]);

  const listQuery = trpc.nfse.emissoes.list.useQuery({
    page,
    perPage: 20,
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const emitMut = trpc.nfse.emissoes.emit.useMutation({
    onSuccess: () => { listQuery.refetch(); metricsQuery.refetch(); toast.success("NFS-e enviada para emissão!"); },
    onError: (e: any) => toast.error(e.message),
  });
  const reprocessMut = trpc.nfse.emissoes.retry.useMutation({
    onSuccess: () => { listQuery.refetch(); metricsQuery.refetch(); toast.success("Reprocessamento iniciado!"); },
    onError: (e: any) => toast.error(e.message),
  });
  const cancelMut = trpc.nfse.emissoes.cancel.useMutation({
    onSuccess: () => { listQuery.refetch(); metricsQuery.refetch(); toast.success("Emissão cancelada"); },
    onError: (e: any) => toast.error(e.message),
  });
  const cancelarNaPrefeituraMut = trpc.nfse.emissoes.cancelarNaPrefeitura.useMutation({
    onSuccess: (data) => {
      listQuery.refetch(); metricsQuery.refetch();
      toast.success(`Cancelamento da NFS-e ${data.numeroNf} iniciado — aguarde alguns minutos.`);
    },
    onError: (e: any) => toast.error(`Erro ao cancelar no portal: ${e.message}`),
  });

  const [cancelConfirm, setCancelConfirm] = useState<{ id: number; numeroNf: string; tomadorNome: string } | null>(null);
  const [cancelJustificativa, setCancelJustificativa] = useState("");

  const list = listQuery.data;
  const totais = metrics?.totais as any;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Emissão de NFS-e
              </h1>
              <p className="text-sm text-gray-500">Gestão de Notas Fiscais de Serviço</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/nfse-config")}>
              <Settings className="h-4 w-4 mr-1" /> Configurações
            </Button>
            <Button size="sm" onClick={() => setShowNovaEmissao(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nova NFS-e
            </Button>
          </div>
        </div>
      </div>

      {/* KPIs — métricas reais do mês */}
      <div className="max-w-7xl mx-auto px-6 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-600 flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4" />
            Competência: <span className="font-bold text-gray-800">{competenciaAtual}</span>
          </p>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => metricsQuery.refetch()}>
            <RefreshCw className={`h-3.5 w-3.5 ${metricsQuery.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-green-500">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Emitidas
              </p>
              <p className="text-2xl font-bold text-green-700">{totais?.emitidas ?? "—"}</p>
              <p className="text-xs text-gray-400">{totais ? fmtBRL(Number(totais.valorEmitido)) : "—"}</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-gray-400">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1">
                <DollarSign className="h-3 w-3" /> Total Faturado
              </p>
              <p className="text-2xl font-bold text-gray-700">{totais?.total ?? "—"}</p>
              <p className="text-xs text-gray-400">{totais ? fmtBRL(Number(totais.valorTotal)) : "—"}</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 ${(fila?.processando?.length ?? 0) > 0 ? "border-l-blue-500" : "border-l-gray-200"}`}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1">
                <Activity className={`h-3 w-3 ${(fila?.processando?.length ?? 0) > 0 ? "animate-pulse text-blue-500" : ""}`} />
                Processando agora
              </p>
              <p className={`text-2xl font-bold ${(fila?.processando?.length ?? 0) > 0 ? "text-blue-600" : "text-gray-400"}`}>
                {fila?.processando?.length ?? 0}
              </p>
              <p className="text-xs text-gray-400">Mês: {totais?.processando ?? 0}</p>
            </CardContent>
          </Card>
          <Card className={`border-l-4 ${(fila?.errosRecentes?.length ?? 0) > 0 ? "border-l-red-500" : "border-l-gray-200"}`}>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Erros (24h)
              </p>
              <p className={`text-2xl font-bold ${(fila?.errosRecentes?.length ?? 0) > 0 ? "text-red-600" : "text-gray-400"}`}>
                {fila?.errosRecentes?.length ?? 0}
              </p>
              <p className="text-xs text-gray-400">Mês: {totais?.erros ?? 0}</p>
            </CardContent>
          </Card>
        </div>

        {/* Fila de processamento em tempo real */}
        {(fila?.processando?.length ?? 0) > 0 && (
          <Card className="border-blue-200 bg-blue-50">
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-sm flex items-center gap-2 text-blue-700">
                <Zap className="h-4 w-4 animate-pulse" />
                Fila de Processamento — ao vivo
                <span className="ml-auto text-xs font-normal text-blue-500">atualiza a cada 5s</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="space-y-2">
                {fila!.processando.map((e: any) => (
                  <div key={e.id} className="flex items-center justify-between bg-white rounded border border-blue-100 px-3 py-2">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{e.tomadorNome}</p>
                        <p className="text-xs text-gray-400">{e.prestadorNome} · {e.competencia} · {fmtBRL(Number(e.valor))}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">#{e.id}</p>
                      <p className="text-xs text-gray-400">{fmtDate(e.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Alertas de erros recentes */}
        {(fila?.errosRecentes?.length ?? 0) > 0 && (
          <Card className="border-red-200 bg-red-50">
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-sm flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-4 w-4" />
                Erros nas últimas 24h
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="space-y-2">
                {fila!.errosRecentes.map((e: any) => (
                  <div key={e.id} className="flex items-start justify-between bg-white rounded border border-red-100 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{e.tomadorNome}
                        <span className="ml-2 text-xs text-gray-400">#{e.id}</span>
                      </p>
                      <p className="text-xs text-gray-500">{e.prestadorNome} · {fmtBRL(Number(e.valor))}</p>
                      {e.erroDetalhes && (
                        <p className="text-xs text-red-600 mt-0.5 truncate max-w-lg">{e.erroDetalhes}</p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs ml-3 shrink-0 border-red-200 text-red-600 hover:bg-red-50"
                      onClick={() => reprocessMut.mutate({ id: e.id })}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" /> Reprocessar
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Breakdown por empresa */}
        {metrics?.porEmpresa && metrics.porEmpresa.length > 1 && (
          <Card>
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-sm text-gray-700">Por empresa — {competenciaAtual}</CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="space-y-2">
                {(metrics.porEmpresa as any[]).map((emp: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">{emp.razaoSocial || "—"}</span>
                    <div className="flex items-center gap-4 text-right">
                      <span className="text-green-600 font-medium">{emp.emitidas} emitidas</span>
                      <span className="text-gray-500 font-mono">{fmtBRL(Number(emp.valorEmitido))}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tabs: Emissões | Empresas & Usuários */}
      <div className="max-w-7xl mx-auto px-6 pb-6">
        <Tabs defaultValue="emissoes">
          <TabsList className="mb-4">
            <TabsTrigger value="emissoes" className="gap-1.5">
              <FileText className="h-4 w-4" /> Emissões
            </TabsTrigger>
            <TabsTrigger value="empresas" className="gap-1.5">
              <Building2 className="h-4 w-4" /> Empresas & Usuários
            </TabsTrigger>
          </TabsList>

          {/* ── Aba Emissões ── */}
          <TabsContent value="emissoes">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Emissões</CardTitle>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Buscar por tomador ou NF..."
                      className="pl-9 w-56"
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os status</SelectItem>
                      <SelectItem value="rascunho">Rascunho</SelectItem>
                      <SelectItem value="em_processamento">Processando</SelectItem>
                      <SelectItem value="em_cancelamento">Cancelando</SelectItem>
                      <SelectItem value="emitida">Emitida</SelectItem>
                      <SelectItem value="erro">Erro</SelectItem>
                      <SelectItem value="cancelada">Cancelada</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={() => listQuery.refetch()}>
                    <RefreshCw className={`h-4 w-4 ${listQuery.isFetching ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {(!list || list.rows.length === 0) ? (
                  <div className="text-center py-16 text-gray-500">
                    <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">Nenhuma emissão encontrada</p>
                    <p className="text-sm mt-1">Clique em "Nova NFS-e" para criar a primeira emissão</p>
                  </div>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Tomador</TableHead>
                          <TableHead>Valor</TableHead>
                          <TableHead>Competência</TableHead>
                          <TableHead>Nº NF</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Via</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {list.rows.map((e: any) => {
                          const st = STATUS_MAP[e.status] || STATUS_MAP.rascunho;
                          const StIcon = st.icon;
                          return (
                            <TableRow key={e.id} className="hover:bg-gray-50">
                              <TableCell className="font-mono text-xs text-gray-400">{e.id}</TableCell>
                              <TableCell>
                                <div>
                                  <p className="font-medium text-sm">{e.tomadorNome || "—"}</p>
                                  {e.tomadorCpfCnpj && (
                                    <p className="text-xs text-gray-400 font-mono">{fmtCnpj(e.tomadorCpfCnpj)}</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="font-medium">{fmtBRL(Number(e.valor))}</TableCell>
                              <TableCell>{e.competencia}</TableCell>
                              <TableCell>
                                {e.numeroNf ? (
                                  <span className="font-mono text-green-700 font-medium">{e.numeroNf}</span>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge className={`${st.color} text-xs gap-1`}>
                                  <StIcon className="h-3 w-3" />
                                  {st.label}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">
                                  {e.solicitadoVia === "whatsapp" ? "WhatsApp" : "Dashboard"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-gray-500">{fmtDate(e.createdAt)}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex gap-1 justify-end">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => setSelectedId(e.id)}
                                    title="Ver detalhes"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                  {e.status === "rascunho" && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-blue-600"
                                      onClick={() => emitMut.mutate({ id: e.id })}
                                      title="Emitir"
                                    >
                                      <Send className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  {e.status === "erro" && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-amber-600"
                                      onClick={() => reprocessMut.mutate({ id: e.id })}
                                      title="Reprocessar"
                                    >
                                      <RefreshCw className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  {e.pdfUrl && (
                                    <a href={e.pdfUrl} target="_blank" rel="noopener noreferrer">
                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" title="Baixar PDF">
                                        <Download className="h-3.5 w-3.5" />
                                      </Button>
                                    </a>
                                  )}
                                  {(e.status === "rascunho" || e.status === "erro") && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-red-500"
                                      onClick={() => {
                                        if (confirm("Cancelar esta emissão?")) cancelMut.mutate({ id: e.id });
                                      }}
                                      title="Cancelar rascunho/erro"
                                    >
                                      <XCircle className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  {e.status === "emitida" && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-red-600"
                                      onClick={() => {
                                        setCancelJustificativa("");
                                        setCancelConfirm({
                                          id: e.id,
                                          numeroNf: e.numeroNf || String(e.id),
                                          tomadorNome: e.tomadorNome || "—",
                                        });
                                      }}
                                      title="Cancelar nota na prefeitura"
                                    >
                                      <XCircle className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>

                    {/* Pagination */}
                    {Math.ceil(list.total / 20) > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-3 border-t">
                        <p className="text-xs text-gray-500">
                          {list.total} emissões — Página {list.page} de {Math.ceil(list.total / 20)}
                        </p>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            disabled={page <= 1}
                            onClick={() => setPage(page - 1)}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            disabled={page >= Math.ceil(list.total / 20)}
                            onClick={() => setPage(page + 1)}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Aba Empresas & Usuários ── */}
          <TabsContent value="empresas">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Empresas & Usuários Autorizados
                </CardTitle>
                <p className="text-sm text-gray-500">
                  Gerencie as empresas emissoras e os telefones autorizados a emitir NFS-e via WhatsApp.
                </p>
              </CardHeader>
              <CardContent>
                <EmpresasTab />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialogs */}
      {showNovaEmissao && (
        <NovaEmissaoDialog open={showNovaEmissao} onClose={() => setShowNovaEmissao(false)} />
      )}
      {selectedId && (
        <DetalheDialog id={selectedId} onClose={() => setSelectedId(null)} />
      )}

      {/* Dialog — Confirmar cancelamento na prefeitura */}
      {cancelConfirm && (
        <Dialog open onOpenChange={() => setCancelConfirm(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-700">
                <XCircle className="h-5 w-5" />
                Cancelar NFS-e na Prefeitura
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="bg-red-50 border border-red-200 rounded-md p-3">
                <p className="font-medium text-red-800">Esta ação é irreversível.</p>
                <p className="text-red-700 mt-1">
                  A nota será cancelada tanto no painel quanto no portal da PMVV via automação Playwright.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-gray-700">
                <div>
                  <span className="text-gray-500 text-xs">Número NF:</span>
                  <p className="font-bold text-red-700">{cancelConfirm.numeroNf}</p>
                </div>
                <div>
                  <span className="text-gray-500 text-xs">Tomador:</span>
                  <p className="font-medium">{cancelConfirm.tomadorNome}</p>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">
                  Justificativa / Motivo do cancelamento <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  className="mt-1"
                  rows={3}
                  placeholder="Informe o motivo do cancelamento (mínimo 5 caracteres)..."
                  value={cancelJustificativa}
                  onChange={(e) => setCancelJustificativa(e.target.value)}
                  disabled={cancelarNaPrefeituraMut.isPending}
                />
                {cancelJustificativa.length > 0 && cancelJustificativa.length < 5 && (
                  <p className="text-xs text-red-500 mt-1">Mínimo 5 caracteres</p>
                )}
              </div>
              {cancelarNaPrefeituraMut.isPending && (
                <div className="flex items-center gap-2 text-blue-600 bg-blue-50 rounded-md p-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Executando cancelamento no portal da PMVV...</span>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2 mt-2">
              <Button
                variant="outline"
                onClick={() => setCancelConfirm(null)}
                disabled={cancelarNaPrefeituraMut.isPending}
              >
                Voltar
              </Button>
              <Button
                variant="destructive"
                disabled={cancelarNaPrefeituraMut.isPending || cancelJustificativa.trim().length < 5}
                onClick={() => {
                  cancelarNaPrefeituraMut.mutate(
                    { id: cancelConfirm.id, justificativa: cancelJustificativa.trim() },
                    { onSettled: () => { setCancelConfirm(null); setCancelJustificativa(""); } }
                  );
                }}
              >
                {cancelarNaPrefeituraMut.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Cancelando...</>
                ) : (
                  <><XCircle className="h-4 w-4 mr-1" /> Confirmar Cancelamento</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
