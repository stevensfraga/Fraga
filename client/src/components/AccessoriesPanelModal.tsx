import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle, Clock, AlertTriangle } from "lucide-react";

interface Cliente {
  cnpj: string;
  nome: string;
  status: string;
  dataEntrega?: string;
}

interface PanelDetails {
  entregas: {
    total: number;
    antecipadas: { count: number; percentage: number };
    prazoTecnico: { count: number; percentage: number };
    atrasadas: { count: number; percentage: number; comMulta: number };
    atrasoJustificado: { count: number; percentage: number };
  };
  aRealizar: {
    total: number;
    prazoAntecipado: { count: number; percentage: number };
    prazoTecnico: { count: number; percentage: number };
    atrasoLegal: { count: number; percentage: number; comMulta: number };
    atrasoJustificado: { count: number; percentage: number };
  };
  docs: {
    total: number;
    lidos: { count: number; percentage: number };
    naoLidos: { count: number; percentage: number };
    iniciados: { count: number; percentage: number };
    concluidos: { count: number; percentage: number };
  };
  processos: {
    total: number;
    iniciados: { count: number; percentage: number };
    concluidos: { count: number; percentage: number };
    passosOk: { count: number; percentage: number };
    followupEnviados: { count: number; percentage: number };
  };
  clientes?: Cliente[];
}

interface AccessoriesPanelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panelName: string;
  details: PanelDetails;
  clientes?: Cliente[];
}

export function AccessoriesPanelModal({
  open,
  onOpenChange,
  panelName,
  details,
  clientes = [],
}: AccessoriesPanelModalProps) {
  const getStatusColor = (count: number, total: number) => {
    if (count === 0) return "text-green-600";
    if (count <= total * 0.25) return "text-yellow-600";
    return "text-red-600";
  };

  const getStatusIcon = (count: number, total: number) => {
    if (count === 0) return <CheckCircle className="w-4 h-4" />;
    if (count <= total * 0.25) return <AlertTriangle className="w-4 h-4" />;
    return <AlertCircle className="w-4 h-4" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">{panelName}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Entregas */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Entregas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-3xl font-bold text-green-600">
                {details.entregas.total}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Antecipadas:</span>
                  <span className="font-semibold">
                    {details.entregas.antecipadas.count}/{details.entregas.antecipadas.percentage}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Prazo técnico:</span>
                  <span className="font-semibold">
                    {details.entregas.prazoTecnico.count}/{details.entregas.prazoTecnico.percentage}%
                  </span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>Atrasadas:</span>
                  <span className="font-semibold">
                    {details.entregas.atrasadas.count}/{details.entregas.atrasadas.percentage}%
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-500 ml-4">
                  <span>Com multa:</span>
                  <span>{details.entregas.atrasadas.comMulta}%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* A Realizar */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-orange-600" />
                A Realizar
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-3xl font-bold text-orange-600">
                {details.aRealizar.total}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Prazo antecipado:</span>
                  <span className="font-semibold">
                    {details.aRealizar.prazoAntecipado.count}/{details.aRealizar.prazoAntecipado.percentage}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Prazo técnico:</span>
                  <span className="font-semibold">
                    {details.aRealizar.prazoTecnico.count}/{details.aRealizar.prazoTecnico.percentage}%
                  </span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>Atraso legal:</span>
                  <span className="font-semibold">
                    {details.aRealizar.atrasoLegal.count}/{details.aRealizar.atrasoLegal.percentage}%
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-500 ml-4">
                  <span>Com multa:</span>
                  <span>{details.aRealizar.atrasoLegal.comMulta}%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Docs */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-blue-600" />
                Documentação
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-3xl font-bold text-blue-600">
                {details.docs.total}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Lidos:</span>
                  <span className="font-semibold">
                    {details.docs.lidos.count}/{details.docs.lidos.percentage}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Não lidos:</span>
                  <span className="font-semibold">
                    {details.docs.naoLidos.count}/{details.docs.naoLidos.percentage}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Iniciados:</span>
                  <span className="font-semibold">
                    {details.docs.iniciados.count}/{details.docs.iniciados.percentage}%
                  </span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span>Concluídos:</span>
                  <span className="font-semibold">
                    {details.docs.concluidos.count}/{details.docs.concluidos.percentage}%
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Processos */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-purple-600" />
                Processos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-3xl font-bold text-purple-600">
                {details.processos.total}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Iniciados:</span>
                  <span className="font-semibold">
                    {details.processos.iniciados.count}/{details.processos.iniciados.percentage}%
                  </span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span>Concluídos:</span>
                  <span className="font-semibold">
                    {details.processos.concluidos.count}/{details.processos.concluidos.percentage}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Passos OK:</span>
                  <span className="font-semibold">
                    {details.processos.passosOk.count}/{details.processos.passosOk.percentage}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Follow-up enviados:</span>
                  <span className="font-semibold">
                    {details.processos.followupEnviados.count}/{details.processos.followupEnviados.percentage}%
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Clientes */}
        {clientes && clientes.length > 0 && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-blue-600" />
                Clientes Relacionados ({clientes.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {clientes.map((cliente) => (
                  <div key={cliente.cnpj} className="p-3 bg-slate-100 rounded-lg border border-slate-200">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-semibold text-slate-900">{cliente.nome}</div>
                        <div className="text-sm text-slate-600">CNPJ: {cliente.cnpj}</div>
                        {cliente.dataEntrega && (
                          <div className="text-xs text-slate-500 mt-1">Entrega: {cliente.dataEntrega}</div>
                        )}
                      </div>
                      <div className="text-right">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                          cliente.status === 'entregue' ? 'bg-green-200 text-green-800' :
                          cliente.status === 'pendente' ? 'bg-yellow-200 text-yellow-800' :
                          'bg-red-200 text-red-800'
                        }`}>
                          {cliente.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </DialogContent>
    </Dialog>
  );
}
