/**
 * BLOCO 11 — ETAPA 11.1: Classificação por faixa de atraso
 * 
 * Buckets:
 * A) D+1 a D+3  → Lembrete leve
 * B) D+4 a D+15 → Cobrança formal
 * C) D+16 a D+30 → Cobrança firme
 * D) +30 dias → Pré-jurídico
 */

export type BucketCode = 'A' | 'B' | 'C' | 'D';

export interface BucketDefinition {
  code: BucketCode;
  label: string;
  minDays: number;
  maxDays: number;
  messageType: 'friendly' | 'administrative' | 'formal';
  description: string;
}

export const BUCKET_DEFINITIONS: BucketDefinition[] = [
  {
    code: 'A',
    label: 'Lembrete Leve',
    minDays: 1,
    maxDays: 3,
    messageType: 'friendly',
    description: 'D+1 a D+3 — Lembrete amigável de fatura em aberto',
  },
  {
    code: 'B',
    label: 'Cobrança Formal',
    minDays: 4,
    maxDays: 15,
    messageType: 'administrative',
    description: 'D+4 a D+15 — Cobrança formal com link de pagamento',
  },
  {
    code: 'C',
    label: 'Cobrança Firme',
    minDays: 16,
    maxDays: 30,
    messageType: 'formal',
    description: 'D+16 a D+30 — Cobrança firme com prazo final',
  },
  {
    code: 'D',
    label: 'Pré-Jurídico',
    minDays: 31,
    maxDays: Infinity,
    messageType: 'formal',
    description: '+30 dias — Aviso pré-jurídico',
  },
];

/**
 * Calcular dias em atraso a partir da data de vencimento
 */
export function calcDaysOverdue(dueDate: Date | string): number {
  const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const now = new Date();
  // Zerar horas para comparar apenas datas
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = today.getTime() - dueDay.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Classificar um receivable em um bucket baseado nos dias de atraso
 */
export function classifyBucket(daysOverdue: number): BucketDefinition | null {
  if (daysOverdue <= 0) return null; // Não está em atraso
  
  for (const bucket of BUCKET_DEFINITIONS) {
    if (daysOverdue >= bucket.minDays && daysOverdue <= bucket.maxDays) {
      return bucket;
    }
  }
  
  // Fallback: +30 dias (bucket D)
  return BUCKET_DEFINITIONS[3];
}

/**
 * Obter bucket por código
 */
export function getBucketByCode(code: BucketCode): BucketDefinition {
  const bucket = BUCKET_DEFINITIONS.find(b => b.code === code);
  if (!bucket) throw new Error(`Bucket ${code} não encontrado`);
  return bucket;
}

/**
 * Classificar um array de receivables em buckets
 */
export interface ReceivableWithBucket {
  receivableId: number;
  clientId: number;
  amount: string;
  dueDate: Date;
  daysOverdue: number;
  bucket: BucketDefinition;
  link: string | null;
}

export function classifyReceivables(
  receivables: Array<{
    id: number;
    clientId: number;
    amount: string;
    dueDate: Date | string;
    link: string | null;
  }>
): ReceivableWithBucket[] {
  return receivables
    .map(r => {
      const daysOverdue = calcDaysOverdue(r.dueDate);
      const bucket = classifyBucket(daysOverdue);
      if (!bucket) return null;
      
      return {
        receivableId: r.id,
        clientId: r.clientId,
        amount: r.amount,
        dueDate: typeof r.dueDate === 'string' ? new Date(r.dueDate) : r.dueDate,
        daysOverdue,
        bucket,
        link: r.link,
      };
    })
    .filter((r): r is ReceivableWithBucket => r !== null);
}

/**
 * Agrupar receivables classificados por bucket
 */
export interface BucketSummary {
  bucket: BucketDefinition;
  count: number;
  totalAmount: number;
  receivables: ReceivableWithBucket[];
}

export function groupByBucket(classified: ReceivableWithBucket[]): BucketSummary[] {
  const groups = new Map<BucketCode, BucketSummary>();
  
  for (const def of BUCKET_DEFINITIONS) {
    groups.set(def.code, {
      bucket: def,
      count: 0,
      totalAmount: 0,
      receivables: [],
    });
  }
  
  for (const item of classified) {
    const group = groups.get(item.bucket.code);
    if (group) {
      group.count++;
      group.totalAmount += parseFloat(item.amount);
      group.receivables.push(item);
    }
  }
  
  return Array.from(groups.values());
}
