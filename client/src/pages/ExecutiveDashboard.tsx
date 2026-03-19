import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useLocation } from "wouter";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  DollarSign,
  AlertCircle,
  CheckCircle,
  CheckCircle2,
  Bot,
  Zap,
  Settings,
  RefreshCw,
  ChevronRight,
  Activity,
  MessageSquare,
  BarChart3,
  Shield,
  Calculator,
  FileDown,
  FileText,
  ExternalLink,
  Clock,
  Timer,
  CalendarClock,
  TriangleAlert,
  CloudDownload,
  CheckCircle as CheckCircleIcon,
  Network,
  ShieldCheck,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ─── Formatadores ─────────────────────────────────────────────────────────────

function fmtBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(v);
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  return phone;
}

// ─── Comparativo Badge ────────────────────────────────────────────────────────

interface ComparativoInfo {
  delta: number;
  pct: number;
  direction: string;
}

/**
 * Exibe seta + delta absoluto + delta % vs período anterior.
 * invertGood = true quando "subir" é ruim (ex: inadimplência)
 */
function ComparativoBadge({
  comp,
  format = "brl",
  invertGood = false,
}: {
  comp: ComparativoInfo | undefined;
  format?: "brl" | "pct" | "count";
  invertGood?: boolean;
}) {
  if (!comp || comp.direction === "flat") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> Estável vs período anterior
      </span>
    );
  }

  const isGood = invertGood ? comp.direction === "down" : comp.direction === "up";
  const colorClass = isGood ? "text-green-600" : "text-red-500";
  const Icon = comp.direction === "up" ? TrendingUp : TrendingDown;

  const deltaStr =
    format === "brl"
      ? fmtBRL(Math.abs(comp.delta))
      : format === "pct"
      ? `${Math.abs(comp.delta).toFixed(1)}pp`
      : Math.abs(comp.delta).toLocaleString("pt-BR");

  const sign = comp.direction === "up" ? "+" : "-";

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${colorClass}`}>
      <Icon className="h-3 w-3" />
      {sign}{deltaStr} ({sign}{Math.abs(comp.pct).toFixed(1)}%) vs período anterior
    </span>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ value, thresholds }: { value: number; thresholds: [number, number] }) {
  const [warn, crit] = thresholds;
  if (value <= warn) return <Badge className="bg-green-100 text-green-800 border-green-200">Saudável</Badge>;
  if (value <= crit) return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Atenção</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-200">Crítico</Badge>;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  badge,
  onClick,
  color = "default",
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  trend?: React.ReactNode;
  badge?: React.ReactNode;
  onClick?: () => void;
  color?: "default" | "green" | "red" | "blue" | "yellow";
}) {
  const colorMap = {
    default: "border-border",
    green: "border-green-200 bg-green-50/50",
    red: "border-red-200 bg-red-50/50",
    blue: "border-blue-200 bg-blue-50/50",
    yellow: "border-yellow-200 bg-yellow-50/50",
  };
  const iconColorMap = {
    default: "text-muted-foreground",
    green: "text-green-600",
    red: "text-red-500",
    blue: "text-blue-600",
    yellow: "text-yellow-600",
  };

  return (
    <Card
      className={`${colorMap[color]} ${onClick ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
      onClick={onClick}
    >
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground truncate">{title}</p>
            <p className="text-xl sm:text-2xl font-bold mt-1 text-foreground leading-tight">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
            {trend && <div className="mt-2">{trend}</div>}
          </div>
          <div className={`ml-2 mt-0.5 flex-shrink-0 ${iconColorMap[color]}`}>
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
        </div>
        {badge && <div className="mt-2">{badge}</div>}
        {onClick && (
          <div className="mt-2 flex items-center text-xs text-muted-foreground">
            <ChevronRight className="h-3 w-3 mr-0.5" /> Ver detalhes
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Period Selector ──────────────────────────────────────────────────────────

function PeriodSelector({ value, onChange, options }: {
  value: number;
  onChange: (v: number) => void;
  options: { label: string; value: number }[];
}) {
  return (
    <div className="flex gap-1 bg-muted rounded-lg p-1 flex-shrink-0">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-xs sm:text-sm rounded-md transition-colors ${
            value === opt.value
              ? "bg-background text-foreground shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

function exportPDF(exportData: any, days: number) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const now = new Date().toLocaleString("pt-BR");
  const periodLabel = days === 7 ? "7 dias" : days === 30 ? "30 dias" : `${days} dias`;

  // Cabeçalho
  doc.setFillColor(30, 58, 138);
  doc.rect(0, 0, 210, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Fraga Contabilidade", 14, 12);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Relatório Executivo de Cobrança", 14, 19);
  doc.text(`Gerado em: ${now}  |  Período: ${periodLabel}`, 14, 25);

  let y = 36;

  // KPIs
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Resumo Executivo", 14, y);
  y += 6;

  const kpis = exportData?.kpis;
  if (kpis) {
    autoTable(doc, {
      startY: y,
      head: [["KPI", "Valor"]],
      body: [
        ["Clientes Ativos", kpis.totalActive?.toLocaleString("pt-BR") ?? "—"],
        ["Valor Total em Aberto", fmtBRL(kpis.totalOpen ?? 0)],
        [`Recuperado (${periodLabel})`, fmtBRL(kpis.recovered ?? 0)],
        ["Taxa de Recuperação", fmtPct(kpis.recoveryRate ?? 0)],
      ],
      headStyles: { fillColor: [30, 58, 138] },
      alternateRowStyles: { fillColor: [245, 247, 255] },
      margin: { left: 14, right: 14 },
      styles: { fontSize: 9 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Faixas de atraso
  if (exportData?.faixas?.length > 0) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Distribuição por Faixa de Atraso", 14, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [["Faixa (dias)", "Títulos", "Valor Total", "% do Total"]],
      body: exportData.faixas.map((f: any) => {
        const totalFaixas = exportData.faixas.reduce((acc: number, x: any) => acc + x.total, 0);
        return [
          `${f.faixa} dias`,
          f.count,
          fmtBRL(f.total),
          totalFaixas > 0 ? `${((f.total / totalFaixas) * 100).toFixed(1)}%` : "—",
        ];
      }),
      headStyles: { fillColor: [30, 58, 138] },
      alternateRowStyles: { fillColor: [245, 247, 255] },
      margin: { left: 14, right: 14 },
      styles: { fontSize: 9 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Ranking top 20
  if (exportData?.ranking?.length > 0) {
    // Checar se precisa de nova página
    if (y > 220) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Ranking de Inadimplência (Top 20)", 14, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [["#", "Cliente", "Títulos", "Valor Total", "Atraso Máx."]],
      body: exportData.ranking.map((r: any, idx: number) => [
        idx + 1,
        r.name,
        r.titlesCount,
        fmtBRL(r.totalDebt),
        `${r.maxDaysOverdue}d`,
      ]),
      headStyles: { fillColor: [30, 58, 138] },
      alternateRowStyles: { fillColor: [245, 247, 255] },
      margin: { left: 14, right: 14 },
      styles: { fontSize: 8 },
    });
  }

  // Rodapé
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Fraga Contabilidade — Relatório Executivo — ${now} — Página ${i} de ${pageCount}`,
      14,
      290
    );
  }

  doc.save(`fraga-relatorio-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─── Aba Operacional ──────────────────────────────────────────────────────────

function AbaOperacional() {
  const [days, setDays] = useState(30);
  const [drillOpen, setDrillOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [, navigate] = useLocation();

  const { data, isLoading, refetch } = trpc.dashboard2.operacional.useQuery({ days });
  const { data: exportData } = trpc.dashboard2.exportData.useQuery({ days });

  const periodOptions = [
    { label: "7d", value: 7 },
    { label: "30d", value: 30 },
    { label: "90d", value: 90 },
  ];

  const handleExport = async () => {
    setExporting(true);
    try {
      exportPDF(exportData, days);
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-semibold">Visão Operacional</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">Carteira de cobrança e recuperação</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodSelector value={days} onChange={setDays} options={periodOptions} />
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8 text-xs">
            <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || !exportData} className="h-8 text-xs">
            <FileDown className="h-3 w-3 mr-1" /> {exporting ? "Gerando..." : "Exportar PDF"}
          </Button>
        </div>
      </div>

      {/* KPIs — linha 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard
          title="Clientes Ativos"
          value={data.totalActive.toLocaleString("pt-BR")}
          subtitle="Total na carteira"
          icon={Users}
          color="blue"
        />
        <KpiCard
          title="Em Inadimplência"
          value={data.clientsWithOpen.toLocaleString("pt-BR")}
          subtitle={`${((data.clientsWithOpen / Math.max(data.totalActive, 1)) * 100).toFixed(1)}% da carteira`}
          icon={AlertCircle}
          color={data.clientsWithOpen / Math.max(data.totalActive, 1) > 0.3 ? "red" : "yellow"}
          trend={<ComparativoBadge comp={data.comparativo?.clientsWithOpen} format="count" invertGood />}
          badge={<StatusBadge value={(data.clientsWithOpen / Math.max(data.totalActive, 1)) * 100} thresholds={[20, 35]} />}
        />
        <KpiCard
          title="Valor em Aberto"
          value={fmtBRL(data.totalOpen)}
          subtitle="Total inadimplente • clique para detalhar"
          icon={DollarSign}
          color="red"
          onClick={() => setDrillOpen(true)}
        />
      </div>
      {/* KPIs — linha 2: recuperação */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard
          title={`Recuperado via Régua (${days}d)`}
          value={fmtBRL((data as any).recoveredViaRegua ?? data.recovered)}
          subtitle="Pago após cobrança enviada"
          icon={TrendingUp}
          color="green"
          trend={<ComparativoBadge comp={data.comparativo?.recovered} format="brl" />}
        />
        <KpiCard
          title={`Pagamentos Totais (${days}d)`}
          value={fmtBRL((data as any).totalPaid ?? 0)}
          subtitle="Todos os pagamentos do período"
          icon={CheckCircle2}
          color="blue"
        />
        <KpiCard
          title="Taxa de Recuperação"
          value={fmtPct(data.recoveryRate)}
          subtitle="Recuperado via régua / total vencido"
          icon={TrendingUp}
          color={data.recoveryRate > 30 ? "green" : data.recoveryRate > 10 ? "yellow" : "red"}
          badge={<StatusBadge value={data.recoveryRate} thresholds={[10, 30]} />}
        />
      </div>

      {/* Ranking */}
      <Card>
        <CardHeader className="pb-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm sm:text-base">Ranking de Inadimplência</CardTitle>
            <Badge variant="outline" className="text-xs">{data.ranking.length} clientes</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-8 text-xs">#</TableHead>
                  <TableHead className="text-xs">Cliente</TableHead>
                  <TableHead className="text-right text-xs hidden sm:table-cell">Títulos</TableHead>
                  <TableHead className="text-right text-xs">Valor Total</TableHead>
                  <TableHead className="text-right text-xs hidden sm:table-cell">Atraso Máx.</TableHead>
                  <TableHead className="text-xs hidden lg:table-cell">Estágio</TableHead>
                  <TableHead className="text-xs hidden xl:table-cell">Próx. Disparo</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.ranking.map((client, idx) => (
                  <TableRow key={client.id} className="hover:bg-muted/30">
                    <TableCell className="text-muted-foreground text-xs font-medium">{idx + 1}</TableCell>
                    <TableCell>
                      <div>
                        <button
                          className="font-medium text-xs sm:text-sm text-left hover:text-blue-600 hover:underline flex items-center gap-1"
                          onClick={() => navigate(`/cliente/${client.id}`)}
                        >
                          {client.name}
                          <ExternalLink className="h-3 w-3 opacity-50" />
                        </button>
                        {client.whatsappNumber && (
                          <p className="text-xs text-muted-foreground hidden sm:block">{fmtPhone(client.whatsappNumber)}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs hidden sm:table-cell">{client.titlesCount}</TableCell>
                    <TableCell className="text-right font-semibold text-xs sm:text-sm">{fmtBRL(client.totalDebt)}</TableCell>
                    <TableCell className="text-right text-xs hidden sm:table-cell">{client.maxDaysOverdue}d</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {(client as any).reguaStage ? (
                        <Badge variant="secondary" className="text-xs">{(client as any).reguaStage}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {(client as any).nextDispatchAt ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {client.maxDaysOverdue > 30 ? (
                        <Badge className="bg-red-100 text-red-800 border-red-200 text-xs">Crítico</Badge>
                      ) : client.maxDaysOverdue > 15 ? (
                        <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-xs">Alto</Badge>
                      ) : client.maxDaysOverdue > 7 ? (
                        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-xs">Médio</Badge>
                      ) : (
                        <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">Baixo</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Drill-down Dialog */}
      <Dialog open={drillOpen} onOpenChange={setDrillOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhe — Valor em Aberto ({fmtBRL(data.totalOpen)})</DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Títulos</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Atraso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.ranking.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm font-medium">{c.name}</TableCell>
                    <TableCell className="text-right text-sm">{c.titlesCount}</TableCell>
                    <TableCell className="text-right text-sm font-semibold">{fmtBRL(c.totalDebt)}</TableCell>
                    <TableCell className="text-right text-sm">{c.maxDaysOverdue}d</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Aba Financeiro ───────────────────────────────────────────────────────────

const FAIXA_COLORS: Record<string, string> = {
  "0-7": "#22c55e",
  "8-15": "#eab308",
  "16-30": "#f97316",
  "30+": "#ef4444",
};

function AbaFinanceiro() {
  const [months, setMonths] = useState(6);
  const [selectedFaixa, setSelectedFaixa] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const { data, isLoading, refetch } = trpc.dashboard2.financeiro.useQuery({ months });
  const { data: drillData, isLoading: drillLoading } = trpc.dashboard2.drillDownFaixa.useQuery(
    { faixa: selectedFaixa as "0-7" | "8-15" | "16-30" | "30+" },
    { enabled: !!selectedFaixa }
  );

  const periodOptions = [
    { label: "3m", value: 3 },
    { label: "6m", value: 6 },
    { label: "12m", value: 12 },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const allMonths = Array.from(
    new Set([...data.delinquencyByMonth.map(r => r.month), ...data.paidByMonth.map(r => r.month)])
  ).sort();

  const evolutionData = allMonths.map(month => {
    const delinq = data.delinquencyByMonth.find(r => r.month === month);
    const paid = data.paidByMonth.find(r => r.month === month);
    return {
      month: month.slice(5),
      inadimplente: delinq?.total ?? 0,
      recuperado: paid?.total ?? 0,
    };
  });

  const totalFaixas = data.faixas.reduce((acc, f) => acc + f.total, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-semibold">Visão Financeira</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">Evolução de inadimplência e recuperação</p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodSelector value={months} onChange={setMonths} options={periodOptions} />
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8 text-xs">
            <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard
          title="Ticket Médio"
          value={fmtBRL(data.ticketMedio)}
          subtitle="Por título em aberto"
          icon={BarChart3}
          color="blue"
          trend={<ComparativoBadge comp={data.comparativo?.ticketMedio} format="brl" invertGood />}
        />
        <KpiCard
          title="Títulos em Aberto"
          value={data.drillDown.length.toLocaleString("pt-BR")}
          subtitle="Com vencimento passado"
          icon={AlertCircle}
          color="yellow"
        />
        <KpiCard
          title="Total Inadimplente"
          value={fmtBRL(totalFaixas)}
          subtitle="Soma por faixa de atraso"
          icon={DollarSign}
          color="red"
        />
      </div>

      {/* Gráfico de Evolução */}
      <Card>
        <CardHeader className="pb-3 px-4">
          <CardTitle className="text-sm sm:text-base">Evolução Mensal — Inadimplência vs Recuperação</CardTitle>
        </CardHeader>
        <CardContent className="px-2 sm:px-4">
          {evolutionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={evolutionData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} width={50} />
                <Tooltip formatter={(v: number) => fmtBRL(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="inadimplente" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="Inadimplente" />
                <Line type="monotone" dataKey="recuperado" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="Recuperado" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              Sem dados para o período selecionado
            </div>
          )}
        </CardContent>
      </Card>

      {/* Distribuição por Faixa */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3 px-4">
            <CardTitle className="text-sm sm:text-base">Distribuição por Faixa de Atraso</CardTitle>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            {data.faixas.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.faixas} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="faixa" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} width={50} />
                  <Tooltip formatter={(v: number) => fmtBRL(v)} />
                  <Bar dataKey="total" name="Valor" radius={[4, 4, 0, 0]}>
                    {data.faixas.map((entry) => (
                      <Cell key={entry.faixa} fill={FAIXA_COLORS[entry.faixa] ?? "#6b7280"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Sem dados de inadimplência
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 px-4">
            <CardTitle className="text-sm sm:text-base">Faixas — Clique para Detalhar</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="space-y-2">
              {data.faixas.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Sem dados de inadimplência</p>
              ) : (
                data.faixas.map(f => (
                  <button
                    key={f.faixa}
                    onClick={() => setSelectedFaixa(f.faixa)}
                    className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: FAIXA_COLORS[f.faixa] ?? "#6b7280" }} />
                      <div>
                        <p className="text-xs sm:text-sm font-medium">{f.faixa} dias de atraso</p>
                        <p className="text-xs text-muted-foreground">{f.count} título{f.count !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs sm:text-sm font-semibold">{fmtBRL(f.total)}</p>
                      <p className="text-xs text-muted-foreground">
                        {totalFaixas > 0 ? ((f.total / totalFaixas) * 100).toFixed(1) : 0}%
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Drill-down Dialog */}
      <Dialog open={!!selectedFaixa} onOpenChange={() => setSelectedFaixa(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Títulos — Faixa {selectedFaixa} dias de atraso</DialogTitle>
              {drillData && drillData.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => {
                    const csv = [
                      ["Cliente","Valor","Vencimento","Atraso (dias)","Status"].join(","),
                      ...(drillData ?? []).map(r => [
                        `"${r.name}"`,
                        r.amount,
                        r.dueDate ? new Date(r.dueDate).toLocaleDateString("pt-BR") : "",
                        r.daysOverdue,
                        r.status,
                      ].join(","))
                    ].join("\n");
                    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = `faixa_${selectedFaixa}d.csv`; a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <FileDown className="h-3 w-3 mr-1" /> CSV
                </Button>
              )}
            </div>
          </DialogHeader>
          {drillLoading ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Vencimento</TableHead>
                    <TableHead className="text-right">Atraso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(drillData ?? []).map((r, idx) => (
                    <TableRow key={`${r.id}-${idx}`}>
                      <TableCell>
                        <button
                          className="text-sm font-medium text-left hover:text-blue-600 hover:underline flex items-center gap-1"
                          onClick={() => { setSelectedFaixa(null); navigate(`/cliente/${r.id}`); }}
                        >
                          {r.name} <ExternalLink className="h-3 w-3 opacity-50" />
                        </button>
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">{fmtBRL(r.amount)}</TableCell>
                      <TableCell className="text-right text-sm">
                        {r.dueDate ? new Date(r.dueDate).toLocaleDateString("pt-BR") : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm">{r.daysOverdue}d</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Aba IA & Automação ───────────────────────────────────────────────────────

const INTENT_LABELS: Record<string, string> = {
  saldo: "Consulta de Saldo",
  link: "Link de Pagamento",
  negociar: "Negociação",
  ja_paguei: "Já Paguei",
  humano: "Falar com Humano",
  desconhecido: "Não Identificado",
  SKIPPED_HUMAN_ASSIGNED: "Humano Ativo",
  SKIPPED_NON_FINANCIAL_INTENT: "Intent Não-Financeiro",
  SKIPPED_FLAG_OFF: "IA Desligada",
  SKIPPED_NOT_WHITELIST: "Fora da Whitelist",
  AI_RAN: "IA Respondeu",
  ERROR: "Erro",
};

const INTENT_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899",
  "#14b8a6", "#f97316", "#6b7280", "#ef4444", "#84cc16",
];

function AbaIAAutomacao() {
  const [days, setDays] = useState(7);
  const [logFilter, setLogFilter] = useState<string>("all");
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  const { data, isLoading, refetch } = trpc.dashboard2.iaAutomacao.useQuery({ days });

  const periodOptions = [
    { label: "7d", value: 7 },
    { label: "30d", value: 30 },
    { label: "90d", value: 90 },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const filteredLogs = data.logs.filter(log => {
    if (logFilter === "all") return true;
    if (logFilter === "handoff") return log.handoffToHuman;
    if (logFilter === "ai") return !log.handoffToHuman;
    return log.intent === logFilter;
  });

  const intentData = data.intents.map(i => ({
    name: INTENT_LABELS[i.intent] ?? i.intent,
    value: i.count,
  }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-semibold">IA & Automação</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">Performance da IA de cobrança inbound e régua outbound</p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodSelector value={days} onChange={setDays} options={periodOptions} />
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8 text-xs">
            <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          title="Processadas Hoje"
          value={data.processedToday.toLocaleString("pt-BR")}
          subtitle="Mensagens inbound"
          icon={MessageSquare}
          color="blue"
        />
        <KpiCard
          title={`Total (${days}d)`}
          value={data.period.total.toLocaleString("pt-BR")}
          subtitle="Interações no período"
          icon={Activity}
          color="default"
          trend={<ComparativoBadge comp={data.comparativo?.total} format="count" />}
        />
        <KpiCard
          title="Resolvidas pela IA"
          value={fmtPct(data.period.resolvedByAI)}
          subtitle={`${data.period.responded} de ${data.period.total}`}
          icon={Bot}
          color="green"
          trend={<ComparativoBadge comp={data.comparativo?.resolvedByAI} format="pct" />}
          badge={<StatusBadge value={100 - data.period.resolvedByAI} thresholds={[30, 60]} />}
        />
        <KpiCard
          title="Transferidas"
          value={fmtPct(data.period.transferredPct)}
          subtitle={`${data.period.transferredToHuman} handoffs`}
          icon={Users}
          color={data.period.transferredPct > 30 ? "yellow" : "default"}
        />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3 px-4">
            <CardTitle className="text-sm sm:text-base">Evolução Diária (7d)</CardTitle>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            {data.daily.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.daily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="responded" name="Respondida IA" fill="#22c55e" radius={[3, 3, 0, 0]} stackId="a" />
                  <Bar dataKey="handoff" name="Transferida" fill="#f97316" radius={[3, 3, 0, 0]} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Sem dados no período
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 px-4">
            <CardTitle className="text-sm sm:text-base">Intents Detectados</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            {intentData.length > 0 ? (
              <div className="flex items-center gap-3">
                <ResponsiveContainer width="45%" height={160}>
                  <PieChart>
                    <Pie data={intentData} cx="50%" cy="50%" outerRadius={60} dataKey="value">
                      {intentData.map((_, idx) => (
                        <Cell key={idx} fill={INTENT_COLORS[idx % INTENT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => [`${v} msgs`, ""]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {intentData.slice(0, 6).map((item, idx) => (
                    <div key={item.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: INTENT_COLORS[idx % INTENT_COLORS.length] }} />
                        <span className="truncate text-muted-foreground">{item.name}</span>
                      </div>
                      <span className="font-medium ml-1 flex-shrink-0">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Sem dados de intents
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Logs */}
      <Card>
        <CardHeader className="pb-3 px-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm sm:text-base">Log de Interações</CardTitle>
            <div className="flex gap-1 bg-muted rounded-lg p-1">
              {[
                { label: "Todos", value: "all" },
                { label: "IA", value: "ai" },
                { label: "Handoff", value: "handoff" },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setLogFilter(opt.value)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    logFilter === opt.value
                      ? "bg-background text-foreground shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs">Data/Hora</TableHead>
                  <TableHead className="text-xs">Cliente</TableHead>
                  <TableHead className="text-xs hidden sm:table-cell">Intent</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs hidden md:table-cell">Resposta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-sm">
                      Sem registros no período
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.map(log => (
                    <TableRow
                      key={log.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setSelectedLog(log)}
                    >
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(log.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>
                          <p className="font-medium">{log.clientName ?? "Desconhecido"}</p>
                          <p className="text-xs text-muted-foreground hidden sm:block">{fmtPhone(log.fromPhone)}</p>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline" className="text-xs">
                          {INTENT_LABELS[log.intent] ?? log.intent}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {log.handoffToHuman ? (
                          <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-xs">Handoff</Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">IA</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate hidden md:table-cell">
                        {log.response?.slice(0, 80)}…
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Log Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhe da Interação</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Data/Hora</p>
                  <p className="font-medium">{fmtDate(selectedLog.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-medium">{selectedLog.clientName ?? "Desconhecido"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Telefone</p>
                  <p className="font-medium">{fmtPhone(selectedLog.fromPhone)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Intent</p>
                  <p className="font-medium">{INTENT_LABELS[selectedLog.intent] ?? selectedLog.intent}</p>
                </div>
              </div>
              {selectedLog.handoffToHuman && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <p className="text-xs font-medium text-orange-800">Motivo do Handoff</p>
                  <p className="text-orange-700 mt-1">{selectedLog.handoffReason ?? "Não especificado"}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Resposta Enviada</p>
                <div className="p-3 bg-muted rounded-lg text-sm whitespace-pre-wrap">
                  {selectedLog.response}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Card de Agendamento do Sync Conta Azul ────────────────────────────────────

function SyncScheduleCard() {
  const { data, isLoading, refetch } = trpc.syncSchedule.status.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const runNow = trpc.syncSchedule.runNow.useMutation({
    onSuccess: () => refetch(),
  });

  const [countdown, setCountdown] = useState("");
  useEffect(() => {
    if (!data?.nextRunAt) return;
    const tick = () => {
      const diff = new Date(data.nextRunAt).getTime() - Date.now();
      if (diff <= 0) { setCountdown("Agora"); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setCountdown(`${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [data?.nextRunAt]);

  const fmtSP = (d: Date | string | null | undefined) => {
    if (!d) return "—";
    return new Date(d).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  if (isLoading) return (
    <Card className="border-slate-200">
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <RefreshCw className="h-4 w-4 animate-spin" /> Carregando sync...
        </div>
      </CardContent>
    </Card>
  );

  if (!data) return null;

  const statusColor = data.lastStatus === "success"
    ? "text-green-700 bg-green-50 border-green-200"
    : data.lastStatus === "failed"
    ? "text-red-700 bg-red-50 border-red-200"
    : "text-slate-600 bg-slate-50 border-slate-200";

  return (
    <div className="space-y-3">
      {/* Alerta de atraso */}
      {data.isLate && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800">
          <TriangleAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <span className="font-semibold">Alerta: </span>
            Sync atrasado — passou 15 min do horário previsto sem execução registrada.
          </div>
        </div>
      )}

      <Card className={data.isLate ? "border-red-200" : "border-slate-200"}>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-indigo-600" />
            Sync Conta Azul
            <Badge variant="outline" className={`ml-auto text-xs ${data.schedulerActive ? "border-green-300 text-green-700 bg-green-50" : "border-red-300 text-red-700 bg-red-50"}`}>
              {data.schedulerActive ? "Ativo" : "Inativo"}
            </Badge>
            {data.isSyncRunning && (
              <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 bg-blue-50">
                <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Rodando
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Próxima execução */}
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Timer className="h-4 w-4 text-indigo-600" />
                <span className="text-xs font-semibold text-indigo-800">Próxima Execução</span>
              </div>
              <p className="text-sm font-bold text-indigo-900">{fmtSP(data.nextRunAt)}</p>
              <p className="text-xs text-indigo-600 mt-1">{data.cronExpr} ({data.timezone})</p>
              {countdown && (
                <p className="text-xs font-mono text-indigo-700 mt-1 bg-indigo-100 rounded px-2 py-0.5 inline-block">
                  ⏱ {countdown}
                </p>
              )}
            </div>

            {/* Última execução */}
            <div className={`rounded-lg p-3 border ${data.lastStatus === "success" ? "bg-green-50 border-green-100" : data.lastStatus === "failed" ? "bg-red-50 border-red-100" : "bg-slate-50 border-slate-100"}`}>
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-slate-600" />
                <span className="text-xs font-semibold text-slate-700">Última Tentativa</span>
              </div>
              {data.lastAttemptAt ? (
                <>
                  <p className="text-sm font-bold text-slate-800">{fmtSP(data.lastAttemptAt)}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className={`text-xs ${statusColor}`}>
                      {data.lastStatus === "success" ? "✅ Sucesso" : data.lastStatus === "failed" ? "❌ Falha" : data.lastStatus ?? "—"}
                    </Badge>
                  </div>
                  {data.lastResult && (
                    <p className="text-xs text-slate-500 mt-1">
                      {(data.lastResult as any).clientsSynced ?? 0} clientes, {(data.lastResult as any).receivablesSynced ?? 0} recebíveis
                    </p>
                  )}
                  {data.lastError && (
                    <p className="text-xs text-red-600 mt-1 truncate" title={data.lastError}>
                      Erro: {data.lastError}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-500">Nenhuma execução registrada</p>
              )}
            </div>
          </div>

          {/* Botão de sync manual */}
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => runNow.mutate()}
              disabled={runNow.isPending || data.isSyncRunning}
              className="text-xs"
            >
              {runNow.isPending ? (
                <><RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Sincronizando...</>
              ) : (
                <><RefreshCw className="h-3 w-3 mr-1" /> Sync Manual</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Card de Agendamento da Régua ───────────────────────────────────────────────

function ReguaScheduleCard() {
  const { data, isLoading, refetch } = trpc.regua.scheduleStatus.useQuery(undefined, {
    refetchInterval: 60_000, // atualiza a cada 1 min
  });

  // Countdown até a próxima execução
  const [countdown, setCountdown] = useState("");
  useEffect(() => {
    if (!data?.nextRunAt) return;
    const tick = () => {
      const diff = new Date(data.nextRunAt).getTime() - Date.now();
      if (diff <= 0) { setCountdown("Agora"); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setCountdown(`${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [data?.nextRunAt]);

  if (isLoading) return (
    <Card className="border-slate-200">
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <RefreshCw className="h-4 w-4 animate-spin" /> Carregando agendamento...
        </div>
      </CardContent>
    </Card>
  );

  if (!data) return null;

  const lastRun = data.lastRun;
  const topReason = data.topReasons[0];

  // Detectar: régua rodou mas não enviou nada nos últimos 3 dias
  const recentRuns = data.history.slice(0, 7); // últimas 7 execuções
  const allZeroSent = recentRuns.length > 0 && recentRuns.every(r => r.sent === 0);
  const lastSentRun = data.history.find(r => r.sent > 0);
  const daysSinceLastSent = lastSentRun
    ? Math.floor((Date.now() - new Date(lastSentRun.finishedAt).getTime()) / 86_400_000)
    : null;
  const stuckAlert = allZeroSent && recentRuns.length >= 3;

  // Classificar motivos de bloqueio
  const stageNotAllowedCount = data.topReasons.find(r => r.reason === 'STAGE_NOT_ALLOWED')?.count ?? 0;
  const dedupCount = data.topReasons.find(r => r.reason === 'DEDUP')?.count ?? 0;

  // Formatar data/hora no fuso SP
  const fmtSP = (iso: string | null | undefined) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <div className="space-y-3">
      {/* Alerta de atraso */}
      {data.lateAlert && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800">
          <TriangleAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <span className="font-semibold">Alerta: </span>
            Passou 15 min do horário previsto (07:30) sem execução registrada hoje.
          </div>
        </div>
      )}

      {/* Alerta: régua rodou mas não enviou nada */}
      {stuckAlert && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-50 border border-orange-300 text-orange-900">
          <TriangleAlert className="h-4 w-4 mt-0.5 flex-shrink-0 text-orange-500" />
          <div className="text-xs space-y-1">
            <p className="font-semibold text-orange-800">
              ⚠️ Régua rodou {recentRuns.length}x seguidas sem enviar nenhuma mensagem
              {daysSinceLastSent !== null ? ` — último envio há ${daysSinceLastSent} dia(s)` : " — nenhum envio registrado"}
            </p>
            {stageNotAllowedCount > 0 && (
              <p className="text-orange-700">
                🔒 <strong>{stageNotAllowedCount} clientes</strong> bloqueados por <code className="bg-orange-100 px-1 rounded">STAGE_NOT_ALLOWED</code> — os stages deles não estão em <code className="bg-orange-100 px-1 rounded">REGUA_ALLOWED_STAGES</code>
              </p>
            )}
            {dedupCount > 0 && (
              <p className="text-orange-700">
                🔄 <strong>{dedupCount} clientes</strong> bloqueados por <code className="bg-orange-100 px-1 rounded">DEDUP</code> — já receberam mensagem recentemente
              </p>
            )}
            <p className="text-orange-600 font-medium">
              → Ação corretiva: adicione <code className="bg-orange-100 px-1 rounded">d_plus_30,d_plus_60,d_plus_90</code> em <code className="bg-orange-100 px-1 rounded">REGUA_ALLOWED_STAGES</code> para reativar os envios.
            </p>
          </div>
        </div>
      )}

      {/* Card principal */}
      <Card className={data.lateAlert ? "border-red-200" : "border-slate-200"}>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-blue-600" />
            Agendamento da Régua de Cobrança
            <Badge variant="outline" className={`ml-auto text-xs ${data.enabled ? "border-green-300 text-green-700 bg-green-50" : "border-red-300 text-red-700 bg-red-50"}`}>
              {data.enabled ? "Habilitada" : "Desabilitada"}
            </Badge>
            {!data.allowRealSend && (
              <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700 bg-yellow-50">Dry-run</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {/* Próxima + Última execução */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Próxima execução */}
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Timer className="h-4 w-4 text-blue-600" />
                <span className="text-xs font-semibold text-blue-800">Próxima Execução</span>
              </div>
              <p className="text-sm font-bold text-blue-900">{fmtSP(data.nextRunAt)}</p>
              <p className="text-xs text-blue-600 mt-1">{data.cronDescription}</p>
              {countdown && (
                <p className="text-xs font-mono text-blue-700 mt-1 bg-blue-100 rounded px-2 py-0.5 inline-block">
                  ⏱ {countdown}
                </p>
              )}
            </div>

            {/* Última execução */}
            <div className={`rounded-lg p-3 border ${
              lastRun?.sent && lastRun.sent > 0
                ? "bg-green-50 border-green-100"
                : "bg-slate-50 border-slate-100"
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-slate-600" />
                <span className="text-xs font-semibold text-slate-700">Última Execução</span>
              </div>
              {lastRun ? (
                <>
                  <p className="text-sm font-bold text-slate-800">{fmtSP(lastRun.finishedAt)}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="text-xs bg-slate-100 rounded px-2 py-0.5">
                      <span className="font-semibold">{lastRun.total}</span> processados
                    </span>
                    <span className="text-xs bg-green-100 text-green-800 rounded px-2 py-0.5">
                      <span className="font-semibold">{lastRun.sent}</span> enviados
                    </span>
                    <span className="text-xs bg-yellow-100 text-yellow-800 rounded px-2 py-0.5">
                      <span className="font-semibold">{lastRun.skipped}</span> pulados
                    </span>
                    {lastRun.errors > 0 && (
                      <span className="text-xs bg-red-100 text-red-800 rounded px-2 py-0.5">
                        <span className="font-semibold">{lastRun.errors}</span> erros
                      </span>
                    )}
                  </div>
                  {topReason && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Top motivo: <span className="font-mono font-semibold">{topReason.reason}</span> ({topReason.count}x)
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma execução registrada</p>
              )}
            </div>
          </div>

          {/* Histórico das últimas 10 execuções */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Histórico (últimas 10 execuções)</h4>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs py-1.5">Data/Hora (SP)</TableHead>
                    <TableHead className="text-right text-xs py-1.5">Total</TableHead>
                    <TableHead className="text-right text-xs py-1.5">Enviados</TableHead>
                    <TableHead className="text-right text-xs py-1.5">Pulados</TableHead>
                    <TableHead className="text-right text-xs py-1.5">Erros</TableHead>
                    <TableHead className="text-xs py-1.5 hidden sm:table-cell">Run ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.history.map((run, i) => (
                    <TableRow key={run.runId} className={i === 0 ? "bg-blue-50/50" : ""}>
                      <TableCell className="text-xs py-1.5 font-medium">{fmtSP(run.finishedAt)}</TableCell>
                      <TableCell className="text-right text-xs py-1.5">{run.total}</TableCell>
                      <TableCell className="text-right text-xs py-1.5">
                        <span className={run.sent > 0 ? "text-green-700 font-semibold" : "text-muted-foreground"}>
                          {run.sent}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs py-1.5 text-yellow-700">{run.skipped}</TableCell>
                      <TableCell className="text-right text-xs py-1.5">
                        <span className={run.errors > 0 ? "text-red-600 font-semibold" : "text-muted-foreground"}>
                          {run.errors}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs py-1.5 text-muted-foreground font-mono hidden sm:table-cell">
                        {run.runId.slice(-12)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.history.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">
                        Nenhuma execução registrada ainda.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="h-7 text-xs gap-1">
              <RefreshCw className="h-3 w-3" /> Atualizar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Automation Health Panel ────────────────────────────────────────────────────────────

interface AutomationHealthData {
  timestamp: string;
  overall: 'healthy' | 'degraded' | 'critical';
  checks: {
    oauth: {
      status: string;
      hasToken: boolean;
      expiresInMinutes: number | null;
      needsReauth: boolean;
      consecutiveFailures: number;
      lastRefreshAt: string | null;
      lastRefreshStatus: string | null;
    };
    refreshCron: {
      status: string;
      running: boolean;
    };
    reguaConfig: {
      status: string;
      allowedStages: string[];
      totalStages: number;
      missingCritical: string[];
    };
    sync: {
      status: string;
      lastSyncAt: string | null;
      minutesSinceLastSync: number | null;
    };
  };
  alerts: string[];
  recommendations: string[];
}

function AutomationHealthPanel() {
  const [health, setHealth] = useState<AutomationHealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/automation-health');
      const data = await res.json();
      setHealth(data);
    } catch (e) {
      setError('Falha ao carregar saúde da automação');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 60000); // Atualiza a cada 60s
    return () => clearInterval(interval);
  }, []);

  if (!health && !loading && !error) return null;

  const statusColors = {
    healthy: 'border-green-300 bg-green-50/80',
    degraded: 'border-yellow-300 bg-yellow-50/80',
    critical: 'border-red-300 bg-red-50/80',
  };

  const statusIcons = {
    healthy: <CheckCircle className="h-5 w-5 text-green-600" />,
    degraded: <TriangleAlert className="h-5 w-5 text-yellow-600" />,
    critical: <AlertCircle className="h-5 w-5 text-red-600" />,
  };

  const statusLabels = {
    healthy: 'Saudável',
    degraded: 'Degradado',
    critical: 'Crítico',
  };

  const checkStatusDot = (status: string) => {
    const colors: Record<string, string> = {
      ok: 'bg-green-500',
      warning: 'bg-yellow-500',
      critical: 'bg-red-500',
      unknown: 'bg-gray-400',
    };
    return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || 'bg-gray-400'}`} />;
  };

  return (
    <Card className={`${health ? statusColors[health.overall] : 'border-gray-200'}`}>
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Saúde da Automação</span>
            {health && (
              <Badge className={`text-xs ${
                health.overall === 'healthy' ? 'bg-green-100 text-green-800 border-green-200' :
                health.overall === 'degraded' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' :
                'bg-red-100 text-red-800 border-red-200'
              }`}>
                {statusIcons[health.overall]}
                <span className="ml-1">{statusLabels[health.overall]}</span>
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={fetchHealth} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Verificando...' : 'Verificar'}
          </Button>
        </div>

        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

        {health && (
          <>
            {/* Checks grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div className="flex items-center gap-1.5">
                {checkStatusDot(health.checks.oauth.status)}
                <div>
                  <p className="text-xs font-medium">OAuth</p>
                  <p className="text-xs text-muted-foreground">
                    {health.checks.oauth.needsReauth ? 'Reauth necessário' :
                     health.checks.oauth.expiresInMinutes !== null ? `${health.checks.oauth.expiresInMinutes}min` : 'Sem token'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {checkStatusDot(health.checks.refreshCron.status)}
                <div>
                  <p className="text-xs font-medium">Refresh Cron</p>
                  <p className="text-xs text-muted-foreground">
                    {health.checks.refreshCron.running ? 'Rodando' : 'Parado'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {checkStatusDot(health.checks.reguaConfig.status)}
                <div>
                  <p className="text-xs font-medium">Régua</p>
                  <p className="text-xs text-muted-foreground">
                    {health.checks.reguaConfig.totalStages} estágios
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {checkStatusDot(health.checks.sync.status)}
                <div>
                  <p className="text-xs font-medium">Sync</p>
                  <p className="text-xs text-muted-foreground">
                    {health.checks.sync.minutesSinceLastSync !== null
                      ? `${Math.round(health.checks.sync.minutesSinceLastSync / 60)}h atrás`
                      : 'Desconhecido'}
                  </p>
                </div>
              </div>
            </div>

            {/* Alerts */}
            {health.alerts.length > 0 && (
              <div className="space-y-1">
                {health.alerts.map((alert, i) => (
                  <div key={i} className={`text-xs px-2 py-1 rounded ${
                    alert.startsWith('CRITICAL') ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {alert}
                  </div>
                ))}
              </div>
            )}

            {/* Recommendations */}
            {health.recommendations.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {health.recommendations.map((rec, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    → {rec}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Aba Técnico ──────────────────────────────────────────────────────────────────────────────

function AbaTecnico() {
  const { data, isLoading, refetch } = trpc.dashboard2.tecnico.useQuery();
  const [simOpen, setSimOpen] = useState(false);
  const [simEnabled, setSimEnabled] = useState(false);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Full Sync Conta Azul
  const [syncResult, setSyncResult] = useState<{ imported: number; updated: number; errors: number } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const fullSyncMutation = trpc.dashboard2.fullSync.useMutation({
    onSuccess: (data) => {
      setSyncResult({ imported: data.imported, updated: data.updated, errors: data.errors });
      setSyncError(null);
    },
    onError: (err) => {
      setSyncError(err.message || 'Erro ao executar sync');
      setSyncResult(null);
    },
  });

  function handleFullSync() {
    setSyncResult(null);
    setSyncError(null);
    fullSyncMutation.mutate({ days: 180 });
  }

  async function handleReconectarOAuth() {
    setOauthLoading(true);
    setOauthError(null);
    setOauthUrl(null);
    try {
      // Cada clique gera um novo link OAuth com state único
      const res = await fetch('/api/oauth/conta-azul/auth-url');
      const json = await res.json();
      if (json.success && json.authorizeUrl) {
        setOauthUrl(json.authorizeUrl);
        // Tentar abrir em nova aba (pode ser bloqueado por popup blocker)
        const newWindow = window.open(json.authorizeUrl, '_blank', 'noopener,noreferrer');
        if (!newWindow) {
          // Se popup bloqueado, redirecionar na mesma aba
          setOauthError('Popup bloqueado. Use o link abaixo ou clique novamente.');
        }
      } else {
        setOauthError(json.error || 'Falha ao gerar URL de autorização');
      }
    } catch (e) {
      setOauthError('Erro de rede ao gerar URL OAuth');
    } finally {
      setOauthLoading(false);
    }
  }
  const simQuery = trpc.regua.preview.useQuery(
    { limit: 100 },
    {
      enabled: simEnabled,
      onSuccess: () => setSimOpen(true),
    } as any
  );

  function runSimulacao() {
    if (simEnabled) {
      simQuery.refetch().then(() => setSimOpen(true));
    } else {
      setSimEnabled(true);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const envItems = Object.entries(data.envStatus).map(([key, value]) => {
    const isEnabled = value === "true" || value === "*";
    const isDisabled = value === "false" || value === "não definido";
    return { key, value, isEnabled, isDisabled };
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-semibold">Painel Técnico</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">Status de integrações, jobs e variáveis de ambiente</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={runSimulacao}
            disabled={simQuery.isFetching}
            className="h-8 text-xs gap-1 border-purple-300 text-purple-700 hover:bg-purple-50"
          >
            {simQuery.isFetching ? (
              <><RefreshCw className="h-3 w-3 animate-spin" /> Simulando...</>
            ) : (
              <><Zap className="h-3 w-3" /> Executar Simulação</>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFullSync}
            disabled={fullSyncMutation.isPending}
            className="h-8 text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            {fullSyncMutation.isPending ? (
              <><RefreshCw className="h-3 w-3 animate-spin" /> Sincronizando...</>
            ) : (
              <><CloudDownload className="h-3 w-3" /> Sincronizar CA</>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8 text-xs">
            <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
          </Button>
        </div>
      </div>

      {/* Feedback do Full Sync */}
      {syncResult && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-50 border border-green-200 text-xs text-green-800">
          <CheckCircleIcon className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            Sync concluído: <strong>{syncResult.imported} importados</strong>, <strong>{syncResult.updated} atualizados</strong>
            {syncResult.errors > 0 && <span className="text-orange-600"> · {syncResult.errors} erros</span>}
          </span>
          <button onClick={() => setSyncResult(null)} className="ml-auto text-green-600 hover:text-green-800">&times;</button>
        </div>
      )}
      {syncError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-800">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Erro no sync: {syncError}</span>
          <button onClick={() => setSyncError(null)} className="ml-auto text-red-600 hover:text-red-800">&times;</button>
        </div>
      )}

      {/* Modal de Simulação da Régua */}
      <Dialog open={simOpen} onOpenChange={setSimOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-purple-600" />
              Simulação da Régua (Dry-run)
            </DialogTitle>
          </DialogHeader>
          {simQuery.data && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-medium">{simQuery.data.totalCandidates} candidatos encontrados</span>
                <Badge className="bg-green-100 text-green-800 border-green-200">
                  {simQuery.data.candidates.length} seriam cobrados
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs ml-auto"
                  onClick={() => {
                    const rows = [
                      ["Cliente", "Telefone", "Estágio", "Dívida Total", "Títulos", "Atraso Máx."],
                      ...simQuery.data!.candidates.map(c => [
                        c.clientName,
                        c.phone,
                        c.stage,
                        fmtBRL(c.totalDebt),
                        c.titlesCount,
                        `${c.maxDaysOverdue}d`,
                      ]),
                    ];
                    const csv = rows.map(r => r.join(";")).join("\n");
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
                    a.download = `simulacao_regua_${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                  }}
                >
                  <FileDown className="h-3 w-3 mr-1" /> Exportar CSV
                </Button>
              </div>

              {/* Seriam cobrados */}
              <div>
                <h3 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" /> Seriam cobrados hoje ({simQuery.data.candidates.length})
                </h3>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs">Cliente</TableHead>
                        <TableHead className="text-xs hidden sm:table-cell">Telefone</TableHead>
                        <TableHead className="text-xs">Estágio</TableHead>
                        <TableHead className="text-right text-xs">Dívida</TableHead>
                        <TableHead className="text-right text-xs hidden sm:table-cell">Atraso</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {simQuery.data.candidates.map(c => (
                        <TableRow key={c.clientId}>
                          <TableCell className="text-xs font-medium">{c.clientName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">{fmtPhone(c.phone)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-xs">{c.stage}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs font-semibold">{fmtBRL(c.totalDebt)}</TableCell>
                          <TableCell className="text-right text-xs hidden sm:table-cell">{c.maxDaysOverdue}d</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {simQuery.data.candidates.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  Nenhum cliente seria cobrado hoje com as configurações atuais.
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ Saúde da Automação ═══ */}
      <AutomationHealthPanel />

      {/* Cards de Agendamento: Régua + Sync Conta Azul */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReguaScheduleCard />
        <SyncScheduleCard />
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className={data.oauth.valid ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50"}>
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-start gap-3">
              {data.oauth.valid ? (
                <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">OAuth Conta Azul</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {data.oauth.valid ? "Token válido" : "Token expirado ou ausente"}
                </p>
                {data.oauth.expiresAt && (
                  <p className="text-xs text-muted-foreground">Expira: {fmtDate(data.oauth.expiresAt)}</p>
                )}
                {!data.oauth.valid && (
                  <div className="mt-2 space-y-1.5">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs w-full"
                      onClick={handleReconectarOAuth}
                      disabled={oauthLoading}
                    >
                      {oauthLoading ? (
                        <><RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Gerando link...</>
                      ) : (
                        <><ExternalLink className="h-3 w-3 mr-1" /> Reconectar Conta Azul</>
                      )}
                    </Button>
                    {oauthError && (
                      <p className="text-xs text-red-700 font-medium">{oauthError}</p>
                    )}
                    {oauthUrl && (
                      <a
                        href={oauthUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 underline block truncate"
                      >
                        Abrir link manualmente →
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 text-blue-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-sm">Sync Conta Azul</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {data.sync.recentDays.length > 0
                    ? `Último: ${fmtDate(data.sync.recentDays[0]?.lastRun)}`
                    : "Sem sincronizações recentes"}
                </p>
                {data.sync.recentDays[0] && (
                  <p className="text-xs text-muted-foreground">
                    Hoje: {data.sync.recentDays[0].paid} pagos, {data.sync.recentDays[0].cancelled} cancelados
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={data.regua.errors > 0 ? "border-red-200 bg-red-50/50" : "border-green-200 bg-green-50/50"}>
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-center gap-3">
              <Zap className={`h-5 w-5 flex-shrink-0 ${data.regua.errors > 0 ? "text-red-500" : "text-green-600"}`} />
              <div>
                <p className="font-semibold text-sm">Régua de Cobrança</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Últimos 7d: {data.regua.sent} enviados, {data.regua.skipped} pulados
                </p>
                {data.regua.errors > 0 && (
                  <p className="text-xs text-red-600 font-medium">{data.regua.errors} erros</p>
                )}
                {data.regua.lastRun && (
                  <p className="text-xs text-muted-foreground">Última: {fmtDate(data.regua.lastRun)}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sync por dia */}
      {data.sync.recentDays.length > 0 && (
        <Card>
          <CardHeader className="pb-3 px-4">
            <CardTitle className="text-sm sm:text-base">Sync — Últimos 7 Dias</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-right text-xs">Pagos</TableHead>
                    <TableHead className="text-right text-xs">Cancelados</TableHead>
                    <TableHead className="text-right text-xs">Última Execução</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sync.recentDays.map(d => (
                    <TableRow key={d.day}>
                      <TableCell className="text-xs">{d.day}</TableCell>
                      <TableCell className="text-right text-xs text-green-700 font-medium">{d.paid}</TableCell>
                      <TableCell className="text-right text-xs text-red-600">{d.cancelled}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{fmtDate(d.lastRun)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Variáveis de Ambiente */}
      <Card>
        <CardHeader className="pb-3 px-4">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <Settings className="h-4 w-4" /> Variáveis de Ambiente
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {envItems.map(({ key, value, isEnabled, isDisabled }) => (
              <div key={key} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                <span className="text-xs font-mono text-muted-foreground truncate mr-2">{key}</span>
                <Badge
                  className={`text-xs flex-shrink-0 ${
                    isEnabled
                      ? "bg-green-100 text-green-800 border-green-200"
                      : isDisabled
                      ? "bg-gray-100 text-gray-600 border-gray-200"
                      : "bg-blue-100 text-blue-800 border-blue-200"
                  }`}
                >
                  {value}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Handoffs recentes */}
      {data.recentHandoffs.length > 0 && (
        <Card>
          <CardHeader className="pb-3 px-4">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <Shield className="h-4 w-4" /> Handoffs Recentes (7d)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Telefone</TableHead>
                    <TableHead className="text-xs">Intent</TableHead>
                    <TableHead className="text-xs">Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentHandoffs.map(h => (
                    <TableRow key={h.id}>
                      <TableCell className="text-xs text-muted-foreground">{fmtDate(h.createdAt)}</TableCell>
                      <TableCell className="text-xs hidden sm:table-cell">{fmtPhone(h.fromPhone)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{INTENT_LABELS[h.intent] ?? h.intent}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{h.handoffReason ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Dashboard Principal ──────────────────────────────────────────────────────

export default function ExecutiveDashboard() {
  const [activeTab, setActiveTab] = useState("operacional");
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar */}
      <div className="border-b bg-card px-4 sm:px-6 py-3 sm:py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base sm:text-xl font-bold text-foreground">Fraga Contabilidade</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Dashboard Executivo de Cobrança</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 inline-block" />
              <span className="hidden sm:inline">Sistema </span>Operacional
            </Badge>
          </div>
        </div>
      </div>

      {/* Quick Nav */}
      <div className="border-b bg-card/50 px-4 sm:px-6 py-2">
        <div className="max-w-7xl mx-auto flex gap-2 overflow-x-auto">
          <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap" onClick={() => navigate('/clientes')}>
            <Users className="h-3 w-3 mr-1" /> Clientes
          </Button>
          <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap" onClick={() => navigate('/regua-pipeline')}>
            <Activity className="h-3 w-3 mr-1" /> Pipeline Régua
          </Button>
          <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap" onClick={() => navigate('/pagamentos')}>
            <DollarSign className="h-3 w-3 mr-1" /> Pagamentos
          </Button>
          <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap" onClick={() => navigate('/canvas')}>
            <MessageSquare className="h-3 w-3 mr-1" /> Canvas
          </Button>
          <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap" onClick={() => navigate('/collection-metrics')}>
            <BarChart3 className="h-3 w-3 mr-1" /> Métricas
          </Button>
          <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap" onClick={() => navigate('/juridico')}>
            <Shield className="h-3 w-3 mr-1" /> Jurídico
          </Button>
          <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap" onClick={() => navigate('/honorarios')}>
            <Calculator className="h-3 w-3 mr-1" /> Honorários
          </Button>
          <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap" onClick={() => navigate('/nfse')}>
            <FileText className="h-3 w-3 mr-1" /> NFS-e
          </Button>
          <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap" onClick={() => navigate('/conta-azul-settings')}>
            <Settings className="h-3 w-3 mr-1" /> Conta Azul
          </Button>
          <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap" onClick={() => navigate('/usuarios')}>
            <Shield className="h-3 w-3 mr-1" /> Usuários
          </Button>
          <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap" onClick={() => navigate('/certificados')}>
            <ShieldCheck className="h-3 w-3 mr-1" /> Certificados
          </Button>
          <Button variant="ghost" size="sm" className="text-xs whitespace-nowrap" onClick={() => navigate('/integracoes-fiscais')}>
            <Network className="h-3 w-3 mr-1" /> Integrações
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {/* Tabs com scroll horizontal no mobile */}
          <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0 mb-5">
            <TabsList className="h-9 w-max min-w-full sm:w-auto">
              <TabsTrigger value="operacional" className="flex items-center gap-1 text-xs sm:text-sm px-3 sm:px-4 whitespace-nowrap">
                <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> Operacional
              </TabsTrigger>
              <TabsTrigger value="financeiro" className="flex items-center gap-1 text-xs sm:text-sm px-3 sm:px-4 whitespace-nowrap">
                <DollarSign className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> Financeiro
              </TabsTrigger>
              <TabsTrigger value="ia" className="flex items-center gap-1 text-xs sm:text-sm px-3 sm:px-4 whitespace-nowrap">
                <Bot className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> IA & Automação
              </TabsTrigger>
              <TabsTrigger value="tecnico" className="flex items-center gap-1 text-xs sm:text-sm px-3 sm:px-4 whitespace-nowrap">
                <Settings className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> Técnico
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="operacional">
            <AbaOperacional />
          </TabsContent>

          <TabsContent value="financeiro">
            <AbaFinanceiro />
          </TabsContent>

          <TabsContent value="ia">
            <AbaIAAutomacao />
          </TabsContent>

          <TabsContent value="tecnico">
            <AbaTecnico />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
