import { useState, useMemo } from "react";
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
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Search, ChevronLeft, ChevronRight, Phone,
  Shield, ShieldOff, PauseCircle, PlayCircle, UserPlus, Pencil,
  Trash2, Star, ArrowLeft, RefreshCw,
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

export default function ClientsManager() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [editClient, setEditClient] = useState<any>(null);
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

  const toggleOptOut = trpc.clientsManager.toggleOptOut.useMutation({
    onSuccess: () => { utils.clientsManager.list.invalidate(); utils.clientsManager.stats.invalidate(); toast.success("Opt-out atualizado"); },
  });
  const pauseBilling = trpc.clientsManager.pauseBilling.useMutation({
    onSuccess: () => { utils.clientsManager.list.invalidate(); toast.success("Cobrança atualizada"); },
  });
  const updateClient = trpc.clientsManager.update.useMutation({
    onSuccess: () => { utils.clientsManager.list.invalidate(); setEditClient(null); toast.success("Cliente atualizado"); },
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
              <p className="text-xs text-muted-foreground">CRUD completo com multi-contatos</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
          </Button>
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

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex gap-2 flex-1 min-w-[200px]">
                <Input placeholder="Buscar por nome, CNPJ ou email..." value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()} className="max-w-sm" />
                <Button size="sm" onClick={handleSearch}><Search className="h-4 w-4" /></Button>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={onlyOverdue} onCheckedChange={(v) => { setOnlyOverdue(v); setPage(1); }} />
                <Label className="text-sm">Só inadimplentes</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
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
                      <TableHead>WhatsApp</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Opt-Out</TableHead>
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
                      data.clients.map((c) => (
                        <TableRow key={c.id} className="cursor-pointer hover:bg-slate-50"
                          onClick={() => navigate(`/cliente/${c.id}`)}>
                          <TableCell className="font-medium text-sm">{c.name}</TableCell>
                          <TableCell className="text-xs font-mono">{fmtDoc(c.document)}</TableCell>
                          <TableCell className="text-xs">{c.whatsappNumber || "—"}</TableCell>
                          <TableCell>
                            <Badge variant={c.status === "active" ? "default" : "secondary"} className="text-xs">{c.status}</Badge>
                          </TableCell>
                          <TableCell>
                            {c.optOut
                              ? <Badge variant="destructive" className="text-xs">Opt-Out</Badge>
                              : <Badge variant="outline" className="text-xs">Ativo</Badge>}
                          </TableCell>
                          {onlyOverdue && (
                            <TableCell className="text-sm font-semibold text-red-600">
                              {c.totalDebt != null ? fmtBRL(c.totalDebt) : "—"}
                            </TableCell>
                          )}
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-1 justify-end">
                              <Button variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => setEditClient(c)} title="Editar">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => setContactsClientId(c.id)} title="Contatos">
                                <Phone className="h-3.5 w-3.5" />
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
                      ))
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

      {/* Edit Dialog */}
      <Dialog open={!!editClient} onOpenChange={() => setEditClient(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Cliente</DialogTitle></DialogHeader>
          {editClient && (
            <div className="space-y-4">
              <div><Label>Nome</Label><Input value={editClient.name} onChange={(e) => setEditClient({ ...editClient, name: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={editClient.email || ""} onChange={(e) => setEditClient({ ...editClient, email: e.target.value })} /></div>
              <div><Label>WhatsApp</Label><Input value={editClient.whatsappNumber || ""} onChange={(e) => setEditClient({ ...editClient, whatsappNumber: e.target.value })} /></div>
              <div><Label>Telefone</Label><Input value={editClient.phone || ""} onChange={(e) => setEditClient({ ...editClient, phone: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditClient(null)}>Cancelar</Button>
            <Button onClick={() => {
              if (!editClient) return;
              updateClient.mutate({ id: editClient.id, name: editClient.name, email: editClient.email || undefined, whatsappNumber: editClient.whatsappNumber || undefined, phone: editClient.phone || undefined });
            }} disabled={updateClient.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contacts Dialog */}
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
                  onClick={() => setPrimary.mutate({ clientId: contactsClientId!, contactId: ct.id })} title="Principal">
                  <Star className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => removeContact.mutate({ id: ct.id })} title="Remover">
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
