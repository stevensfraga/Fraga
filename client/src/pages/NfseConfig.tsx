import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  Building2,
  Plus,
  Pencil,
  Trash2,
  Users,
  Settings,
  Eye,
  EyeOff,
  Search,
  Globe,
  ShieldCheck,
  KeyRound,
  Info,
  CheckCircle2,
  AlertTriangle,
  Cookie,
  RefreshCw,
  Clock,
  Wifi,
  WifiOff,
  ExternalLink,
  FlaskConical,
  Play,
  CheckCircle,
  XCircle,
  Loader2,
  Terminal,
  Download,
  Zap,
} from "lucide-react";

// ─── SessionStatus ──────────────────────────────────────────────────
function SessionStatusBadge({ portalId }: { portalId: number }) {
  const statusQ = trpc.nfse.session.status.useQuery({ portalId }, { refetchInterval: 60000 });
  const testMut = trpc.nfse.session.test.useMutation({
    onSuccess: (r) => {
      statusQ.refetch();
      if (r.ok) toast.success("Sessão válida! Motor pronto para emitir.");
      else toast.error("Sessão expirada. Faça nova captura.");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const s = statusQ.data;
  if (statusQ.isLoading) return <Badge variant="outline" className="text-xs">...</Badge>;
  if (!s?.hasActiveSession) {
    return (
      <Badge className="bg-red-100 text-red-700 text-xs gap-1">
        <WifiOff className="h-3 w-3" /> Sem sessão
      </Badge>
    );
  }
  const days = s.daysUntilExpiry ?? 0;
  const color = days > 7 ? "green" : days > 2 ? "amber" : "red";
  return (
    <div className="flex items-center gap-1">
      <Badge className={`bg-${color}-100 text-${color}-700 text-xs gap-1`}>
        <Wifi className="h-3 w-3" />
        {days}d restantes
        {s.lastTestOk === true && <CheckCircle2 className="h-3 w-3" />}
      </Badge>
      <Button
        variant="ghost" size="icon" className="h-6 w-6"
        title="Testar sessão agora"
        disabled={testMut.isPending}
        onClick={() => testMut.mutate({ portalId })}
      >
        <RefreshCw className={`h-3 w-3 ${testMut.isPending ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}

// ─── CaptureSessionDialog ──────────────────────────────────────────────────
function CaptureSessionDialog({
  open, onClose, portal,
}: { open: boolean; onClose: () => void; portal: any }) {
  const utils = trpc.useUtils();
  const [cookiesJson, setCookiesJson] = useState("");
  const [step, setStep] = useState<"instructions" | "paste">("instructions");
  const captureMut = trpc.nfse.session.captureFromCookies.useMutation({
    onSuccess: (r) => {
      utils.nfse.session.status.invalidate({ portalId: portal.id });
      if (r.ok) {
        toast.success(`Sessão capturada com sucesso! ID: ${r.sessionId}`);
        onClose();
      } else {
        toast.error("Sessão salva, mas teste falhou. Verifique os cookies.");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleCapture = () => {
    if (!cookiesJson.trim()) { toast.error("Cole os cookies JSON"); return; }
    captureMut.mutate({ portalId: portal.id, cookiesJson: cookiesJson.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cookie className="h-5 w-5" />
            Capturar Sessão — {portal?.nome}
          </DialogTitle>
        </DialogHeader>

        {step === "instructions" ? (
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-semibold text-blue-800 mb-2">Como funciona a sessão persistente</p>
              <p className="text-xs text-blue-700">
                Você faz login <strong>uma vez</strong> no portal da prefeitura, exporta os cookies da sessão,
                e o sistema reutiliza esses cookies por até 30 dias sem precisar resolver CAPTCHA novamente.
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold">Passo a passo:</p>
              <div className="space-y-2 text-sm">
                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600 shrink-0">1.</span>
                  <div>
                    <p className="font-medium">Instale a extensão "EditThisCookie" ou "Cookie-Editor" no Chrome</p>
                    <p className="text-xs text-gray-500 mt-0.5">Pesquise na Chrome Web Store e instale gratuitamente</p>
                  </div>
                </div>
                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600 shrink-0">2.</span>
                  <div>
                    <p className="font-medium">Acesse o portal e faça login normalmente</p>
                    <a
                      href={portal?.url_portal || "https://tributacao.vilavelha.es.gov.br/tbw/loginCNPJContribuinte.jsp"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline flex items-center gap-1 mt-0.5"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Abrir portal da prefeitura
                    </a>
                    <p className="text-xs text-gray-500 mt-0.5">Resolva o CAPTCHA e entre com o usuário: <strong>{portal?.usuario_contador}</strong></p>
                  </div>
                </div>
                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600 shrink-0">3.</span>
                  <div>
                    <p className="font-medium">Após o login, clique na extensão e exporte os cookies</p>
                    <p className="text-xs text-gray-500 mt-0.5">No Cookie-Editor: clique em "Export" → "Export as JSON"</p>
                    <p className="text-xs text-gray-500">No EditThisCookie: clique no ícone de exportar (seta para baixo)</p>
                  </div>
                </div>
                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <span className="font-bold text-blue-600 shrink-0">4.</span>
                  <div>
                    <p className="font-medium">Cole o JSON dos cookies no próximo passo</p>
                    <p className="text-xs text-gray-500 mt-0.5">O sistema vai salvar e testar a sessão automaticamente</p>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => setStep("paste")}>
                Próximo: Colar Cookies
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-2 text-xs text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              Cole apenas cookies do domínio <strong>tributacao.vilavelha.es.gov.br</strong>. Não compartilhe esses cookies com ninguém.
            </div>
            <div>
              <Label>JSON dos Cookies *</Label>
              <Textarea
                value={cookiesJson}
                onChange={(e) => setCookiesJson(e.target.value)}
                placeholder='[{"name": "JSESSIONID", "value": "...", "domain": "tributacao.vilavelha.es.gov.br", ...}]'
                rows={8}
                className="font-mono text-xs"
              />
              <p className="text-xs text-gray-400 mt-1">Deve ser um array JSON de cookies exportados pelo Cookie-Editor ou EditThisCookie</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("instructions")}>Voltar</Button>
              <Button onClick={handleCapture} disabled={captureMut.isPending}>
                {captureMut.isPending ? "Salvando e testando..." : "Salvar Sessão"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── DiagnosticoPanel ──────────────────────────────────────────────
function DiagnosticoPanel({ portal, configs }: { portal: any; configs: any[] }) {
  const [result, setResult] = useState<any>(null);
  const [activeTest, setActiveTest] = useState<string | null>(null);
  const [showEmitirTeste, setShowEmitirTeste] = useState(false);

  const checkRuntime = trpc.nfse.diag.checkPlaywrightRuntime.useMutation({
    onMutate: () => setActiveTest("runtime"),
    onSuccess: (r: any) => {
      const ok = r.status === "PLAYWRIGHT_RUNTIME_OK";
      setResult({ type: "runtime", ok, ...r });
      setActiveTest(null);
    },
    onError: (e: any) => { setResult({ type: "runtime", ok: false, error: e.message }); setActiveTest(null); },
  });

  const testConn = trpc.nfse.diag.testConnection.useMutation({
    onMutate: () => setActiveTest("conn"),
    onSuccess: (r) => { setResult({ type: "conn", ok: r.success, ...r }); setActiveTest(null); },
    onError: (e: any) => { setResult({ type: "conn", ok: false, error: e.message, logs: [] }); setActiveTest(null); },
  });

  const testEmpresa = trpc.nfse.diag.testSelectEmpresa.useMutation({
    onMutate: () => setActiveTest("empresa"),
    onSuccess: (r) => { setResult({ type: "empresa", ok: r.success, ...r }); setActiveTest(null); },
    onError: (e: any) => { setResult({ type: "empresa", ok: false, error: e.message, logs: [] }); setActiveTest(null); },
  });

  const prestadorParaTeste = configs.find((c: any) => c.portalId === portal.id || c.portal_id === portal.id);

  return (
    <div className="mt-4 border border-dashed border-blue-200 rounded-lg p-4 bg-blue-50/40">
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical className="h-4 w-4 text-blue-600" />
        <span className="text-sm font-semibold text-blue-800">Painel de Diagnóstico — {portal.nome}</span>
        <Badge className="text-xs bg-blue-100 text-blue-700">E2E</Badge>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {/* Pré-check: Runtime Playwright */}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs text-orange-700 border-orange-300 hover:bg-orange-50"
          disabled={activeTest !== null}
          onClick={() => checkRuntime.mutate()}
          title="⚙️ Verificar se o Playwright/Chromium está disponível no servidor"
        >
          {activeTest === "runtime" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span>⚙️</span>}
          Runtime Check
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          disabled={activeTest !== null}
          onClick={() => testConn.mutate({ portalId: portal.id })}
        >
          {activeTest === "conn" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
          Testar Conexão
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          disabled={activeTest !== null || !prestadorParaTeste}
          title={!prestadorParaTeste ? "Nenhum prestador vinculado a este portal" : ""}
          onClick={() => prestadorParaTeste && testEmpresa.mutate({ portalId: portal.id, configId: prestadorParaTeste.id })}
        >
          {activeTest === "empresa" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
          Testar Seleção de Empresa
        </Button>

        <Button
          size="sm"
          className="gap-1.5 text-xs bg-green-600 hover:bg-green-700"
          disabled={activeTest !== null || !prestadorParaTeste}
          title={!prestadorParaTeste ? "Nenhum prestador vinculado a este portal" : ""}
          onClick={() => setShowEmitirTeste(true)}
        >
          <Zap className="h-3.5 w-3.5" />
          Emitir Teste
        </Button>
      </div>

      {/* Resultado do teste */}
      {result && (
        <div className={`rounded-lg border p-3 ${
          result.ok ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
        }`}>
          <div className="flex items-center gap-2 mb-2">
            {result.ok
              ? <CheckCircle className="h-4 w-4 text-green-600" />
              : <XCircle className="h-4 w-4 text-red-600" />
            }
            <span className={`text-sm font-semibold ${
              result.ok ? "text-green-800" : "text-red-800"
            }`}>
              {result.type === "runtime" && (result.ok ? `PLAYWRIGHT_RUNTIME_OK — Chromium ${result.chromiumVersion} (${result.durationMs}ms)` : `PLAYWRIGHT_RUNTIME_FAIL — ${result.error || "Runtime indisponível"}`)}
              {result.type === "conn" && (result.ok ? "Conexão OK — sessão válida" : "Falha na conexão")}
              {result.type === "empresa" && (result.ok ? "Empresa selecionada com sucesso" : "Falha ao selecionar empresa")}
              {result.type === "emitir" && (result.ok ? `NFS-e emitida! Nº ${result.numeroNfse}` : "Falha na emissão de teste")}
            </span>
          </div>

          {/* Logs estruturados */}
          {result.logs && result.logs.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-1 mb-1">
                <Terminal className="h-3 w-3 text-gray-500" />
                <span className="text-xs text-gray-500 font-medium">Log de execução</span>
              </div>
              <div className="bg-gray-900 rounded p-2 font-mono text-xs space-y-0.5 max-h-40 overflow-y-auto">
                {result.logs.map((log: any, i: number) => (
                  <div key={i} className={`flex gap-2 ${
                    log.status === "OK" ? "text-green-400" :
                    log.status === "FAIL" ? "text-red-400" :
                    log.status === "WARN" ? "text-yellow-400" : "text-gray-300"
                  }`}>
                    <span className="shrink-0 text-gray-500">{log.ts ? new Date(log.ts).toLocaleTimeString() : ""}</span>
                    <span className="shrink-0 font-bold">[{log.step}]</span>
                    <span>{log.msg || log.message || ""}</span>
                    {log.status && <span className="ml-auto shrink-0">{log.status}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Screenshot em caso de erro */}
          {!result.ok && result.screenshotUrl && (
            <div className="mt-2">
              <a
                href={result.screenshotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
              >
                <Download className="h-3 w-3" /> Ver screenshot do erro
              </a>
            </div>
          )}

          {/* PDF da emissão de teste */}
          {result.ok && result.pdfUrl && (
            <div className="mt-2">
              <a
                href={result.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-600 hover:underline flex items-center gap-1"
              >
                <Download className="h-3 w-3" /> Baixar PDF da NFS-e Nº {result.numeroNfse}
              </a>
            </div>
          )}

          {/* Erro */}
          {result.error && (
            <p className="text-xs text-red-700 mt-1 font-mono">{result.error}</p>
          )}
        </div>
      )}

      {/* Dialog de Emitir Teste */}
      {showEmitirTeste && prestadorParaTeste && (
        <EmitirTesteDialog
          open={showEmitirTeste}
          onClose={() => setShowEmitirTeste(false)}
          configId={prestadorParaTeste.id}
          prestadorNome={prestadorParaTeste.razaoSocial}
          onResult={(r: any) => { setResult({ type: "emitir", ...r }); setShowEmitirTeste(false); }}
        />
      )}
    </div>
  );
}

// ─── EmitirTesteDialog ──────────────────────────────────────────────
function EmitirTesteDialog({
  open, onClose, configId, prestadorNome, onResult,
}: {
  open: boolean;
  onClose: () => void;
  configId: number;
  prestadorNome: string;
  onResult: (r: any) => void;
}) {
  const now = new Date();
  const mesAtual = `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  const [form, setForm] = useState({
    tomadorNome: "",
    tomadorCpfCnpj: "",
    valor: "10.00",
    competencia: mesAtual,
    descricao: `[TESTE] Serviços de contabilidade - ${mesAtual}`,
  });

  const emitirMut = trpc.nfse.diag.emitirTeste.useMutation({
    onSuccess: (r) => onResult(r),
    onError: (e: any) => onResult({ ok: false, error: e.message, logs: [] }),
  });

  const handleEmitir = () => {
    if (!form.tomadorNome || !form.tomadorCpfCnpj) {
      toast.error("Nome e CPF/CNPJ do tomador são obrigatórios");
      return;
    }
    const valor = parseFloat(form.valor);
    if (isNaN(valor) || valor <= 0) {
      toast.error("Valor inválido");
      return;
    }
    emitirMut.mutate({
      configId,
      tomadorNome: form.tomadorNome,
      tomadorCpfCnpj: form.tomadorCpfCnpj.replace(/\D/g, ""),
      valor,
      competencia: form.competencia,
      descricao: form.descricao,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-green-600" />
            Emitir NFS-e de Teste
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-2 text-xs text-amber-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <strong>Atenção:</strong> Esta emissão é <strong>REAL</strong> no portal da prefeitura.
              Use dados reais do tomador e um valor pequeno (ex: R$ 10,00) para teste.
              Prestador: <strong>{prestadorNome}</strong>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nome do Tomador *</Label>
              <Input
                value={form.tomadorNome}
                onChange={(e) => setForm(f => ({ ...f, tomadorNome: e.target.value }))}
                placeholder="Razão Social ou Nome Completo"
              />
            </div>
            <div className="col-span-2">
              <Label>CPF/CNPJ do Tomador *</Label>
              <Input
                value={form.tomadorCpfCnpj}
                onChange={(e) => setForm(f => ({ ...f, tomadorCpfCnpj: e.target.value }))}
                placeholder="00.000.000/0000-00"
              />
            </div>
            <div>
              <Label>Valor (R$) *</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={form.valor}
                onChange={(e) => setForm(f => ({ ...f, valor: e.target.value }))}
              />
            </div>
            <div>
              <Label>Competência</Label>
              <Input
                value={form.competencia}
                onChange={(e) => setForm(f => ({ ...f, competencia: e.target.value }))}
                placeholder="MM/AAAA"
              />
            </div>
            <div className="col-span-2">
              <Label>Descrição do Serviço</Label>
              <Textarea
                value={form.descricao}
                onChange={(e) => setForm(f => ({ ...f, descricao: e.target.value }))}
                rows={2}
                className="text-sm"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={emitirMut.isPending}>Cancelar</Button>
          <Button
            className="bg-green-600 hover:bg-green-700 gap-1.5"
            onClick={handleEmitir}
            disabled={emitirMut.isPending}
          >
            {emitirMut.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Emitindo...(pode levar 30-60s)</>
              : <><Play className="h-4 w-4" /> Emitir NFS-e de Teste</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Formatadores ──────────────────────────────────────────────────
function fmtCnpj(v: string): string {
  const d = (v || "").replace(/\D/g, "");
  if (d.length <= 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

// ─── Portal Form (Credencial Master do Contador) ───────────────────
function PortalForm({
  open,
  onClose,
  editData,
}: {
  open: boolean;
  onClose: () => void;
  editData?: any;
}) {
  const utils = trpc.useUtils();
  const createMut = trpc.nfse.portais.create.useMutation({
    onSuccess: () => { utils.nfse.portais.list.invalidate(); onClose(); toast.success("Portal cadastrado com sucesso!"); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMut = trpc.nfse.portais.update.useMutation({
    onSuccess: () => { utils.nfse.portais.list.invalidate(); onClose(); toast.success("Portal atualizado!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const [form, setForm] = useState({
    nome: editData?.nome || "Prefeitura de Vila Velha",
    municipio: editData?.municipio || "Vila Velha",
    uf: editData?.uf || "ES",
    urlPortal: editData?.url_portal || "https://nfsevv.vilavelha.es.gov.br",
    usuarioContador: editData?.usuario_contador || "",
    senhaContador: "",
    observacoes: editData?.observacoes || "",
  });
  const [showSenha, setShowSenha] = useState(false);

  const handleSave = () => {
    if (!form.nome || !form.usuarioContador) {
      toast.error("Nome do portal e usuário do contador são obrigatórios");
      return;
    }
    if (!editData?.id && !form.senhaContador) {
      toast.error("Senha do contador é obrigatória no cadastro inicial");
      return;
    }
    if (editData?.id) {
      updateMut.mutate({
        id: editData.id,
        nome: form.nome,
        municipio: form.municipio,
        uf: form.uf,
        urlPortal: form.urlPortal || undefined,
        usuarioContador: form.usuarioContador,
        senhaContador: form.senhaContador || undefined,
        observacoes: form.observacoes || undefined,
      });
    } else {
      createMut.mutate({
        nome: form.nome,
        municipio: form.municipio,
        uf: form.uf,
        urlPortal: form.urlPortal || undefined,
        usuarioContador: form.usuarioContador,
        senhaContador: form.senhaContador,
        observacoes: form.observacoes || undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-blue-600" />
            {editData?.id ? "Editar Portal NFS-e" : "Novo Portal NFS-e"}
          </DialogTitle>
        </DialogHeader>

        {/* Aviso de segurança */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2">
          <ShieldCheck className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
          <div className="text-xs text-blue-700">
            <p className="font-semibold">Credencial Master do Contador</p>
            <p className="mt-0.5">
              Esta credencial pertence ao escritório contábil e permite emitir NFS-e
              para todas as empresas vinculadas ao contador no portal da prefeitura.
              A senha é armazenada criptografada e nunca exposta.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Nome do Portal *</Label>
            <Input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Ex: Prefeitura de Vila Velha"
            />
          </div>
          <div>
            <Label>Município</Label>
            <Input
              value={form.municipio}
              onChange={(e) => setForm({ ...form, municipio: e.target.value })}
            />
          </div>
          <div>
            <Label>UF</Label>
            <Select value={form.uf} onValueChange={(v) => setForm({ ...form, uf: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf => (
                  <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>URL do Portal</Label>
            <Input
              value={form.urlPortal}
              onChange={(e) => setForm({ ...form, urlPortal: e.target.value })}
              placeholder="https://nfsevv.vilavelha.es.gov.br"
            />
          </div>
          <div className="col-span-2">
            <Label>Usuário do Contador (CPF ou login) *</Label>
            <Input
              value={form.usuarioContador}
              onChange={(e) => setForm({ ...form, usuarioContador: e.target.value })}
              placeholder="CPF ou usuário de acesso ao portal"
            />
          </div>
          <div className="col-span-2">
            <Label>
              Senha do Contador {editData?.id && <span className="text-gray-400 text-xs">(deixe em branco para manter a atual)</span>}
            </Label>
            <div className="flex gap-1">
              <Input
                type={showSenha ? "text" : "password"}
                value={form.senhaContador}
                onChange={(e) => setForm({ ...form, senhaContador: e.target.value })}
                placeholder={editData?.id ? "••••••••" : "Senha de acesso ao portal"}
              />
              <Button variant="ghost" size="icon" onClick={() => setShowSenha(!showSenha)}>
                {showSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              rows={2}
              placeholder="Informações adicionais sobre este portal"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
            {(createMut.isPending || updateMut.isPending) ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Prestador Form ────────────────────────────────────────────────
function PrestadorForm({
  open,
  onClose,
  editData,
  portais,
}: {
  open: boolean;
  onClose: () => void;
  editData?: any;
  portais: any[];
}) {
  const utils = trpc.useUtils();
  const createMut = trpc.nfse.config.create.useMutation({
    onSuccess: () => { utils.nfse.config.list.invalidate(); onClose(); toast.success("Prestador cadastrado!"); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMut = trpc.nfse.config.update.useMutation({
    onSuccess: () => { utils.nfse.config.list.invalidate(); onClose(); toast.success("Prestador atualizado!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const [form, setForm] = useState({
    cnpj: editData?.cnpj || "",
    inscricaoMunicipal: editData?.inscricaoMunicipal || "",
    razaoSocial: editData?.razaoSocial || "",
    portalId: editData?.portal_id ? String(editData.portal_id) : (portais[0]?.id ? String(portais[0].id) : ""),
    modoAuth: editData?.modo_auth || "login_contador",
    certTipo: editData?.cert_tipo || "",
    municipio: editData?.municipio || "Vila Velha",
    uf: editData?.uf || "ES",
    regime: editData?.regime || "Simples Nacional",
    issRetido: editData?.issRetido ? true : false,
    listaServico: editData?.listaServico || "",
    cnaePrincipal: editData?.cnaePrincipal || "",
    descricaoPadrao: editData?.descricaoPadrao || "Prestação de serviços contábeis referente à competência {mes}/{ano}",
    emailPadrao: editData?.emailPadrao || "",
  });

  const handleSave = () => {
    if (!form.cnpj || !form.razaoSocial) {
      toast.error("CNPJ e Razão Social são obrigatórios");
      return;
    }
    const payload = {
      cnpj: form.cnpj,
      inscricaoMunicipal: form.inscricaoMunicipal || undefined,
      razaoSocial: form.razaoSocial,
      portalId: form.portalId ? Number(form.portalId) : undefined,
      modoAuth: form.modoAuth as "login_contador" | "certificado_digital",
      certTipo: form.certTipo as "A1" | "A3" | undefined || undefined,
      municipio: form.municipio,
      uf: form.uf,
      regime: form.regime,
      issRetido: form.issRetido,
      listaServico: form.listaServico || undefined,
      cnaePrincipal: form.cnaePrincipal || undefined,
      descricaoPadrao: form.descricaoPadrao || undefined,
      emailPadrao: form.emailPadrao || undefined,
    };
    if (editData?.id) {
      updateMut.mutate({ id: editData.id, ...payload });
    } else {
      createMut.mutate(payload);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {editData?.id ? "Editar Prestador" : "Novo Prestador"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          {/* Dados básicos */}
          <div>
            <Label>CNPJ *</Label>
            <Input
              value={form.cnpj}
              onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
              placeholder="00.000.000/0000-00"
            />
          </div>
          <div>
            <Label>Inscrição Municipal</Label>
            <Input
              value={form.inscricaoMunicipal}
              onChange={(e) => setForm({ ...form, inscricaoMunicipal: e.target.value })}
              placeholder="Código no portal da prefeitura"
            />
          </div>
          <div className="col-span-2">
            <Label>Razão Social *</Label>
            <Input
              value={form.razaoSocial}
              onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })}
            />
          </div>

          {/* Modo de autenticação NFS-e */}
          <div className="col-span-2 border rounded-lg p-4 bg-gray-50">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound className="h-4 w-4 text-gray-600" />
              <Label className="text-sm font-semibold">Modo de Autenticação NFS-e</Label>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, modoAuth: "login_contador" })}
                className={`border-2 rounded-lg p-3 text-left transition-colors ${
                  form.modoAuth === "login_contador"
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className={`h-4 w-4 ${form.modoAuth === "login_contador" ? "text-blue-600" : "text-gray-400"}`} />
                  <span className="text-sm font-medium">Login Contador</span>
                  <Badge className="text-xs bg-green-100 text-green-700">Padrão</Badge>
                </div>
                <p className="text-xs text-gray-500">
                  Usa a credencial master do escritório para acessar o portal e selecionar esta empresa
                </p>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, modoAuth: "certificado_digital" })}
                className={`border-2 rounded-lg p-3 text-left transition-colors ${
                  form.modoAuth === "certificado_digital"
                    ? "border-purple-500 bg-purple-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <KeyRound className={`h-4 w-4 ${form.modoAuth === "certificado_digital" ? "text-purple-600" : "text-gray-400"}`} />
                  <span className="text-sm font-medium">Certificado Digital</span>
                  <Badge className="text-xs bg-amber-100 text-amber-700">Fallback</Badge>
                </div>
                <p className="text-xs text-gray-500">
                  Usa certificado A1/A3 da empresa. A1 via upload .pfx; A3 requer ambiente físico
                </p>
              </button>
            </div>

            {/* Portal (só para login_contador) */}
            {form.modoAuth === "login_contador" && (
              <div>
                <Label className="text-xs">Portal do Contador</Label>
                {portais.length === 0 ? (
                  <div className="flex items-center gap-2 mt-1 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Nenhum portal cadastrado. Cadastre um portal na aba "Portais" primeiro.
                  </div>
                ) : (
                  <Select
                    value={form.portalId}
                    onValueChange={(v) => setForm({ ...form, portalId: v })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Selecione o portal" />
                    </SelectTrigger>
                    <SelectContent>
                      {portais.map((p: any) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.nome} — {p.municipio}/{p.uf}
                          {p.senhaConfigurada && (
                            <span className="ml-2 text-green-600">✓</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Tipo de certificado (só para certificado_digital) */}
            {form.modoAuth === "certificado_digital" && (
              <div>
                <Label className="text-xs">Tipo de Certificado</Label>
                <Select
                  value={form.certTipo}
                  onValueChange={(v) => setForm({ ...form, certTipo: v })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A1">A1 — Arquivo .pfx/.p12 (upload)</SelectItem>
                    <SelectItem value="A3">A3 — Token/Smartcard (ambiente físico)</SelectItem>
                  </SelectContent>
                </Select>
                {form.certTipo === "A3" && (
                  <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700 flex gap-1.5">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Certificado A3 requer ambiente físico com token/smartcard conectado. Recomendamos usar Login Contador para automação.
                  </div>
                )}
                {form.certTipo === "A1" && (
                  <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700 flex gap-1.5">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Após salvar, use o botão "Upload Certificado" na lista de prestadores para enviar o arquivo .pfx/.p12 e configurar a senha.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Localização */}
          <div>
            <Label>Município</Label>
            <Input
              value={form.municipio}
              onChange={(e) => setForm({ ...form, municipio: e.target.value })}
            />
          </div>
          <div>
            <Label>UF</Label>
            <Select value={form.uf} onValueChange={(v) => setForm({ ...form, uf: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf => (
                  <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Fiscal */}
          <div>
            <Label>Regime Tributário</Label>
            <Select value={form.regime} onValueChange={(v) => setForm({ ...form, regime: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Simples Nacional">Simples Nacional</SelectItem>
                <SelectItem value="Lucro Presumido">Lucro Presumido</SelectItem>
                <SelectItem value="Lucro Real">Lucro Real</SelectItem>
                <SelectItem value="MEI">MEI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Switch
              checked={form.issRetido}
              onCheckedChange={(v) => setForm({ ...form, issRetido: v })}
            />
            <Label>ISS Retido na Fonte</Label>
          </div>
          <div>
            <Label>Lista de Serviço (LC116)</Label>
            <Input
              value={form.listaServico}
              onChange={(e) => setForm({ ...form, listaServico: e.target.value })}
              placeholder="Ex: 17.01"
            />
          </div>
          <div>
            <Label>CNAE Principal</Label>
            <Input
              value={form.cnaePrincipal}
              onChange={(e) => setForm({ ...form, cnaePrincipal: e.target.value })}
              placeholder="Ex: 6920-6/01"
            />
          </div>
          <div className="col-span-2">
            <Label>Descrição Padrão do Serviço</Label>
            <Textarea
              value={form.descricaoPadrao}
              onChange={(e) => setForm({ ...form, descricaoPadrao: e.target.value })}
              placeholder="Use {mes}, {ano}, {competencia} para substituição automática"
              rows={3}
            />
            <p className="text-xs text-gray-400 mt-1">
              Variáveis: <code className="bg-gray-100 px-1 rounded">{"{mes}"}</code> (Janeiro), <code className="bg-gray-100 px-1 rounded">{"{ano}"}</code> (2025), <code className="bg-gray-100 px-1 rounded">{"{competencia}"}</code> (Janeiro/2025)
            </p>
          </div>
          <div className="col-span-2">
            <Label>E-mail Padrão</Label>
            <Input
              type="email"
              value={form.emailPadrao}
              onChange={(e) => setForm({ ...form, emailPadrao: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
            {(createMut.isPending || updateMut.isPending) ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tomador Form ──────────────────────────────────────────────────
function TomadorForm({
  open,
  onClose,
  configId,
  editData,
}: {
  open: boolean;
  onClose: () => void;
  configId: number;
  editData?: any;
}) {
  const utils = trpc.useUtils();
  const createMut = trpc.nfse.tomadores.create.useMutation({
    onSuccess: () => { utils.nfse.tomadores.list.invalidate(); onClose(); toast.success("Tomador cadastrado!"); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMut = trpc.nfse.tomadores.update.useMutation({
    onSuccess: () => { utils.nfse.tomadores.list.invalidate(); onClose(); toast.success("Tomador atualizado!"); },
    onError: (e: any) => toast.error(e.message),
  });

  const [form, setForm] = useState({
    nome: editData?.nome || "",
    cpfCnpj: editData?.cpfCnpj || "",
    endereco: editData?.endereco || "",
    cidade: editData?.cidade || "",
    estado: editData?.estado || "ES",
    cep: editData?.cep || "",
    email: editData?.email || "",
    telefone: editData?.telefone || "",
    observacao: editData?.observacao || "",
  });

  const handleSave = () => {
    if (!form.nome || !form.cpfCnpj) {
      toast.error("Nome e CPF/CNPJ são obrigatórios");
      return;
    }
    if (editData?.id) {
      updateMut.mutate({ id: editData.id, ...form });
    } else {
      createMut.mutate({ configId, ...form });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {editData?.id ? "Editar Tomador" : "Novo Tomador"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Nome / Razão Social *</Label>
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div>
            <Label>CPF / CNPJ *</Label>
            <Input value={form.cpfCnpj} onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value })} placeholder="000.000.000-00" />
          </div>
          <div>
            <Label>E-mail</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label>Endereço</Label>
            <Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} />
          </div>
          <div>
            <Label>Cidade</Label>
            <Input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
          </div>
          <div>
            <Label>Estado</Label>
            <Select value={form.estado} onValueChange={(v) => setForm({ ...form, estado: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf => (
                  <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>CEP</Label>
            <Input value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} placeholder="00000-000" />
          </div>
          <div>
            <Label>Telefone</Label>
            <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label>Observação</Label>
            <Textarea value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
            {(createMut.isPending || updateMut.isPending) ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── PortalActionsCell ─────────────────────────────────────────────
function PortalActionsCell({
  portal, configs, onEdit, onDelete, onCapture,
}: {
  portal: any;
  configs: any[];
  onEdit: () => void;
  onDelete: () => void;
  onCapture: () => void;
}) {
  const [diagResult, setDiagResult] = useState<any>(null);
  const [activeTest, setActiveTest] = useState<string | null>(null);

  const prestadorParaTeste = configs.find(
    (c: any) => c.portalId === portal.id || c.portal_id === portal.id
  );

  const checkRuntime = trpc.nfse.diag.checkPlaywrightRuntime.useMutation({
    onMutate: () => setActiveTest("runtime"),
    onSuccess: (r: any) => {
      const ok = r.status === "PLAYWRIGHT_RUNTIME_OK";
      setDiagResult({ type: "runtime", ok, ...r });
      setActiveTest(null);
      if (ok) toast.success(`PLAYWRIGHT_RUNTIME_OK — Chromium ${r.chromiumVersion} (${r.durationMs}ms)`);
      else toast.error(`PLAYWRIGHT_RUNTIME_FAIL — ${r.error || "Runtime indisponível"}`);
    },
    onError: (e: any) => {
      setDiagResult({ type: "runtime", ok: false, error: e.message });
      setActiveTest(null);
      toast.error(`Erro: ${e.message}`);
    },
  });

  const testConn = trpc.nfse.diag.testConnection.useMutation({
    onMutate: () => setActiveTest("conn"),
    onSuccess: (r: any) => {
      setDiagResult({ type: "conn", ok: r.success, ...r });
      setActiveTest(null);
      if (r.success) toast.success(`LOGIN_OK — Sessão válida! Portal: ${portal.nome}`);
      else toast.error(`LOGIN_FAIL — ${r.error || "Sessão expirada"}`);
    },
    onError: (e: any) => {
      setDiagResult({ type: "conn", ok: false, error: e.message, logs: [] });
      setActiveTest(null);
      toast.error(`Erro: ${e.message}`);
    },
  });

  const testEmpresa = trpc.nfse.diag.testSelectEmpresa.useMutation({
    onMutate: () => setActiveTest("empresa"),
    onSuccess: (r: any) => {
      setDiagResult({ type: "empresa", ok: r.success, ...r });
      setActiveTest(null);
      if (r.success) toast.success(`EMPRESA_OK — Empresa selecionada com sucesso!`);
      else toast.error(`EMPRESA_FAIL — ${r.error || "Não foi possível selecionar a empresa"}`);
    },
    onError: (e: any) => {
      setDiagResult({ type: "empresa", ok: false, error: e.message, logs: [] });
      setActiveTest(null);
      toast.error(`Erro: ${e.message}`);
    },
  });

  return (
    <div className="flex flex-col gap-1 items-end">
      {/* Linha 1: Botões de ação principal */}
      <div className="flex gap-1 justify-end">
        {/* Editar */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onEdit}
          title="✏️ Editar portal / atualizar senha"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {/* Excluir */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-red-500 hover:text-red-700"
          onClick={onDelete}
          title="🗑️ Desativar portal"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {/* Linha 2: Botões de sessão e diagnóstico */}
      <div className="flex gap-1 justify-end flex-wrap">
        {/* Runtime Check */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 text-orange-600 border-orange-200 hover:bg-orange-50"
          disabled={activeTest !== null}
          onClick={() => checkRuntime.mutate()}
          title="⚙️ Verificar runtime do Playwright (PLAYWRIGHT_RUNTIME_OK / FAIL)"
        >
          {activeTest === "runtime"
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <span className="text-xs">⚙️</span>
          }
          Runtime
        </Button>
        {/* Capturar Sessão */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
          onClick={onCapture}
          title="🔑 Capturar sessão via cookies (login manual)"
        >
          <Cookie className="h-3.5 w-3.5" /> Sessão
        </Button>
        {/* Testar Conexão */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 text-green-600 border-green-200 hover:bg-green-50"
          disabled={activeTest !== null}
          onClick={() => testConn.mutate({ portalId: portal.id })}
          title="🧪 Testar conexão com o portal (LOGIN_OK / LOGIN_FAIL)"
        >
          {activeTest === "conn"
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Wifi className="h-3.5 w-3.5" />
          }
          Testar
        </Button>
        {/* Testar Seleção de Empresa */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 text-purple-600 border-purple-200 hover:bg-purple-50"
          disabled={activeTest !== null || !prestadorParaTeste}
          onClick={() => prestadorParaTeste && testEmpresa.mutate({ portalId: portal.id, configId: prestadorParaTeste.id })}
          title={!prestadorParaTeste ? "Nenhum prestador vinculado a este portal" : "🏢 Testar seleção de empresa (EMPRESA_OK / EMPRESA_FAIL)"}
        >
          {activeTest === "empresa"
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Building2 className="h-3.5 w-3.5" />
          }
          Empresa
        </Button>
      </div>
      {/* Resultado inline do diagnóstico */}
      {diagResult && (
        <div className={`text-xs rounded px-2 py-1 mt-1 flex items-center gap-1 ${
          diagResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
        }`}>
          {diagResult.ok
            ? <CheckCircle className="h-3 w-3" />
            : <XCircle className="h-3 w-3" />
          }
          {diagResult.type === "runtime" && (diagResult.ok ? `PLAYWRIGHT_RUNTIME_OK — Chromium ${diagResult.chromiumVersion}` : "PLAYWRIGHT_RUNTIME_FAIL")}
          {diagResult.type === "conn" && (diagResult.ok ? "LOGIN_OK" : "LOGIN_FAIL")}
          {diagResult.type === "empresa" && (diagResult.ok ? "EMPRESA_OK" : "EMPRESA_FAIL")}
          {diagResult.error && (
            <span className="text-xs opacity-75 ml-1 truncate max-w-32" title={diagResult.error}>
              {diagResult.error.substring(0, 30)}{diagResult.error.length > 30 ? "..." : ""}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 ml-1"
            onClick={() => setDiagResult(null)}
          >
            <XCircle className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────
export default function NfseConfig() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("portais");
  const [showPortalForm, setShowPortalForm] = useState(false);
  const [editPortal, setEditPortal] = useState<any>(null);
  const [showPrestadorForm, setShowPrestadorForm] = useState(false);
  const [editPrestador, setEditPrestador] = useState<any>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);
  const [showTomadorForm, setShowTomadorForm] = useState(false);
  const [editTomador, setEditTomador] = useState<any>(null);
  const [tomadorSearch, setTomadorSearch] = useState("");

  const [captureSessionPortal, setCaptureSessionPortal] = useState<any>(null);

  const portaisQuery = trpc.nfse.portais.list.useQuery();
  const configQuery = trpc.nfse.config.list.useQuery();
  const tomadoresQuery = trpc.nfse.tomadores.list.useQuery({
    configId: selectedConfigId || undefined,
    search: tomadorSearch || undefined,
  });

  const deletePortal = trpc.nfse.portais.delete.useMutation({
    onSuccess: () => { portaisQuery.refetch(); toast.success("Portal desativado"); },
  });
  const deletePrestador = trpc.nfse.config.delete.useMutation({
    onSuccess: () => { configQuery.refetch(); toast.success("Prestador removido"); },
  });
  const deleteTomador = trpc.nfse.tomadores.update.useMutation({
    onSuccess: () => { tomadoresQuery.refetch(); toast.success("Tomador desativado"); },
  });

  const portais = portaisQuery.data || [];
  const configs = configQuery.data || [];
  const tomadores = tomadoresQuery.data || [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/nfse")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Configuração NFS-e
              </h1>
              <p className="text-sm text-gray-500">Portais, prestadores e tomadores de serviço</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="portais" className="gap-1">
              <Globe className="h-4 w-4" /> Portais
              {portais.length > 0 && (
                <Badge className="ml-1 text-xs bg-blue-100 text-blue-700">{portais.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="prestadores" className="gap-1">
              <Building2 className="h-4 w-4" /> Prestadores
              {configs.length > 0 && (
                <Badge className="ml-1 text-xs bg-gray-100 text-gray-700">{configs.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="tomadores" className="gap-1">
              <Users className="h-4 w-4" /> Tomadores
            </TabsTrigger>
          </TabsList>

          {/* ─── Portais Tab ─────────────────────────────────────── */}
          <TabsContent value="portais" className="mt-4">
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg flex gap-3">
              <ShieldCheck className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-800">Credencial Master do Contador</p>
                <p className="text-xs text-blue-700 mt-0.5">
                  Configure aqui o login do escritório contábil nos portais de NFS-e das prefeituras.
                  Uma única credencial dá acesso a todas as empresas vinculadas ao contador.
                  A senha é armazenada criptografada e nunca exposta no frontend.
                </p>
              </div>
            </div>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Portais de NFS-e</CardTitle>
                <Button size="sm" onClick={() => { setEditPortal(null); setShowPortalForm(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Novo Portal
                </Button>
              </CardHeader>
              <CardContent>
                {portais.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Globe className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">Nenhum portal cadastrado</p>
                    <p className="text-sm mt-1">Cadastre o portal da Prefeitura de Vila Velha para começar</p>
                    <Button
                      className="mt-4"
                      size="sm"
                      onClick={() => { setEditPortal(null); setShowPortalForm(true); }}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Cadastrar Portal Vila Velha
                    </Button>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Portal</TableHead>
                        <TableHead>Município/UF</TableHead>
                        <TableHead>Usuário Contador</TableHead>
                          <TableHead>Senha</TableHead>
                          <TableHead>Sessão</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {portais.map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{p.nome}</p>
                              {p.url_portal && (
                                <a
                                  href={p.url_portal}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-500 hover:underline"
                                >
                                  {p.url_portal}
                                </a>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{p.municipio}/{p.uf}</TableCell>
                          <TableCell className="font-mono text-sm">{p.usuario_contador}</TableCell>
                          <TableCell>
                            {p.senhaConfigurada ? (
                              <Badge className="bg-green-100 text-green-700 text-xs gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Configurada
                              </Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-700 text-xs gap-1">
                                <AlertTriangle className="h-3 w-3" /> Pendente
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <SessionStatusBadge portalId={p.id} />
                          </TableCell>
                          <TableCell>
                            {p.ativo ? (
                              <Badge className="bg-green-100 text-green-700 text-xs">Ativo</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-gray-400">Inativo</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <PortalActionsCell
                              portal={p}
                              configs={configs}
                              onEdit={() => { setEditPortal(p); setShowPortalForm(true); }}
                              onDelete={() => { if (confirm("Desativar este portal?")) deletePortal.mutate({ id: p.id }); }}
                              onCapture={() => setCaptureSessionPortal(p)}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Painel de Diagnóstico por portal */}
            {portais.map((p: any) => (
              <DiagnosticoPanel key={p.id} portal={p} configs={configs} />
            ))}
          </TabsContent>

          {/* ─── Prestadores Tab ─────────────────────────────────── */}
          <TabsContent value="prestadores" className="mt-4">
            {portais.length === 0 && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-2 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                Cadastre um portal na aba "Portais" antes de cadastrar prestadores para poder vincular a credencial do contador.
              </div>
            )}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Empresas Prestadoras</CardTitle>
                <Button size="sm" onClick={() => { setEditPrestador(null); setShowPrestadorForm(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Novo Prestador
                </Button>
              </CardHeader>
              <CardContent>
                {configs.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Building2 className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">Nenhum prestador cadastrado</p>
                    <p className="text-sm">Cadastre a primeira empresa prestadora para começar a emitir NFS-e</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Razão Social</TableHead>
                        <TableHead>CNPJ</TableHead>
                        <TableHead>IM</TableHead>
                        <TableHead>Município</TableHead>
                        <TableHead>Regime</TableHead>
                        <TableHead>Auth</TableHead>
                        <TableHead>Portal</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {configs.map((c: any) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.razaoSocial}</TableCell>
                          <TableCell className="font-mono text-xs">{fmtCnpj(c.cnpj)}</TableCell>
                          <TableCell className="text-xs text-gray-500">{c.inscricaoMunicipal || "—"}</TableCell>
                          <TableCell>{c.municipio}/{c.uf}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{c.regime}</Badge>
                          </TableCell>
                          <TableCell>
                            {c.modo_auth === "certificado_digital" ? (
                              <Badge className="bg-purple-100 text-purple-700 text-xs gap-1">
                                <KeyRound className="h-3 w-3" /> Cert. {c.cert_tipo || "Digital"}
                              </Badge>
                            ) : (
                              <Badge className="bg-blue-100 text-blue-700 text-xs gap-1">
                                <ShieldCheck className="h-3 w-3" /> Contador
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {c.portalNome ? (
                              <span className="text-xs text-gray-600">{c.portalNome}</span>
                            ) : (
                              <span className="text-xs text-amber-500">Não vinculado</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {c.ativo ? (
                              <Badge className="bg-green-100 text-green-700 text-xs">Ativo</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-gray-400">Inativo</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => { setEditPrestador(c); setShowPrestadorForm(true); }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-500 hover:text-red-700"
                                onClick={() => {
                                  if (confirm("Remover este prestador?")) deletePrestador.mutate({ id: c.id });
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Tomadores Tab ───────────────────────────────────── */}
          <TabsContent value="tomadores" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Tomadores de Serviço</CardTitle>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Buscar tomador..."
                      className="pl-9 w-56"
                      value={tomadorSearch}
                      onChange={(e) => setTomadorSearch(e.target.value)}
                    />
                  </div>
                  <Select
                    value={selectedConfigId?.toString() || "all"}
                    onValueChange={(v) => setSelectedConfigId(v === "all" ? null : Number(v))}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Todos os prestadores" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os prestadores</SelectItem>
                      {configs.map((c: any) => (
                        <SelectItem key={c.id} value={c.id.toString()}>{c.razaoSocial}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={() => { setEditTomador(null); setShowTomadorForm(true); }}
                    disabled={configs.length === 0}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Novo Tomador
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {tomadores.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">Nenhum tomador cadastrado</p>
                    <p className="text-sm">Cadastre tomadores para facilitar a emissão de NFS-e via WhatsApp</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>CPF/CNPJ</TableHead>
                        <TableHead>Cidade/UF</TableHead>
                        <TableHead>E-mail</TableHead>
                        <TableHead>Prestador</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tomadores.map((t: any) => (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium">{t.nome}</TableCell>
                          <TableCell className="font-mono text-xs">{fmtCnpj(t.cpfCnpj)}</TableCell>
                          <TableCell>{t.cidade ? `${t.cidade}/${t.estado}` : "—"}</TableCell>
                          <TableCell className="text-sm">{t.email || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{t.prestadorNome || "—"}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => { setEditTomador(t); setShowTomadorForm(true); }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-500 hover:text-red-700"
                                onClick={() => {
                                  if (confirm("Desativar este tomador?")) deleteTomador.mutate({ id: t.id });
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialogs */}
      {showPortalForm && (
        <PortalForm
          open={showPortalForm}
          onClose={() => { setShowPortalForm(false); setEditPortal(null); }}
          editData={editPortal}
        />
      )}
      {showPrestadorForm && (
        <PrestadorForm
          open={showPrestadorForm}
          onClose={() => { setShowPrestadorForm(false); setEditPrestador(null); }}
          editData={editPrestador}
          portais={portais}
        />
      )}
      {showTomadorForm && (selectedConfigId || configs.length > 0) && (
        <TomadorForm
          open={showTomadorForm}
          onClose={() => { setShowTomadorForm(false); setEditTomador(null); }}
          configId={editTomador?.configId || selectedConfigId || configs[0]?.id}
          editData={editTomador}
        />
      )}
      {captureSessionPortal && (
        <CaptureSessionDialog
          open={!!captureSessionPortal}
          onClose={() => setCaptureSessionPortal(null)}
          portal={captureSessionPortal}
        />
      )}
    </div>
  );
}
