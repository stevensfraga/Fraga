import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Clock, AlertCircle, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { AccessoriesPanelModal } from "@/components/AccessoriesPanelModal";

interface AccessoriesPanel {
  id: string;
  nome: string;
  status: "ok" | "atencao" | "critico";
  descricao: string;
  valor?: number;
  percentual?: number;
  ultimaAtualizacao?: string;
}

interface AccessoriesData {
  sped: AccessoriesPanel;
  reinf: AccessoriesPanel;
  alvara: AccessoriesPanel;
  contabil: AccessoriesPanel;
  mitDctf: AccessoriesPanel;
  parcelamentos: AccessoriesPanel;
  dasMesAtual: AccessoriesPanel;
  dasMesAnterior: AccessoriesPanel;
  demandaMesAtual: AccessoriesPanel;
  fiscalIndicadores: AccessoriesPanel;
  pessoalInss: AccessoriesPanel;
  controleFiscal: AccessoriesPanel;
}

function getStatusColor(status: "ok" | "atencao" | "critico"): { bg: string; text: string; icon: React.ReactNode } {
  switch (status) {
    case "ok":
      return {
        bg: "bg-green-900/30 border-green-700/50",
        text: "text-green-400",
        icon: <CheckCircle2 className="w-5 h-5" />,
      };
    case "atencao":
      return {
        bg: "bg-yellow-900/30 border-yellow-700/50",
        text: "text-yellow-400",
        icon: <Clock className="w-5 h-5" />,
      };
    case "critico":
      return {
        bg: "bg-red-900/30 border-red-700/50",
        text: "text-red-400",
        icon: <AlertTriangle className="w-5 h-5" />,
      };
  }
}

const mockAccessoriesData: AccessoriesData = {
  sped: {
    id: "sped",
    nome: "SPED",
    status: "ok",
    descricao: "Sistema Público de Escrituração Digital",
    percentual: 85,
    ultimaAtualizacao: "2026-02-07",
  },
  reinf: {
    id: "reinf",
    nome: "REINF",
    status: "ok",
    descricao: "Reinvindicação de Informações Fiscais",
    percentual: 95,
    ultimaAtualizacao: "2026-02-05",
  },
  alvara: {
    id: "alvara",
    nome: "ALVARA",
    status: "critico",
    descricao: "Alvarás e Licenças",
    percentual: 60,
    ultimaAtualizacao: "2026-01-15",
  },
  contabil: {
    id: "contabil",
    nome: "CONTABIL",
    status: "ok",
    descricao: "Contabilidade e Registros",
    percentual: 90, // Progresso parcial
    ultimaAtualizacao: "2026-02-07",
  },
  mitDctf: {
    id: "mitDctf",
    nome: "MIT DCTF WEB",
    status: "atencao",
    descricao: "MIT DCTF Web",
    percentual: 80,
    ultimaAtualizacao: "2026-02-01",
  },
  parcelamentos: {
    id: "parcelamentos",
    nome: "PARCELAMENTOS",
    status: "ok",
    descricao: "Parcelamentos de Débitos",
    percentual: 75, // Progresso parcial
    ultimaAtualizacao: "2026-02-07",
  },
  dasMesAtual: {
    id: "dasMesAtual",
    nome: "DAS MÊS ATUAL",
    status: "critico",
    descricao: "DAS do Mês Atual (Fevereiro)",
    valor: 5,
    percentual: 3, // 5 entregas de 156 total
    ultimaAtualizacao: "2026-02-07",
  },
  dasMesAnterior: {
    id: "dasMesAnterior",
    nome: "DAS MÊS ANTERIOR",
    status: "ok",
    descricao: "DAS do Mês Anterior (Janeiro)",
    valor: 0,
    percentual: 100,
    ultimaAtualizacao: "2026-02-01",
  },
  demandaMesAtual: {
    id: "demandaMesAtual",
    nome: "Demandas Mês atual",
    status: "atencao",
    descricao: "Demandas do Mês Atual",
    valor: 3,
    ultimaAtualizacao: "2026-02-07",
  },
  fiscalIndicadores: {
    id: "fiscalIndicadores",
    nome: "Fiscal - INDICADORES",
    status: "ok",
    descricao: "Indicadores Fiscais",
    percentual: 95,
    ultimaAtualizacao: "2026-02-07",
  },
  pessoalInss: {
    id: "pessoalInss",
    nome: "PESSOAL - INSS - FGTS",
    status: "ok",
    descricao: "Folha de Pagamento, INSS e FGTS",
    percentual: 80, // Progresso parcial
    ultimaAtualizacao: "2026-02-07",
  },
  controleFiscal: {
    id: "controleFiscal",
    nome: "Controle Departamento Fiscal",
    status: "ok",
    descricao: "Controle do Departamento Fiscal",
    percentual: 70, // Progresso parcial
    ultimaAtualizacao: "2026-02-07",
  },
};

function PanelCard({ panel, onClick }: { panel: AccessoriesPanel; onClick: () => void }) {
  const statusColor = getStatusColor(panel.status);

  return (
    <Card className={`${statusColor.bg} border cursor-pointer hover:shadow-lg transition-all hover:scale-105`} onClick={onClick}>
      <CardContent className="pt-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {statusColor.icon}
              <div>
                <div className={`font-semibold ${statusColor.text}`}>{panel.nome}</div>
                <div className="text-slate-400 text-sm">{panel.descricao}</div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <div className="text-slate-400">Status</div>
            <div className={`font-semibold ${statusColor.text}`}>
              {panel.status === "ok" ? "✓ OK" : panel.status === "atencao" ? "⚠️ Atenção" : "🚨 Crítico"}
            </div>
          </div>

          {panel.percentual !== undefined && (
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Progresso</span>
                <span className="text-white font-semibold">{panel.percentual}%</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${
                    panel.status === "ok"
                      ? "bg-green-500"
                      : panel.status === "atencao"
                        ? "bg-yellow-500"
                        : "bg-red-500"
                  }`}
                  style={{ width: `${panel.percentual}%` }}
                />
              </div>
            </div>
          )}

          {panel.valor !== undefined && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Quantidade</span>
              <span className="text-white font-semibold">{panel.valor}</span>
            </div>
          )}

          {panel.ultimaAtualizacao && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Última atualização</span>
              <span className="text-slate-400">{panel.ultimaAtualizacao}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AccessoriesDashboard() {
  const [selectedCompetencia, setSelectedCompetencia] = useState<string>("2026-02");
  const [selectedPanel, setSelectedPanel] = useState<string | null>(null);
  const [panelDetails, setPanelDetails] = useState<any>(null);
  const [panelClientes, setPanelClientes] = useState<any[]>([]);

  const { data: accessoriesData, isLoading, error } = trpc.acessorias.getAccessoriesData.useQuery({
    competencia: selectedCompetencia,
  }) as any;

  const { mutate: fetchPanelDetails, isPending: isLoadingDetails } = (trpc.acessoriasDetail.getPanelDetails as any).useMutation({
    onSuccess: (data: any) => {
      setPanelDetails(data.details);
      const mockClientes = [
        { cnpj: "21918918000194", nome: "R7 GERADORES LTDA", status: "pendente", dataEntrega: "2026-02-15" },
        { cnpj: "12345678000190", nome: "EMPRESA TESTE LTDA", status: "entregue", dataEntrega: "2026-02-05" },
        { cnpj: "98765432000180", nome: "OUTRA EMPRESA SA", status: "atrasado", dataEntrega: "2026-01-30" },
      ];
      setPanelClientes(mockClientes);
    },
    onError: () => {
      const defaultDetails = {
        entregas: { total: 0, antecipadas: { count: 0, percentage: 0 }, prazoTecnico: { count: 0, percentage: 0 }, atrasadas: { count: 0, percentage: 0, comMulta: 0 }, atrasoJustificado: { count: 0, percentage: 0 } },
        aRealizar: { total: 0, prazoAntecipado: { count: 0, percentage: 0 }, prazoTecnico: { count: 0, percentage: 0 }, atrasoLegal: { count: 0, percentage: 0, comMulta: 0 }, atrasoJustificado: { count: 0, percentage: 0 } },
        docs: { total: 0, lidos: { count: 0, percentage: 0 }, naoLidos: { count: 0, percentage: 0 }, iniciados: { count: 0, percentage: 0 }, concluidos: { count: 0, percentage: 0 } },
        processos: { total: 0, iniciados: { count: 0, percentage: 0 }, concluidos: { count: 0, percentage: 0 }, passosOk: { count: 0, percentage: 0 }, followupEnviados: { count: 0, percentage: 0 } },
      };
      setPanelDetails(defaultDetails);
      setPanelClientes([{ cnpj: "21918918000194", nome: "R7 GERADORES LTDA", status: "pendente", dataEntrega: "2026-02-15" }]);
    },
  });

  const generateCompetencias = () => {
    const competencias = [];
    const today = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      competencias.push(`${year}-${month}`);
    }
    return competencias;
  };

  const competencias = generateCompetencias();
  const displayData = (accessoriesData || mockAccessoriesData) as AccessoriesData;

  const allPanels = Object.values(displayData) as AccessoriesPanel[];
  const stats = {
    total: allPanels.length,
    ok: allPanels.filter((p) => p.status === "ok").length,
    atencao: allPanels.filter((p) => p.status === "atencao").length,
    critico: allPanels.filter((p) => p.status === "critico").length,
  };

  const criticalPanels = allPanels.filter((p) => p.status === "critico" || p.status === "atencao");

  const handlePanelClick = (panelName: string) => {
    setSelectedPanel(panelName);
    fetchPanelDetails({
      panelName,
      competencia: selectedCompetencia,
    });
  };

  return (
    <div className="space-y-6">
      {panelDetails && (
        <AccessoriesPanelModal
          open={!!selectedPanel}
          onOpenChange={(open) => !open && setSelectedPanel(null)}
          panelName={selectedPanel || ""}
          details={panelDetails}
          clientes={panelClientes}
        />
      )}

      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="pt-6">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-300">Selecione a Competência</label>
            <div className="flex gap-2">
              <select
                value={selectedCompetencia}
                onChange={(e) => setSelectedCompetencia(e.target.value)}
                className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                {competencias.map((comp) => {
                  const [year, month] = comp.split("-");
                  const monthName = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString("pt-BR", {
                    month: "long",
                    year: "numeric",
                  });
                  return (
                    <option key={comp} value={comp}>
                      {monthName.charAt(0).toUpperCase() + monthName.slice(1)}
                    </option>
                  );
                })}
              </select>
              {isLoading && <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />}
            </div>
            <div className="text-slate-400 text-sm">
              {isLoading ? "Carregando dados..." : `Competência selecionada: ${selectedCompetencia}`}
            </div>
            {error && <div className="text-red-400 text-sm">Erro ao carregar dados</div>}
          </div>
        </CardContent>
      </Card>

      {criticalPanels.length > 0 && (
        <div className="space-y-2">
          {criticalPanels.map((panel) => (
            <Alert key={panel.id} className="bg-red-900/30 border-red-700/50">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <AlertDescription className="text-red-300">
                {panel.status === "critico" ? "🚨" : "⚠️"} {panel.nome}: {panel.descricao}
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-blue-900/30 border-blue-700/50">
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="text-blue-400 text-sm font-medium">Total de Painéis</div>
              <div className="text-4xl font-bold text-blue-300">{stats.total}</div>
              <div className="text-blue-600 text-xs">Acessórias monitoradas</div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-green-900/30 border-green-700/50">
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="text-green-400 text-sm font-medium">OK</div>
              <div className="text-4xl font-bold text-green-300">{stats.ok}</div>
              <div className="text-green-600 text-xs">
                {((stats.ok / stats.total) * 100).toFixed(0)}% operacional
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-yellow-900/30 border-yellow-700/50">
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="text-yellow-400 text-sm font-medium">Atenção</div>
              <div className="text-4xl font-bold text-yellow-300">{stats.atencao}</div>
              <div className="text-yellow-600 text-xs">Requer monitoramento</div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-red-900/30 border-red-700/50">
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="text-red-400 text-sm font-medium">Crítico</div>
              <div className="text-4xl font-bold text-red-300">{stats.critico}</div>
              <div className="text-red-600 text-xs">Ação urgente</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <PanelCard panel={displayData.sped} onClick={() => handlePanelClick("SPED")} />
        <PanelCard panel={displayData.reinf} onClick={() => handlePanelClick("REINF")} />
        <PanelCard panel={displayData.alvara} onClick={() => handlePanelClick("ALVARA")} />
        <PanelCard panel={displayData.contabil} onClick={() => handlePanelClick("CONTABIL")} />

        <PanelCard panel={displayData.mitDctf} onClick={() => handlePanelClick("MIT DCTF WEB")} />
        <PanelCard panel={displayData.parcelamentos} onClick={() => handlePanelClick("PARCELAMENTOS")} />
        <PanelCard panel={displayData.dasMesAtual} onClick={() => handlePanelClick("DAS MÊS ATUAL")} />
        <PanelCard panel={displayData.dasMesAnterior} onClick={() => handlePanelClick("DAS MÊS ANTERIOR")} />

        <PanelCard panel={displayData.demandaMesAtual} onClick={() => handlePanelClick("Demandas Mês atual")} />
        <PanelCard panel={displayData.fiscalIndicadores} onClick={() => handlePanelClick("Fiscal - INDICADORES")} />
        <PanelCard panel={displayData.pessoalInss} onClick={() => handlePanelClick("PESSOAL - INSS - FGTS")} />
        <div className="lg:col-span-4 md:col-span-2">
          <PanelCard panel={displayData.controleFiscal} onClick={() => handlePanelClick("Controle Departamento Fiscal")} />
        </div>
      </div>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Resumo de Status
          </CardTitle>
          <CardDescription className="text-slate-400">Visão geral dos painéis de Acessórias</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {stats.critico > 0 && (
              <div className="p-4 bg-red-900/20 border border-red-700/50 rounded-lg">
                <div className="text-red-400 font-semibold mb-1">🚨 Painéis Críticos: {stats.critico}</div>
                <div className="text-red-300 text-sm">
                  {allPanels
                    .filter((p: AccessoriesPanel) => p.status === "critico")
                    .map((p: AccessoriesPanel) => p.nome)
                    .join(", ")}
                </div>
              </div>
            )}

            {stats.atencao > 0 && (
              <div className="p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
                <div className="text-yellow-400 font-semibold mb-1">⚠️ Painéis em Atenção: {stats.atencao}</div>
                <div className="text-yellow-300 text-sm">
                  {allPanels
                    .filter((p: AccessoriesPanel) => p.status === "atencao")
                    .map((p: AccessoriesPanel) => p.nome)
                    .join(", ")}
                </div>
              </div>
            )}

            {stats.ok === stats.total && (
              <div className="p-4 bg-green-900/20 border border-green-700/50 rounded-lg">
                <div className="text-green-400 font-semibold">✓ Tudo em dia!</div>
                <div className="text-green-300 text-sm">Todos os painéis estão operacionais</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
