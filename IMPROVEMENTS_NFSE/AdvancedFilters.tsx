import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Search, X, Filter, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { pt } from "date-fns/locale";

export interface AdvancedFilterState {
  search?: string;
  status?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  minValue?: number;
  maxValue?: number;
  city?: string;
  provider?: string;
}

interface Props {
  filters: AdvancedFilterState;
  onFiltersChange: (filters: AdvancedFilterState) => void;
  isLoading?: boolean;
}

const QUICK_FILTERS = [
  { label: "Últimas 24h", value: "last24h" },
  { label: "Esta Semana", value: "thisWeek" },
  { label: "Este Mês", value: "thisMonth" },
  { label: "Últimos 3 Meses", value: "last3Months" },
];

const STATUS_OPTIONS = [
  { value: "rascunho", label: "Rascunho" },
  { value: "processando", label: "Processando" },
  { value: "emitida", label: "Emitida" },
  { value: "erro", label: "Erro" },
  { value: "cancelada", label: "Cancelada" },
];

export function AdvancedFilters({
  filters,
  onFiltersChange,
  isLoading,
}: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tempFilters, setTempFilters] = useState(filters);

  const activeFilterCount = Object.values(filters).filter(
    (v) => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : true)
  ).length;

  const applyQuickFilter = (filterType: string) => {
    const today = new Date();
    let dateFrom = new Date();

    switch (filterType) {
      case "last24h":
        dateFrom.setDate(today.getDate() - 1);
        break;
      case "thisWeek":
        dateFrom.setDate(today.getDate() - today.getDay());
        break;
      case "thisMonth":
        dateFrom.setDate(1);
        break;
      case "last3Months":
        dateFrom.setMonth(today.getMonth() - 3);
        break;
    }

    onFiltersChange({
      ...filters,
      dateFrom,
      dateTo: today,
    });
  };

  const clearFilters = () => {
    onFiltersChange({});
  };

  const handleApplyAdvanced = () => {
    onFiltersChange(tempFilters);
    setShowAdvanced(false);
  };

  return (
    <div className="space-y-4">
      {/* Main Search Bar */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex-1 min-w-64 relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar tomador, NF-e, descrição..."
            className="pl-9"
            value={filters.search || ""}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value })
            }
            disabled={isLoading}
          />
        </div>

        {/* Quick Filters */}
        <div className="flex gap-2">
          {QUICK_FILTERS.map((qf) => (
            <Button
              key={qf.value}
              variant="outline"
              size="sm"
              onClick={() => applyQuickFilter(qf.value)}
              disabled={isLoading}
              className="text-xs"
            >
              {qf.label}
            </Button>
          ))}
        </div>

        {/* Advanced Toggle */}
        <Popover open={showAdvanced} onOpenChange={setShowAdvanced}>
          <PopoverTrigger asChild>
            <Button
              variant={activeFilterCount > 0 ? "default" : "outline"}
              size="sm"
              disabled={isLoading}
            >
              <Filter className="h-4 w-4 mr-1" />
              Filtros
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-2 h-5">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96" align="end">
            <div className="space-y-4">
              <h3 className="font-semibold">Filtros Avançados</h3>

              {/* Status Multi-Select */}
              <div className="space-y-2">
                <Label className="text-xs">Status</Label>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((status) => (
                    <Button
                      key={status.value}
                      variant={
                        tempFilters.status?.includes(status.value)
                          ? "default"
                          : "outline"
                      }
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        const current = tempFilters.status || [];
                        const updated = current.includes(status.value)
                          ? current.filter((s) => s !== status.value)
                          : [...current, status.value];
                        setTempFilters({
                          ...tempFilters,
                          status: updated.length > 0 ? updated : undefined,
                        });
                      }}
                    >
                      {status.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Date Range */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label className="text-xs">Data Inicial</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full text-xs">
                        {tempFilters.dateFrom
                          ? format(tempFilters.dateFrom, "dd/MMM/yy", {
                              locale: pt,
                            })
                          : "Selecionar"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={tempFilters.dateFrom}
                        onSelect={(date) =>
                          setTempFilters({
                            ...tempFilters,
                            dateFrom: date,
                          })
                        }
                        disabled={(date) =>
                          tempFilters.dateTo
                            ? date > tempFilters.dateTo
                            : false
                        }
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Data Final</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full text-xs">
                        {tempFilters.dateTo
                          ? format(tempFilters.dateTo, "dd/MMM/yy", {
                              locale: pt,
                            })
                          : "Selecionar"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={tempFilters.dateTo}
                        onSelect={(date) =>
                          setTempFilters({
                            ...tempFilters,
                            dateTo: date,
                          })
                        }
                        disabled={(date) =>
                          tempFilters.dateFrom
                            ? date < tempFilters.dateFrom
                            : false
                        }
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Value Range */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label className="text-xs">Valor Mín (R$)</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    size="sm"
                    className="text-xs"
                    value={tempFilters.minValue || ""}
                    onChange={(e) =>
                      setTempFilters({
                        ...tempFilters,
                        minValue: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Valor Máx (R$)</Label>
                  <Input
                    type="number"
                    placeholder="999999"
                    size="sm"
                    className="text-xs"
                    value={tempFilters.maxValue || ""}
                    onChange={(e) =>
                      setTempFilters({
                        ...tempFilters,
                        maxValue: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </div>
              </div>

              {/* City & Provider */}
              <div className="space-y-2">
                <Label className="text-xs">Cidade</Label>
                <Input
                  placeholder="Ex: São Paulo"
                  className="text-xs"
                  value={tempFilters.city || ""}
                  onChange={(e) =>
                    setTempFilters({
                      ...tempFilters,
                      city: e.target.value || undefined,
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Prestador de Serviço</Label>
                <Input
                  placeholder="Nome ou CNPJ"
                  className="text-xs"
                  value={tempFilters.provider || ""}
                  onChange={(e) =>
                    setTempFilters({
                      ...tempFilters,
                      provider: e.target.value || undefined,
                    })
                  }
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={handleApplyAdvanced}
                  className="flex-1 text-xs"
                >
                  Aplicar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setTempFilters({});
                    clearFilters();
                    setShowAdvanced(false);
                  }}
                  className="text-xs"
                >
                  Limpar
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Active Filters Display */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-2">
          {filters.status?.map((status) => (
            <Badge
              key={`status-${status}`}
              variant="secondary"
              className="text-xs cursor-pointer"
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  status: filters.status?.filter((s) => s !== status),
                })
              }
            >
              {status}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          ))}
          {filters.dateFrom && (
            <Badge
              variant="secondary"
              className="text-xs cursor-pointer"
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  dateFrom: undefined,
                })
              }
            >
              De {format(filters.dateFrom, "dd/MMM", { locale: pt })}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          )}
          {filters.dateTo && (
            <Badge
              variant="secondary"
              className="text-xs cursor-pointer"
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  dateTo: undefined,
                })
              }
            >
              Até {format(filters.dateTo, "dd/MMM", { locale: pt })}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          )}
          {filters.minValue !== undefined && (
            <Badge
              variant="secondary"
              className="text-xs cursor-pointer"
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  minValue: undefined,
                })
              }
            >
              Min: R$ {filters.minValue.toFixed(2)}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          )}
          {filters.maxValue !== undefined && (
            <Badge
              variant="secondary"
              className="text-xs cursor-pointer"
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  maxValue: undefined,
                })
              }
            >
              Max: R$ {filters.maxValue.toFixed(2)}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          )}
          {(filters.search || filters.city || filters.provider) && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-6 px-2"
              onClick={clearFilters}
            >
              Limpar Tudo
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

