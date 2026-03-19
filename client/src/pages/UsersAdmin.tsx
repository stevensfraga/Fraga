import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Users, Shield, ShieldCheck, ShieldAlert, Eye, Trash2,
  ToggleLeft, ToggleRight, ClipboardList, RefreshCw, AlertTriangle
} from "lucide-react";

type AppRole = "master" | "admin" | "operador" | "visualizador" | "user";

const ROLE_CONFIG: Record<AppRole, { label: string; color: string; icon: React.ElementType; description: string }> = {
  master: {
    label: "Master",
    color: "bg-purple-100 text-purple-800 border-purple-200",
    icon: ShieldAlert,
    description: "Controle total do sistema"
  },
  admin: {
    label: "Admin",
    color: "bg-blue-100 text-blue-800 border-blue-200",
    icon: ShieldCheck,
    description: "Gerenciar empresas e certificados"
  },
  operador: {
    label: "Operador",
    color: "bg-green-100 text-green-800 border-green-200",
    icon: Shield,
    description: "Visualizar e atualizar certificados"
  },
  visualizador: {
    label: "Visualizador",
    color: "bg-gray-100 text-gray-700 border-gray-200",
    icon: Eye,
    description: "Apenas leitura"
  },
  user: {
    label: "Visualizador",
    color: "bg-gray-100 text-gray-700 border-gray-200",
    icon: Eye,
    description: "Apenas leitura"
  },
};

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[(role as AppRole)] ?? ROLE_CONFIG.user;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function formatDate(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export default function UsersAdmin() {
  const { user } = useAuth();
  const [editUser, setEditUser] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
  const [newRole, setNewRole] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [auditPage, setAuditPage] = useState(1);

  const utils = trpc.useUtils();

  const { data: permissions } = trpc.usersAdmin.myPermissions.useQuery();
  const { data: users, isLoading: usersLoading, refetch: refetchUsers } = trpc.usersAdmin.list.useQuery(
    undefined,
    { enabled: !!permissions?.canManageUsers }
  );
  const { data: auditData, isLoading: auditLoading } = trpc.usersAdmin.auditLogs.useQuery(
    { page: auditPage, pageSize: 30 },
    { enabled: !!permissions?.canViewAudit }
  );

  const updateRole = trpc.usersAdmin.updateRole.useMutation({
    onSuccess: () => {
      toast.success("Role atualizado com sucesso");
      utils.usersAdmin.list.invalidate();
      setEditUser(null);
    },
    onError: (e) => toast.error("Erro ao atualizar role", { description: e.message }),
  });

  const toggleActive = trpc.usersAdmin.toggleActive.useMutation({
    onSuccess: (_, vars) => {
      toast.success(vars.isActive ? "Usuário ativado" : "Usuário desativado");
      utils.usersAdmin.list.invalidate();
    },
    onError: (e) => toast.error("Erro", { description: e.message }),
  });

  const deleteUser = trpc.usersAdmin.delete.useMutation({
    onSuccess: () => {
      toast.success("Usuário excluído");
      utils.usersAdmin.list.invalidate();
      setDeleteConfirm(null);
    },
    onError: (e) => toast.error("Erro ao excluir", { description: e.message }),
  });

  const updateNotes = trpc.usersAdmin.updateNotes.useMutation({
    onSuccess: () => {
      toast.success("Observações salvas");
      utils.usersAdmin.list.invalidate();
    },
  });

  if (!permissions?.canManageUsers) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-muted-foreground">
        <Shield className="w-12 h-12 opacity-30" />
        <p className="text-lg font-medium">Acesso restrito</p>
        <p className="text-sm">Você precisa de permissão Admin ou superior para acessar esta página.</p>
      </div>
    );
  }

  const currentUserRole = (user?.role as AppRole) ?? "user";

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" />
            Administração de Usuários
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie acessos, roles e monitore ações críticas do sistema
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Seu nível:</span>
          <RoleBadge role={currentUserRole} />
          <Button variant="outline" size="sm" onClick={() => refetchUsers()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(["master", "admin", "operador", "visualizador"] as AppRole[]).map(role => {
          const cfg = ROLE_CONFIG[role];
          const count = users?.filter(u => u.role === role || (role === "visualizador" && u.role === "user")).length ?? 0;
          const Icon = cfg.icon;
          return (
            <Card key={role} className="border">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{cfg.label}</p>
                    <p className="text-2xl font-bold">{count}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>
                  </div>
                  <Icon className="w-8 h-8 opacity-20" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" className="gap-2">
            <Users className="w-4 h-4" /> Usuários
          </TabsTrigger>
          {permissions.canViewAudit && (
            <TabsTrigger value="audit" className="gap-2">
              <ClipboardList className="w-4 h-4" /> Auditoria
            </TabsTrigger>
          )}
        </TabsList>

        {/* Tab Usuários */}
        <TabsContent value="users">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Usuários do Sistema</CardTitle>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="text-center py-8 text-muted-foreground">Carregando...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Usuário</th>
                        <th className="pb-2 pr-4 font-medium">Role</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 pr-4 font-medium">Último acesso</th>
                        <th className="pb-2 pr-4 font-medium">Criado em</th>
                        <th className="pb-2 font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users?.map(u => {
                        const isMe = u.id === (user as any)?.id;
                        const isMaster = u.role === "master";
                        const canEdit = !isMe && !isMaster && permissions.canChangeRoles;
                        const canToggle = !isMe && !isMaster && permissions.canManageUsers;
                        const canDelete = !isMe && !isMaster && permissions.canDeleteUsers;

                        return (
                          <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-3 pr-4">
                              <div className="font-medium">{u.name || "—"}</div>
                              <div className="text-xs text-muted-foreground">{u.email || "—"}</div>
                              {isMe && <span className="text-xs text-blue-600 font-medium">Você</span>}
                            </td>
                            <td className="py-3 pr-4">
                              <RoleBadge role={u.role} />
                            </td>
                            <td className="py-3 pr-4">
                              {u.isActive ? (
                                <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50">Ativo</Badge>
                              ) : (
                                <Badge variant="outline" className="text-red-700 border-red-200 bg-red-50">Inativo</Badge>
                              )}
                            </td>
                            <td className="py-3 pr-4 text-xs text-muted-foreground">{formatDate(u.lastSignedIn)}</td>
                            <td className="py-3 pr-4 text-xs text-muted-foreground">{formatDate(u.createdAt)}</td>
                            <td className="py-3">
                              <div className="flex items-center gap-1">
                                {canEdit && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => {
                                      setEditUser(u);
                                      setNewRole(u.role);
                                      setNotes(u.notes ?? "");
                                    }}
                                  >
                                    <Shield className="w-3.5 h-3.5 mr-1" />
                                    Role
                                  </Button>
                                )}
                                {canToggle && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => toggleActive.mutate({ userId: u.id, isActive: !u.isActive })}
                                    disabled={toggleActive.isPending}
                                  >
                                    {u.isActive
                                      ? <ToggleRight className="w-3.5 h-3.5 text-green-600" />
                                      : <ToggleLeft className="w-3.5 h-3.5 text-gray-400" />
                                    }
                                  </Button>
                                )}
                                {canDelete && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                                    onClick={() => setDeleteConfirm(u)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                {!canEdit && !canToggle && !canDelete && (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab Auditoria */}
        {permissions.canViewAudit && (
          <TabsContent value="audit">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardList className="w-4 h-4" />
                  Log de Auditoria
                  <span className="text-xs font-normal text-muted-foreground">
                    ({auditData?.total ?? 0} registros)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {auditLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Carregando...</div>
                ) : auditData?.logs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">Nenhum registro de auditoria ainda.</div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="pb-2 pr-4 font-medium">Data/Hora</th>
                            <th className="pb-2 pr-4 font-medium">Usuário</th>
                            <th className="pb-2 pr-4 font-medium">Ação</th>
                            <th className="pb-2 pr-4 font-medium">Recurso</th>
                            <th className="pb-2 pr-4 font-medium">Descrição</th>
                            <th className="pb-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditData?.logs.map((log: any) => (
                            <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                                {formatDate(log.createdAt)}
                              </td>
                              <td className="py-2 pr-4">
                                <div className="text-xs font-medium">{log.userName || "Sistema"}</div>
                                {log.userRole && <RoleBadge role={log.userRole} />}
                              </td>
                              <td className="py-2 pr-4">
                                <code className="text-xs bg-muted px-1 py-0.5 rounded">{log.action}</code>
                              </td>
                              <td className="py-2 pr-4 text-xs text-muted-foreground">
                                {log.resource}{log.resourceId ? ` #${log.resourceId}` : ""}
                              </td>
                              <td className="py-2 pr-4 text-xs max-w-xs truncate" title={log.description}>
                                {log.description || "—"}
                              </td>
                              <td className="py-2">
                                {log.status === "success" ? (
                                  <Badge variant="outline" className="text-green-700 border-green-200 bg-green-50 text-xs">OK</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-red-700 border-red-200 bg-red-50 text-xs">Falha</Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Paginação */}
                    {auditData && auditData.total > 30 && (
                      <div className="flex items-center justify-between mt-4">
                        <p className="text-xs text-muted-foreground">
                          Página {auditPage} de {Math.ceil(auditData.total / 30)}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={auditPage === 1}
                            onClick={() => setAuditPage(p => p - 1)}
                          >
                            Anterior
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={auditPage >= Math.ceil(auditData.total / 30)}
                            onClick={() => setAuditPage(p => p + 1)}
                          >
                            Próxima
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Dialog: Editar Role */}
      <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Alterar Role — {editUser?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Role atual</p>
              <RoleBadge role={editUser?.role ?? "user"} />
            </div>
            <div>
              <p className="text-sm font-medium mb-1">Novo role</p>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(permissions?.assignableRoles ?? []).map(r => (
                    <SelectItem key={r} value={r}>
                      {ROLE_CONFIG[r]?.label ?? r} — {ROLE_CONFIG[r]?.description ?? ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-sm font-medium mb-1">Observações internas (opcional)</p>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Ex: Funcionário do setor financeiro, acesso temporário..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancelar</Button>
            <Button
              onClick={() => updateRole.mutate({ userId: editUser.id, newRole: newRole as any, notes })}
              disabled={updateRole.isPending || newRole === editUser?.role}
            >
              {updateRole.isPending ? "Salvando..." : "Salvar alteração"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Confirmar exclusão */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              Excluir usuário
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm">
              Tem certeza que deseja excluir <strong>{deleteConfirm?.name}</strong>?
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Esta ação é irreversível. O usuário perderá acesso imediatamente.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => deleteUser.mutate({ userId: deleteConfirm.id })}
              disabled={deleteUser.isPending}
            >
              {deleteUser.isPending ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
