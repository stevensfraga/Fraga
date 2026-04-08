import { useState, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Search, ChevronLeft, ChevronRight, Phone,
  Shield, ShieldOff, PauseCircle, PlayCircle, UserPlus, Pencil,
  Trash2, Star, ArrowLeft, RefreshCw, Eye, AlertTriangle,
  CheckCircle2, XCircle, GitMerge, Copy,
} from "lucide-react";

function fmtDoc(doc: string | null) {
  if (!doc) return "—";
  if (doc.length === 14) return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (doc.length === 11) return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return doc;
}

function fmtBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

// ── Inline edit state ──────────────────────────────────────────────────────
type InlineEdit = { clientId: number; field: "whatsappNumber" | "phone" | "email"; value: string } | null;

// ── Célula editável inline ─────────────────────────────────────────────────
function InlineCell({
  clientId, field, value, onSave, placeholder, missing,
}: {
  clientId: number;
  field: "whatsappNumber" | "phone" | "email";
  value: string | null;
  onSave: (clientId: number, field: string, value: string) => void;
  placeholder?: string;
  missing?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(value || "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function save(e?: React.FocusEvent | React.KeyboardEvent) {
    e?.stopPropagation?.();
    setEditing(false);
    if (draft !== (value || "")) {
      onSave(clientId, field, draft);
    }
  }

  if (editing) {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") save(e as any);
            if (e.key === "Escape") { setEditing(false); }
          }}
          className="h-6 text-xs px-1 py-0 w-32"
          placeholder={placeholder}
        />
      </div>
    );
  }

  return (
    <span
      className={`cursor-pointer group flex items-center gap-1 rounded px-1 hover:bg-slate-100 transition-colors text-xs font-mono ${missing ? "text-red-500 font-semibold" : ""}`}
      onClick={startEdit}
      title="Clique para editar"
    >
      {value || <span className="text-red-400 font-normal">sem {field === "email" ? "email" : "telefone"}</span>}
      <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-40 shrink-0" />
    </span>
  );
}

// ── Modal de duplicatas ────────────────────────────────────────────────────
function DuplicatesModal({
  onClose,
  onMerge,
}: {
  onClose: () => void;
  onMerge: (primaryId: number, secondaryId: number) => void;
}) {
  const { data, isLoading } = trpc.clientsManager.listDuplicates.useQuery();

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4 text-amber-600" /> Duplicatas Detectadas
          </DialogTitle>
          <DialogDescription>
            Clientes com mesmo CNPJ ou nome similar. Clique em "Mesclar" para unificar.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && data?.pairs.length === 0 && (
          <div className="text-center py-10 text-muted-foreground text-sm">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
            Nenhuma duplicata encontrada.
          </div>
        )}

        <div className="space-y-3">
          {data?.pairs.map((pair, i) => (
            <div key={i} className="border rounded-lg overflow-hidden">
              <div className={`px-3 py-1.5 flex items-center justify-between text-xs font-semibold ${
                pair.reason === "cnpj"
                  ? "bg-red-50 text-red-700 border-b border-red-100"
                  : "bg-amber-50 text-amber-700 border-b border-amber-100"
              }`}>
                <span>{pair.reason === "cnpj" ? "⚠ Mesmo CNPJ" : "~ Nome similar"}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs"
                  onClick={() => {
                    // Principal = quem tem mais recebíveis
                    const [prim, sec] = pair.a.receivableCount >= pair.b.receivableCount
                      ? [pair.a, pair.b]
                      : [pair.b, pair.a];
                    onMerge(prim.id, sec.id);
                    onClose();
                  }}
                >
                  <GitMerge className="h-3 w-3 mr-1" /> Mesclar
                </Button>
              </div>
              <div className="grid grid-cols-2 divide-x text-xs">
                {[pair.a, pair.b].map((c, j) => (
                  <div key={j} className="p-3 space-y-0.5">
                    <p className="font-semibold text-slate-800 truncate" title={c.name}>#{c.id} {c.name}</p>
                    <p className="text-muted-foreground">CNPJ: {fmtDoc(c.document)}</p>
                    <p className="text-muted-foreground">WhatsApp: {c.whatsappNumber || "—"}</p>
                    <p className="text-muted-foreground">Tel: {c.phone || "—"}</p>
                    <p className="text-muted-foreground">Email: {c.email || "—"}</p>
                    <p className={`font-medium ${c.receivableCount > 0 ? "text-orange-600" : "text-slate-400"}`}>
                      {c.receivableCount} recebível(is)
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Diálogo de mesclagem ───────────────────────────────────────────────────
function MergeDialog({
  primaryId,
  preSelectedSecondary,
  onClose,
}: {
  primaryId: number;
  preSelectedSecondary?: { id: number; name: string; whatsappNumber?: string | null; document?: string | null } | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedSecondary, setSelectedSecondary] = useState<any>(preSelectedSecondary ?? null);
  const [confirmed, setConfirmed] = useState(false);

  const { data: searchData, isLoading } = trpc.clientsManager.list.useQuery(
    { page: 1, perPage: 10, search: search || undefined },
    { enabled: !!search && !selectedSecondary }
  );

  const { data: primaryData } = trpc.clientsManager.list.useQuery(
    { page: 1, perPage: 1, search: String(primaryId) },
  );
  const primary = primaryData?.clients?.[0];

  const merge = trpc.clientsManager.merge.useMutation({
    onSuccess: () => {
      utils.clientsManager.list.invalidate();
      utils.clientsManager.stats.invalidate();
      toast.success("Mesclagem concluída. Cadastro duplicado removido.");
      onClose();
    },
    onError: (e) => toast.error("Erro ao mesclar: " + e.message),
  });

  const candidates = searchData?.clients?.filter((c) => c.id !== primaryId) ?? [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4" /> Mesclar Clientes
          </DialogTitle>
          <DialogDescription>
            O principal mantém todos os dados. O secundário tem seus recebíveis transferidos e é deletado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-green-50 border border-green-200 p-3">
            <p className="text-xs font-semibold text-green-700 mb-1">PRINCIPAL (mantido)</p>
            <p className="text-sm font-medium">#{primaryId} {primary?.name}</p>
            {primary && (
              <p className="text-xs text-muted-foreground mt-0.5">
                CNPJ: {fmtDoc(primary.document)} • {primary.whatsappNumber || "sem tel"}
              </p>
            )}
          </div>

          {!selectedSecondary && (
            <div>
              <Label>Buscar cliente a remover (secundário)</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  placeholder="Nome, CNPJ ou telefone..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setSearch(searchInput)}
                />
                <Button size="sm" variant="outline" onClick={() => setSearch(searchInput)}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
              {isLoading && <p className="text-xs text-muted-foreground mt-2">Buscando...</p>}
              {candidates.length > 0 && (
                <div className="mt-2 border rounded-md divide-y max-h-40 overflow-y-auto">
                  {candidates.map((c) => (
                    <button
                      key={c.id}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm"
                      onClick={() => setSelectedSecondary(c)}
                    >
                      <span className="font-medium">#{c.id}</span> {c.name}
                      <span className="text-xs text-muted-foreground ml-2">{fmtDoc(c.document)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedSecondary && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-xs font-semibold text-red-700 mb-1">SECUNDÁRIO (será deletado)</p>
              <p className="text-sm font-medium">#{selectedSecondary.id} {selectedSecondary.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                CNPJ: {fmtDoc(selectedSecondary.document)} • {selectedSecondary.whatsappNumber || "sem tel"}
              </p>
              <Button variant="ghost" size="sm" className="mt-1 h-6 text-xs" onClick={() => { setSelectedSecondary(null); setConfirmed(false); }}>
                Trocar
              </Button>
            </div>
          )}

          {selectedSecondary && (
            <div className="bg-slate-50 rounded p-3 text-xs space-y-1">
              <p className="font-medium text-sm">O que será feito:</p>
              <ul className="text-muted-foreground space-y-0.5 list-disc list-inside">
                <li>Todos os recebíveis do #{selectedSecondary.id} → #{primaryId}</li>
                <li>Contatos e agenda de cobrança transferidos</li>
                <li>Campos vazios do principal preenchidos com dados do secundário</li>
                <li>Cadastro #{selectedSecondary.id} deletado permanentemente</li>
              </ul>
              <label className="flex items-center gap-2 pt-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="rounded"
                />
                <span className="font-medium">Confirmo a mesclagem e deleção</span>
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          {selectedSecondary && (
            <Button
              variant="destructive"
              disabled={!confirmed || merge.isPending}
              onClick={() => merge.mutate({ primaryId, secondaryId: selectedSecondary.id })}
            >
              <GitMerge className="h-4 w-4 mr-1" />
              {merge.isPending ? "Mesclando..." : "Mesclar e Deletar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Diálogo de detalhes ────────────────────────────────────────────────────
function ClientDetailDialog({
  client, onClose, onEdit,
}: {
  client: any; onClose: () => void; onEdit: (c: any) => void;
}) {
  const { data: dupData } = trpc.clientsManager.findDuplicates.useQuery({ clientId: client.id });

  const fields = [
    { label: "Nome", value: client.name },
    { label: "CNPJ / CPF", value: fmtDoc(client.document) },
    { label: "Email", value: client.email || "—" },
    { label: "WhatsApp", value: client.whatsappNumber || "—" },
    { label: "Telefone", value: client.phone || "—" },
    { label: "Celular", value: client.phoneCellular || "—" },
    { label: "CNAE", value: client.cnae || "—" },
    { label: "Status", value: client.status },
    { label: "Opt-Out", value: client.optOut ? "Sim" : "Não" },
    { label: "Cobrança pausada até", value: client.billingPausedUntil ? new Date(client.billingPausedUntil).toLocaleDateString("pt-BR") : "—" },
    { label: "Negociação até", value: client.negotiatedUntil ? new Date(client.negotiatedUntil).toLocaleDateString("pt-BR") : "—" },
    { label: "Fonte WhatsApp", value: client.whatsappSource || "—" },
    { label: "Criado em", value: client.createdAt ? new Date(client.createdAt).toLocaleDateString("pt-BR") : "—" },
  ];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" /> Dados do Cliente
          </DialogTitle>
          <DialogDescription className="text-xs font-mono">ID {client.id}</DialogDescription>
        </DialogHeader>

        <div className="space-y-0">
          {fields.map(({ label, value }) => (
            <div key={label} className="flex justify-between py-1.5 border-b last:border-0 text-sm">
              <span className="text-muted-foreground font-medium w-44 shrink-0">{label}</span>
              <span className="font-mono text-right break-all text-xs">{value}</span>
            </div>
          ))}
        </div>

        {dupData && dupData.duplicates.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm mb-1">
              <AlertTriangle className="h-4 w-4" /> Possíveis duplicados
            </div>
            {dupData.duplicates.map((d: any) => (
              <div key={d.id} className="text-xs text-amber-700 py-1 border-t border-amber-100">
                <span className="font-medium">#{d.id}</span> {d.name}
                <span className="ml-2 text-amber-500">({d.receivableCount} recebíveis)</span>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={() => { onClose(); onEdit(client); }}>
            <Pencil className="h-4 w-4 mr-1" /> Editar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Diálogo de edição completa ─────────────────────────────────────────────
function EditClientDialog({ client, onClose }: { client: any; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ ...client });
  const [confirmPhone, setConfirmPhone] = useState(false);
  const [confirmedPhone, setConfirmedPhone] = useState("");

  const updateClient = trpc.clientsManager.update.useMutation({
    onSuccess: () => {
      utils.clientsManager.list.invalidate();
      toast.success("Cliente atualizado");
      onClose();
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  const phoneChanged = form.whatsappNumber !== client.whatsappNumber
    || form.phone !== client.phone
    || form.phoneCellular !== client.phoneCellular;

  function handleSave() {
    if (phoneChanged && !confirmPhone) { setConfirmPhone(true); return; }
    if (phoneChanged && confirmPhone) {
      const newPhone = form.whatsappNumber || form.phone || form.phoneCellular || "";
      if (confirmedPhone !== newPhone) { toast.error("Confirmação não confere."); return; }
    }
    updateClient.mutate({
      id: form.id,
      name: form.name,
      email: form.email || undefined,
      whatsappNumber: form.whatsappNumber || undefined,
      phone: form.phone || undefined,
      phoneCellular: form.phoneCellular || undefined,
    });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Cliente</DialogTitle>
          <DialogDescription className="text-xs">#{client.id} — {client.name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {[
            { label: "Nome", key: "name" },
            { label: "Email", key: "email" },
            { label: "WhatsApp", key: "whatsappNumber", ph: "+5527999999999" },
            { label: "Telefone", key: "phone", ph: "+5527999999999" },
            { label: "Celular", key: "phoneCellular", ph: "+5527999999999" },
          ].map(({ label, key, ph }) => (
            <div key={key}>
              <Label className="flex items-center gap-1">
                {label}
                {form[key] !== client[key] && (
                  <span className="text-xs text-amber-600 font-normal ml-1">(era: {client[key] || "vazio"})</span>
                )}
              </Label>
              <Input
                value={form[key] || ""}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                placeholder={ph}
              />
            </div>
          ))}
          {confirmPhone && phoneChanged && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
                <AlertTriangle className="h-4 w-4" /> Digite o novo número para confirmar
              </p>
              <Input
                placeholder={form.whatsappNumber || form.phone || ""}
                value={confirmedPhone}
                onChange={(e) => setConfirmedPhone(e.target.value)}
                className="bg-white"
              />
              {confirmedPhone && confirmedPhone !== (form.whatsappNumber || form.phone || form.phoneCellular || "") && (
                <p className="text-xs text-red-600 flex items-center gap-1"><XCircle className="h-3 w-3" /> Não confere</p>
              )}
              {confirmedPhone && confirmedPhone === (form.whatsappNumber || form.phone || form.phoneCellular || "") && (
                <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Confirmado</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={updateClient.isPending}>
            {confirmPhone ? "Confirmar e Salvar" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Página principal ───────────────────────────────────────────────────────
export default function ClientsManager() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  const [detailClient, setDetailClient] = useState<any>(null);
  const [editClient, setEditClient] = useState<any>(null);
  const [mergeState, setMergeState] = useState<{
    primaryId: number;
    secondary?: { id: number; name: string; whatsappNumber?: string | null; document?: string | null } | null;
  } | null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [contactsClientId, setContactsClientId] = useState<number | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: "", phoneE164: "", role: "", notes: "" });

  const utils = trpc.useUtils();

  const { data: statsData } = trpc.clientsManager.stats.useQuery();
  const queryInput = useMemo(() => ({
    page, perPage: 20, search: search || undefined, onlyOverdue: onlyOverdue || undefined,
  }), [page, search, onlyOverdue]);
  const { data, isLoading, refetch } = trpc.clientsManager.list.useQuery(queryInput);
  const { data: contactsData, refetch: refetchContacts } = trpc.contacts.list.useQuery(
    { clientId: contactsClientId! },
    { enabled: !!contactsClientId }
  );

  // Inline edit mutation
  const updateInline = trpc.clientsManager.update.useMutation({
    onSuccess: (_, vars) => {
      utils.clientsManager.list.invalidate();
      toast.success("Atualizado");
    },
    onError: (e) => toast.error("Erro: " + e.message),
  });

  function handleInlineSave(clientId: number, field: string, value: string) {
    updateInline.mutate({ id: clientId, [field]: value || undefined } as any);
  }

  const toggleOptOut = trpc.clientsManager.toggleOptOut.useMutation({
    onSuccess: () => { utils.clientsManager.list.invalidate(); utils.clientsManager.stats.invalidate(); toast.success("Opt-out atualizado"); },
  });
  const pauseBilling = trpc.clientsManager.pauseBilling.useMutation({
    onSuccess: () => { utils.clientsManager.list.invalidate(); toast.success("Cobrança atualizada"); },
  });
  const addContact = trpc.contacts.add.useMutation({
    onSuccess: () => { refetchContacts(); setShowAddContact(false); setNewContact({ name: "", phoneE164: "", role: "", notes: "" }); toast.success("Contato adicionado"); },
  });
  const removeContact = trpc.contacts.remove.useMutation({
    onSuccess: () => { refetchContacts(); toast.success("Contato removido"); },
  });
  const setPrimary = trpc.contacts.setPrimary.useMutation({
    onSuccess: () => { refetchContacts(); utils.clientsManager.list.invalidate(); toast.success("Contato principal definido"); },
  });

  const handleSearch = () => { setSearch(searchInput); setPage(1); };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-bold text-slate-800">Gestão de Clientes</h1>
              <p className="text-xs text-muted-foreground">Busca • Edição inline • Duplicatas • Merge</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-amber-700 border-amber-300 hover:bg-amber-50"
              onClick={() => setShowDuplicates(true)}
            >
              <Copy className="h-4 w-4 mr-1" /> Ver Duplicatas
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Stats */}
        {statsData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total", value: statsData.total, color: "" },
              { label: "Ativos", value: statsData.active, color: "text-green-600" },
              { label: "Opt-Out", value: statsData.optedOut, color: "text-orange-600" },
              { label: "Inadimplentes", value: statsData.overdueClients, color: "text-red-600" },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="pt-4 pb-3">
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Filtros */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex gap-2 flex-1 min-w-[220px]">
                <Input
                  placeholder="Buscar por nome, CNPJ ou telefone..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="max-w-sm"
                />
                <Button size="sm" onClick={handleSearch}><Search className="h-4 w-4" /></Button>
                {search && (
                  <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}>
                    Limpar
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={onlyOverdue} onCheckedChange={(v) => { setOnlyOverdue(v); setPage(1); }} />
                <Label className="text-sm">Só inadimplentes</Label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              💡 Clique no telefone ou email de um cliente na tabela para editar diretamente.
              <span className="ml-2 text-red-500 font-medium">Linha vermelha = sem contato (impossível cobrar).</span>
            </p>
          </CardContent>
        </Card>

        {/* Tabela */}
        <Card>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>CNPJ/CPF</TableHead>
                      <TableHead>WhatsApp / Tel</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      {onlyOverdue && <TableHead>Dívida</TableHead>}
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!data?.clients?.length ? (
                      <TableRow>
                        <TableCell colSpan={onlyOverdue ? 7 : 6} className="text-center py-8 text-muted-foreground">
                          Nenhum cliente encontrado
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.clients.map((c) => {
                        const noContact = !c.whatsappNumber && !c.phone && !c.phoneCellular && !c.email;
                        return (
                          <TableRow
                            key={c.id}
                            className={`cursor-pointer ${noContact ? "bg-red-50 hover:bg-red-100" : "hover:bg-slate-50"}`}
                            onClick={() => navigate(`/cliente/${c.id}`)}
                          >
                            <TableCell className={`font-medium text-sm ${noContact ? "text-red-700" : ""}`}>
                              {noContact && <AlertTriangle className="h-3 w-3 inline mr-1 text-red-500" />}
                              {c.name}
                            </TableCell>
                            <TableCell className="text-xs font-mono">{fmtDoc(c.document)}</TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <InlineCell
                                clientId={c.id}
                                field="whatsappNumber"
                                value={c.whatsappNumber}
                                onSave={handleInlineSave}
                                placeholder="+5527..."
                                missing={noContact}
                              />
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <InlineCell
                                clientId={c.id}
                                field="email"
                                value={c.email}
                                onSave={handleInlineSave}
                                placeholder="email@..."
                                missing={noContact}
                              />
                            </TableCell>
                            <TableCell>
                              <Badge variant={c.status === "active" ? "default" : "secondary"} className="text-xs">{c.status}</Badge>
                            </TableCell>
                            {onlyOverdue && (
                              <TableCell className="text-sm font-semibold text-red-600">
                                {c.totalDebt != null ? fmtBRL(c.totalDebt) : "—"}
                              </TableCell>
                            )}
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex gap-1 justify-end">
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                  onClick={() => setDetailClient(c)} title="Ver detalhes">
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                  onClick={() => setEditClient(c)} title="Editar">
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                  onClick={() => setContactsClientId(c.id)} title="Contatos">
                                  <Phone className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                  onClick={() => setMergeState({ primaryId: c.id })} title="Mesclar">
                                  <GitMerge className="h-3.5 w-3.5 text-purple-600" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                  onClick={() => toggleOptOut.mutate({ id: c.id })}
                                  title={c.optOut ? "Reativar" : "Opt-Out"}>
                                  {c.optOut ? <Shield className="h-3.5 w-3.5 text-green-600" /> : <ShieldOff className="h-3.5 w-3.5 text-red-600" />}
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                  onClick={() => pauseBilling.mutate({
                                    id: c.id,
                                    until: c.billingPausedUntil ? null : new Date(Date.now() + 30 * 86400000).toISOString(),
                                  })}
                                  title={c.billingPausedUntil ? "Retomar" : "Pausar 30d"}>
                                  {c.billingPausedUntil
                                    ? <PlayCircle className="h-3.5 w-3.5 text-green-600" />
                                    : <PauseCircle className="h-3.5 w-3.5 text-orange-600" />}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                {data && data.totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t">
                    <span className="text-sm text-muted-foreground">
                      Página {data.page} de {data.totalPages} ({data.total} clientes)
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modais */}
      {showDuplicates && (
        <DuplicatesModal
          onClose={() => setShowDuplicates(false)}
          onMerge={(primaryId, secondaryId) => {
            // Encontrar os dados do secondary para mostrar no merge dialog
            setMergeState({ primaryId, secondary: { id: secondaryId, name: `#${secondaryId}` } });
          }}
        />
      )}

      {detailClient && (
        <ClientDetailDialog
          client={detailClient}
          onClose={() => setDetailClient(null)}
          onEdit={(c) => { setDetailClient(null); setEditClient(c); }}
        />
      )}

      {editClient && (
        <EditClientDialog client={editClient} onClose={() => setEditClient(null)} />
      )}

      {mergeState && (
        <MergeDialog
          primaryId={mergeState.primaryId}
          preSelectedSecondary={mergeState.secondary}
          onClose={() => setMergeState(null)}
        />
      )}

      {/* Contatos */}
      <Dialog open={!!contactsClientId} onOpenChange={() => { setContactsClientId(null); setShowAddContact(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Phone className="h-4 w-4" /> Contatos do Cliente</DialogTitle>
          </DialogHeader>
          {contactsData?.contacts?.length === 0 && !showAddContact && (
            <p className="text-sm text-muted-foreground py-4">Nenhum contato cadastrado.</p>
          )}
          {contactsData?.contacts?.map((ct) => (
            <div key={ct.id} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <div className="font-medium text-sm">{ct.name}</div>
                <div className="text-xs text-muted-foreground">{ct.phoneE164} {ct.role && `• ${ct.role}`}</div>
                {ct.notes && <div className="text-xs text-muted-foreground italic">{ct.notes}</div>}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => setPrimary.mutate({ clientId: contactsClientId!, contactId: ct.id })}>
                  <Star className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => removeContact.mutate({ id: ct.id })}>
                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
          {showAddContact ? (
            <div className="space-y-3 pt-2 border-t">
              <div><Label>Nome</Label><Input value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} /></div>
              <div><Label>Telefone (E.164)</Label><Input value={newContact.phoneE164} onChange={(e) => setNewContact({ ...newContact, phoneE164: e.target.value })} placeholder="+5527999999999" /></div>
              <div><Label>Cargo</Label><Input value={newContact.role} onChange={(e) => setNewContact({ ...newContact, role: e.target.value })} /></div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowAddContact(false)}>Cancelar</Button>
                <Button size="sm" onClick={() => {
                  if (!contactsClientId || !newContact.name || !newContact.phoneE164) return;
                  addContact.mutate({ clientId: contactsClientId, ...newContact });
                }} disabled={addContact.isPending}>Salvar</Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowAddContact(true)} className="mt-2">
              <UserPlus className="h-4 w-4 mr-1" /> Adicionar Contato
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
