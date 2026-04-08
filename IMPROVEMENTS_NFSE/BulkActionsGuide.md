# 🎯 GUIA DE IMPLEMENTAÇÃO - BULK ACTIONS

## Visão Geral
Sistema de seleção múltipla e operações em lote para a página `/nfse`.

---

## 1. ESTADO GLOBAL (Zustand)

```typescript
// store/nfseBulkStore.ts
import { create } from 'zustand';

interface NfseBulkStore {
  selectedIds: number[];
  toggleSelect: (id: number) => void;
  selectAll: (ids: number[]) => void;
  deselectAll: () => void;
  isSelected: (id: number) => boolean;
  getSelectedCount: () => number;
}

export const useNfseBulkStore = create<NfseBulkStore>((set, get) => ({
  selectedIds: [],
  
  toggleSelect: (id: number) => {
    const current = get().selectedIds;
    set({
      selectedIds: current.includes(id)
        ? current.filter(i => i !== id)
        : [...current, id],
    });
  },
  
  selectAll: (ids: number[]) => set({ selectedIds: ids }),
  deselectAll: () => set({ selectedIds: [] }),
  
  isSelected: (id: number) => get().selectedIds.includes(id),
  getSelectedCount: () => get().selectedIds.length,
}));
```

---

## 2. MUTATIONS NO TRPC

```typescript
// server/routers/nfse.router.ts
import { z } from 'zod';

export const nfseRouter = t.router({
  emissoes: t.router({
    // ... existing queries
    
    // Bulk emit
    bulkEmit: t.procedure
      .input(z.object({
        ids: z.number().array(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { ids } = input;
        
        if (!ids.length) throw new Error('Nenhuma NF-e selecionada');
        
        const results = await Promise.allSettled(
          ids.map(id =>
            ctx.db.nfseEmissao.update({
              where: { id },
              data: {
                status: 'processando',
                tentativas: { increment: 1 },
                ultimaTentativa: new Date(),
              },
            })
          )
        );
        
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.length - succeeded;
        
        return {
          total: results.length,
          succeeded,
          failed,
          message: `${succeeded} NF-e(s) enviada(s) para emissão`,
        };
      }),
    
    // Bulk retry
    bulkRetry: t.procedure
      .input(z.object({
        ids: z.number().array(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { ids } = input;
        
        const updated = await ctx.db.nfseEmissao.updateMany({
          where: { id: { in: ids }, status: 'erro' },
          data: {
            status: 'processando',
            tentativas: { increment: 1 },
            ultimaTentativa: new Date(),
            ultimoErro: null,
          },
        });
        
        return {
          message: `${updated.count} NF-e(s) reenviada(s)`,
          count: updated.count,
        };
      }),
    
    // Bulk delete
    bulkDelete: t.procedure
      .input(z.object({
        ids: z.number().array(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { ids } = input;
        
        const deleted = await ctx.db.nfseEmissao.deleteMany({
          where: {
            id: { in: ids },
            status: { in: ['rascunho', 'erro'] }, // Apenas destes status
          },
        });
        
        return {
          message: `${deleted.count} NF-e(s) deletada(s)`,
          count: deleted.count,
        };
      }),
    
    // Bulk export
    bulkExport: t.procedure
      .input(z.object({
        ids: z.number().array(),
        format: z.enum(['csv', 'xlsx', 'json']),
      }))
      .mutation(async ({ input, ctx }) => {
        const { ids, format } = input;
        
        const emissoes = await ctx.db.nfseEmissao.findMany({
          where: { id: { in: ids } },
        });
        
        // Implementar export
        const data = formatExport(emissoes, format);
        
        return {
          data,
          filename: `nfse-export-${Date.now()}.${format}`,
        };
      }),
  }),
});
```

---

## 3. COMPONENTE DE TOOLBAR

```typescript
// components/NfseBulkToolbar.tsx
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useNfseBulkStore } from "@/store/nfseBulkStore";
import { toast } from "sonner";
import {
  Send,
  RotateCcw,
  Trash2,
  Download,
  X,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "lucide-react";
import { useState } from "react";

interface Props {
  onSuccess: () => void;
}

export function NfseBulkToolbar({ onSuccess }: Props) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const selectedIds = useNfseBulkStore((s) => s.selectedIds);
  const deselectAll = useNfseBulkStore((s) => s.deselectAll);
  
  const bulkEmitMut = trpc.nfse.emissoes.bulkEmit.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      deselectAll();
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
  
  const bulkRetryMut = trpc.nfse.emissoes.bulkRetry.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      deselectAll();
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
  
  const bulkDeleteMut = trpc.nfse.emissoes.bulkDelete.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      deselectAll();
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
  
  const bulkExportMut = trpc.nfse.emissoes.bulkExport.useMutation({
    onSuccess: (data) => {
      // Trigger download
      const element = document.createElement('a');
      element.href = `data:text/plain;charset=utf-8,${encodeURIComponent(data.data)}`;
      element.download = data.filename;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      
      toast.success("Exportação realizada!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!selectedIds.length) return null;

  const isLoading =
    bulkEmitMut.isPending ||
    bulkRetryMut.isPending ||
    bulkDeleteMut.isPending;

  return (
    <>
      <div className="sticky bottom-0 bg-blue-50 border-t border-blue-200 p-4 rounded-t-lg shadow-lg">
        <div className="flex items-center justify-between max-w-7xl mx-auto px-6">
          <div className="text-sm font-medium">
            {selectedIds.length} NF-e(s) selecionada(s)
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => deselectAll()}
              disabled={isLoading}
            >
              <X className="h-4 w-4 mr-1" />
              Desselecionar
            </Button>

            <Button
              size="sm"
              onClick={() =>
                bulkEmitMut.mutate({ ids: selectedIds })
              }
              disabled={isLoading}
            >
              <Send className="h-4 w-4 mr-1" />
              Emitir ({selectedIds.length})
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                bulkRetryMut.mutate({ ids: selectedIds })
              }
              disabled={isLoading}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Reprocessar
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                bulkExportMut.mutate({
                  ids: selectedIds,
                  format: 'xlsx',
                })
              }
              disabled={isLoading}
            >
              <Download className="h-4 w-4 mr-1" />
              Exportar
            </Button>

            <Button
              size="sm"
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isLoading}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Deletar
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar NF-e(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem certeza que deseja deletar {selectedIds.length} NF-e(s)?
              Esta ação é irreversível.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                bulkDeleteMut.mutate({ ids: selectedIds });
                setShowDeleteConfirm(false);
              }}
            >
              Deletar
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

---

## 4. INTEGRAÇÃO NA TABELA

```typescript
// components/NfseTable.tsx
import { Checkbox } from "@/components/ui/checkbox";
import { useNfseBulkStore } from "@/store/nfseBulkStore";

export function NfseTable({ data }: { data: Emissao[] }) {
  const { toggleSelect, isSelected, selectAll, selectedIds } = useNfseBulkStore();

  const allSelected = data.length > 0 && selectedIds.length === data.length;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {/* Checkbox Header */}
          <TableHead className="w-[50px]">
            <Checkbox
              checked={allSelected}
              indeterminate={selectedIds.length > 0 && !allSelected}
              onCheckedChange={(checked) => {
                if (checked) {
                  selectAll(data.map((d) => d.id));
                } else {
                  useNfseBulkStore.getState().deselectAll();
                }
              }}
            />
          </TableHead>

          {/* Other Headers */}
          <TableHead>NF-e</TableHead>
          <TableHead>Tomador</TableHead>
          <TableHead>Valor</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Ações</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {data.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <Checkbox
                checked={isSelected(item.id)}
                onCheckedChange={() => toggleSelect(item.id)}
              />
            </TableCell>
            {/* Other Cells */}
            <TableCell>{item.nfseNumber}</TableCell>
            <TableCell>{item.tomador}</TableCell>
            <TableCell>R$ {item.valor.toFixed(2)}</TableCell>
            <TableCell>
              <Badge>{item.status}</Badge>
            </TableCell>
            <TableCell>{/* Individual Actions */}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

---

## 5. USO NA PÁGINA

```typescript
// pages/NfseDashboard.tsx
export default function NfseDashboard() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});

  const listQuery = trpc.nfse.emissoes.list.useQuery({
    page,
    perPage: 50,
    ...filters,
  });

  return (
    <div>
      {/* Analytics */}
      <NfseAnalytics />

      {/* Filters */}
      <AdvancedFilters
        filters={filters}
        onFiltersChange={setFilters}
        isLoading={listQuery.isPending}
      />

      {/* Table */}
      <NfseTable data={listQuery.data?.emissoes || []} />

      {/* Bulk Toolbar */}
      <NfseBulkToolbar onSuccess={() => listQuery.refetch()} />

      {/* Pagination */}
      {/* ... */}
    </div>
  );
}
```

---

## 📊 CHECKLIST DE IMPLEMENTAÇÃO

- [ ] Criar Zustand store
- [ ] Implementar TRPC mutations
- [ ] Componente NfseBulkToolbar
- [ ] Integração com tabela
- [ ] Testes de seleção
- [ ] Confirmações de delete
- [ ] Feedback com toast
- [ ] Logs de auditoria

---

## 🎯 UX REFINEMENTS

### Feedback Visual
- ✅ Highlight de seleção
- ✅ Badge com count
- ✅ Toast de sucesso/erro
- ✅ Loading indicators
- ✅ Disabled states

### Keyboard Shortcuts
```
Shift + Click: Range select
Ctrl/Cmd + A: Select all (quando filtrados)
Delete: Delete selected (com confirmação)
```

### Performance
- Limpar seleção após ação bem-sucedida
- Cache TRPC atualizado
- Batch API calls
- Debounce em operações

