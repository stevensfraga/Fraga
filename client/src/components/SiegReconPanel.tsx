/**
 * SiegReconPanel.tsx
 * Painel visual de reconciliação SIEG ↔ banco local.
 *
 * Classificações:
 *  - local_ok:    ✅ Local + SIEG OK
 *  - sieg_only:   🌐 Só SIEG (sem arquivo local)
 *  - local_only:  💾 Só Local (não encontrado no SIEG)
 *  - divergent:   ⚠️ Divergente (dados inconsistentes)
 *  - not_reconciled: ❓ Não reconciliado
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Globe,
  HardDrive,
  AlertTriangle,
  HelpCircle,
  RefreshCw,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ReconStatus = "local_ok" | "sieg_only" | "local_only" | "divergent" | "not_reconciled";

interface ReconConfig {
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}

const RECON_CONFIG: Record<ReconStatus, ReconConfig> = {
  local_ok: {
    label: "Local + SIEG OK",
    icon: <CheckCircle2 className="w-4 h-4" />,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    description: "Certificado presente localmente e no SIEG com dados consistentes",
  },
  sieg_only: {
    label: "Só SIEG",
    icon: <Globe className="w-4 h-4" />,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
    description: "Certificado cadastrado no SIEG mas sem arquivo local no servidor",
  },
  local_only: {
    label: "Só Local",
    icon: <HardDrive className="w-4 h-4" />,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    description: "Certificado presente localmente mas não encontrado no SIEG",
  },
  divergent: {
    label: "Divergente",
    icon: <AlertTriangle className="w-4 h-4" />,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
    description: "Certificado presente em ambos mas com dados inconsistentes (status, expiração)",
  },
  not_reconciled: {
    label: "Não Reconciliado",
    icon: <HelpCircle className="w-4 h-4" />,
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/20",
    description: "Certificado ainda não passou pela reconciliação",
  },
};

// ─── Componente principal ─────────────────────────────────────────────────────

export function SiegReconPanel() {
  const [selectedStatus, setSelectedStatus] = useState<ReconStatus | null>(null);
  const [listPage, setListPage] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<any>(null);
  const [showLastResult, setShowLastResult] = useState(false);
  const [showOnlyActive, setShowOnlyActive] = useState(false);

  const utils = trpc.useUtils();

  // Stats query
  const statsQ = trpc.certificates.siegReconStats.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  // List query (só carrega quando um status é selecionado)
  const listQ = trpc.certificates.siegReconList.useQuery(
    {
      reconStatus: selectedStatus ?? undefined,
      page: listPage,
      pageSize: 20,
    },
    {
      enabled: selectedStatus !== null,
    }
  );

  // Mutation de reconciliação manual
  const reconMut = trpc.certificates.siegRunRecon.useMutation({
    onSuccess: (data) => {
      setLastRunResult(data);
      setShowLastResult(true);
      setIsRunning(false);
      utils.certificates.siegReconStats.invalidate();
      utils.certificates.siegReconList.invalidate();
    },
    onError: (err) => {
      setIsRunning(false);
      console.error("[SiegReconPanel] Erro na reconciliação:", err.message);
    },
  });

  const handleRunRecon = () => {
    setIsRunning(true);
    setShowLastResult(false);
    reconMut.mutate();
  };

  const stats = statsQ.data;
  const distribution = stats?.distribution ?? {};

  // Calcular total reconciliado
  const totalReconStatuses = ["local_ok", "sieg_only", "local_only", "divergent"] as const;
  const totalReconciled = totalReconStatuses.reduce(
    (acc, s) => acc + (distribution[s] ?? 0),
    0
  );
  const notReconciled = (stats?.total ?? 0) - totalReconciled;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">Reconciliação SIEG</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Visão completa: local + remoto SIEG
            {stats?.lastSyncedAt && (
              <span className="ml-2 inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Última sync: {new Date(stats.lastSyncedAt).toLocaleString("pt-BR")}
              </span>
            )}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRunRecon}
          disabled={isRunning}
          className="gap-2 text-xs border-slate-600 hover:border-blue-500 hover:text-blue-400"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? "animate-spin" : ""}`} />
          {isRunning ? "Reconciliando..." : "Reconciliar Agora"}
        </Button>
      </div>

      {/* Filtro de ativos */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowOnlyActive(!showOnlyActive)}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            showOnlyActive
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-slate-700/50 text-slate-400 border border-slate-600 hover:border-slate-500'
          }`}
        >
          {showOnlyActive ? '✓ Ativos no SIEG' : 'Mostrar Ativos'}
        </button>
        {showOnlyActive && (
          <span className="text-xs text-slate-400">
            (Mostrando apenas certificados ativos e válidos no SIEG)
          </span>
        )}
      </div>

      {/* Cards de classificação */}
      <div className={`grid ${showOnlyActive ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2 md:grid-cols-5'} gap-2`}>
        {(showOnlyActive
          ? (["local_ok", "sieg_only"] as ReconStatus[])
          : (["local_ok", "sieg_only", "local_only", "divergent", "not_reconciled"] as ReconStatus[])
        ).map(
          (status) => {
            const cfg = RECON_CONFIG[status];
            const count =
              status === "not_reconciled"
                ? notReconciled
                : distribution[status] ?? 0;
            const isSelected = selectedStatus === status;

            return (
              <button
                key={status}
                onClick={() => {
                  setSelectedStatus(isSelected ? null : status);
                  setListPage(1);
                }}
                title={cfg.description}
                className={`
                  flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-all
                  ${cfg.bgColor} ${cfg.borderColor}
                  ${isSelected ? "ring-1 ring-white/20 scale-[1.02]" : "hover:scale-[1.01]"}
                `}
              >
                <div className={`flex items-center gap-1.5 ${cfg.color}`}>
                  {cfg.icon}
                  <span className="text-xs font-medium">{cfg.label}</span>
                </div>
                <span className="text-2xl font-bold text-white">{count}</span>
              </button>
            );
          }
        )}
      </div>

      {/* Resultado da última reconciliação */}
      {showLastResult && lastRunResult && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Reconciliação concluída em {lastRunResult.duration_ms}ms
            </span>
            <button
              onClick={() => setShowLastResult(false)}
              className="text-slate-500 hover:text-slate-300 text-xs"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
            {[
              { label: "SIEG total", value: lastRunResult.sieg_total },
              { label: "Local total", value: lastRunResult.local_total },
              { label: "Local OK", value: lastRunResult.stats?.local_ok },
              { label: "Só SIEG", value: lastRunResult.stats?.sieg_only },
              { label: "Só Local", value: lastRunResult.stats?.local_only },
              { label: "Divergentes", value: lastRunResult.stats?.divergent },
              { label: "Criados", value: lastRunResult.stats?.created },
              { label: "Atualizados", value: lastRunResult.stats?.updated },
              { label: "Erros", value: lastRunResult.stats?.errors },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <div className="text-slate-400">{item.label}</div>
                <div className="text-white font-semibold">{item.value ?? 0}</div>
              </div>
            ))}
          </div>
          {lastRunResult.errors?.length > 0 && (
            <div className="mt-2 text-xs text-red-400">
              {lastRunResult.errors.slice(0, 3).map((e: any, i: number) => (
                <div key={i}>⚠ {e.cnpj}: {e.error}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lista detalhada (ao clicar em um card) */}
      {selectedStatus && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <span className={RECON_CONFIG[selectedStatus].color}>
                {RECON_CONFIG[selectedStatus].icon}
              </span>
              <span className="text-sm font-medium text-white">
                {RECON_CONFIG[selectedStatus].label}
              </span>
              {listQ.data && (
                <Badge variant="secondary" className="text-xs">
                  {listQ.data.total} registros
                </Badge>
              )}
            </div>
            <button
              onClick={() => setSelectedStatus(null)}
              className="text-slate-500 hover:text-slate-300 text-xs"
            >
              ✕ Fechar
            </button>
          </div>

          {listQ.isLoading ? (
            <div className="px-4 py-6 text-center text-slate-400 text-sm">Carregando...</div>
          ) : listQ.data?.items.length === 0 ? (
            <div className="px-4 py-6 text-center text-slate-400 text-sm">Nenhum registro encontrado</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left px-4 py-2.5 text-slate-400 font-medium">CNPJ</th>
                      <th className="text-left px-4 py-2.5 text-slate-400 font-medium">Empresa</th>
                      <th className="text-left px-4 py-2.5 text-slate-400 font-medium hidden md:table-cell">SIEG ID</th>
                      <th className="text-left px-4 py-2.5 text-slate-400 font-medium hidden md:table-cell">SIEG Status</th>
                      <th className="text-left px-4 py-2.5 text-slate-400 font-medium hidden lg:table-cell">Expira (SIEG)</th>
                      <th className="text-left px-4 py-2.5 text-slate-400 font-medium hidden lg:table-cell">Fonte</th>
                      <th className="text-left px-4 py-2.5 text-slate-400 font-medium hidden lg:table-cell">Sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listQ.data?.items.map((cert: any) => (
                      <tr key={cert.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                        <td className="px-4 py-2.5 font-mono text-slate-300">{cert.cnpj}</td>
                        <td className="px-4 py-2.5 text-slate-200 max-w-[180px] truncate">
                          {cert.company_name || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-400 hidden md:table-cell font-mono">
                          {cert.sieg_id || "—"}
                        </td>
                        <td className="px-4 py-2.5 hidden md:table-cell">
                          {cert.sieg_remote_status ? (
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium
                              ${cert.sieg_remote_status === "Ativo"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : cert.sieg_remote_status === "Deletado"
                                ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                : "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                              }`}>
                              {cert.sieg_remote_status}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-400 hidden lg:table-cell">
                          {cert.sieg_remote_expiry
                            ? new Date(cert.sieg_remote_expiry).toLocaleDateString("pt-BR")
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 hidden lg:table-cell">
                          {cert.sieg_source ? (
                            <span className="text-slate-400">{cert.sieg_source}</span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 hidden lg:table-cell">
                          {cert.sieg_synced_at
                            ? new Date(cert.sieg_synced_at).toLocaleString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              {listQ.data && listQ.data.total > listQ.data.pageSize && (
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-700">
                  <span className="text-xs text-slate-400">
                    {(listPage - 1) * 20 + 1}–{Math.min(listPage * 20, listQ.data.total)} de {listQ.data.total}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={listPage === 1}
                      onClick={() => setListPage(p => p - 1)}
                      className="h-6 px-2 text-xs border-slate-600"
                    >
                      <ChevronDown className="w-3 h-3 rotate-90" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={listPage * 20 >= listQ.data.total}
                      onClick={() => setListPage(p => p + 1)}
                      className="h-6 px-2 text-xs border-slate-600"
                    >
                      <ChevronUp className="w-3 h-3 rotate-90" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
