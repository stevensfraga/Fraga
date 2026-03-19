import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Filter, X } from "lucide-react";

interface HistoryFiltersProps {
  onFilterChange: (filters: FilterOptions) => void;
  isLoading?: boolean;
}

export interface FilterOptions {
  startDate?: Date;
  endDate?: Date;
  messageType?: "friendly" | "administrative" | "formal";
}

export function HistoryFilters({ onFilterChange, isLoading = false }: HistoryFiltersProps) {
  const [filters, setFilters] = useState<FilterOptions>({});
  const [showFilters, setShowFilters] = useState(false);

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? new Date(e.target.value) : undefined;
    const newFilters = { ...filters, startDate: date };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? new Date(e.target.value) : undefined;
    const newFilters = { ...filters, endDate: date };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleMessageTypeChange = (value: string) => {
    const messageType = value === "all" ? undefined : (value as "friendly" | "administrative" | "formal");
    const newFilters = { ...filters, messageType };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleClearFilters = () => {
    setFilters({});
    onFilterChange({});
  };

  const hasActiveFilters = filters.startDate || filters.endDate || filters.messageType;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          Filtros
          {hasActiveFilters && (
            <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
              {Object.values(filters).filter(Boolean).length}
            </span>
          )}
        </Button>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            className="gap-2"
          >
            <X className="h-4 w-4" />
            Limpar Filtros
          </Button>
        )}
      </div>

      {showFilters && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filtrar Histórico</CardTitle>
            <CardDescription>Refine os resultados por período e tipo de mensagem</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Período */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="start-date" className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Data Inicial
                </Label>
                <Input
                  id="start-date"
                  type="date"
                  value={filters.startDate ? filters.startDate.toISOString().split("T")[0] : ""}
                  onChange={handleStartDateChange}
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="end-date" className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Data Final
                </Label>
                <Input
                  id="end-date"
                  type="date"
                  value={filters.endDate ? filters.endDate.toISOString().split("T")[0] : ""}
                  onChange={handleEndDateChange}
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Tipo de Mensagem */}
            <div className="space-y-2">
              <Label htmlFor="message-type">Tipo de Mensagem</Label>
              <Select
                value={filters.messageType || "all"}
                onValueChange={handleMessageTypeChange}
                disabled={isLoading}
              >
                <SelectTrigger id="message-type">
                  <SelectValue placeholder="Selecione um tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Tipos</SelectItem>
                  <SelectItem value="friendly">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      Amigável
                    </span>
                  </SelectItem>
                  <SelectItem value="administrative">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-yellow-500" />
                      Administrativa
                    </span>
                  </SelectItem>
                  <SelectItem value="formal">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      Formal
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Resumo dos Filtros */}
            {hasActiveFilters && (
              <div className="rounded-lg bg-blue-50 p-3 text-sm">
                <p className="font-medium text-blue-900">Filtros Ativos:</p>
                <ul className="mt-2 space-y-1 text-blue-800">
                  {filters.startDate && (
                    <li>
                      • Data inicial: {filters.startDate.toLocaleDateString("pt-BR")}
                    </li>
                  )}
                  {filters.endDate && (
                    <li>
                      • Data final: {filters.endDate.toLocaleDateString("pt-BR")}
                    </li>
                  )}
                  {filters.messageType && (
                    <li>
                      • Tipo: {filters.messageType === "friendly" ? "Amigável" : filters.messageType === "administrative" ? "Administrativa" : "Formal"}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
