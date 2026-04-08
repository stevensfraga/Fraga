/**
 * PDF Generator - Cria PDF > 5KB para testes
 * Gera PDF com múltiplas páginas e conteúdo repetido
 */

export function generateLargePdf(): Buffer {
  // PDF header
  let pdf = '%PDF-1.4\n';
  
  // Object 1: Catalog
  pdf += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  
  // Object 2: Pages
  pdf += '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>\nendobj\n';
  
  // Object 3: Page 1
  pdf += '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>\nendobj\n';
  
  // Object 4: Page 2
  pdf += '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 8 0 R /Resources << /Font << /F1 7 0 R >> >> >>\nendobj\n';
  
  // Object 5: Page 3
  pdf += '5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 9 0 R /Resources << /Font << /F1 7 0 R >> >> >>\nendobj\n';
  
  // Object 6: Content stream for page 1
  const content1 = 'BT /F1 12 Tf 50 750 Td (BOLETO DE COBRANCA) Tj 0 -20 Td (Banco: 001 - Banco do Brasil) Tj 0 -20 Td (Agencia: 1234-5 Conta: 123456-7) Tj 0 -20 Td (Nosso Numero: 141571260467466) Tj 0 -20 Td (Data de Emissao: 22/02/2026) Tj 0 -20 Td (Data de Vencimento: 15/02/2026) Tj 0 -20 Td (Valor: R$ 255,60) Tj 0 -20 Td (Sacado: R7 GERADORES LTDA) Tj 0 -20 Td (CNPJ: 21.918.918/0001-94) Tj 0 -20 Td (Endereco: Rua Teste, 123) Tj 0 -20 Td (Cidade: Sao Paulo - SP - CEP: 01234-567) Tj 0 -20 Td (Instrucoes: Pagamento obrigatorio) Tj ET';
  pdf += `6 0 obj\n<< /Length ${content1.length} >>\nstream\n${content1}\nendstream\nendobj\n`;
  
  // Object 7: Font
  pdf += '7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  
  // Object 8: Content stream for page 2
  const content2 = 'BT /F1 12 Tf 50 750 Td (BOLETO DE COBRANCA - PAGINA 2) Tj 0 -20 Td (Linha Digitavel:) Tj 0 -20 Td (00190.12345 14157.126046 74660.000001 1 12345678901234) Tj 0 -20 Td (Codigo de Barras: 00190123451415712604674660000001123456789012) Tj 0 -20 Td (PIX QR Code: 00020126580014br.gov.bcb.pix) Tj 0 -20 Td (Chave PIX: chave@pix.com.br) Tj 0 -20 Td (Beneficiario: FRAGA CONTABILIDADE LTDA) Tj 0 -20 Td (CNPJ: 12.345.678/0001-90) Tj 0 -20 Td (Agencia Beneficiaria: 1234-5) Tj 0 -20 Td (Conta Beneficiaria: 123456-7) Tj 0 -20 Td (Especie: 01 - Duplicata) Tj 0 -20 Td (Aceite: N) Tj ET';
  pdf += `8 0 obj\n<< /Length ${content2.length} >>\nstream\n${content2}\nendstream\nendobj\n`;
  
  // Object 9: Content stream for page 3
  const content3 = 'BT /F1 12 Tf 50 750 Td (BOLETO DE COBRANCA - PAGINA 3) Tj 0 -20 Td (Desconto: R$ 0,00) Tj 0 -20 Td (Outras Deducoes: R$ 0,00) Tj 0 -20 Td (Mora/Multa: R$ 0,00) Tj 0 -20 Td (Outros Acrescimos: R$ 0,00) Tj 0 -20 Td (Valor Cobrado: R$ 255,60) Tj 0 -20 Td (Status: ABERTO) Tj 0 -20 Td (Emitido em: 22/02/2026 10:30:45) Tj 0 -20 Td (Processado em: 22/02/2026 10:31:00) Tj 0 -20 Td (Referencia: Venda 14464) Tj 0 -20 Td (Observacoes: Certificacao Digital) Tj 0 -20 Td (Assinado digitalmente por: FRAGA CONTABILIDADE) Tj 0 -20 Td (Verificar autenticidade em: https://www.bb.com.br/boleto) Tj ET';
  pdf += `9 0 obj\n<< /Length ${content3.length} >>\nstream\n${content3}\nendstream\nendobj\n`;
  
  // Cross-reference table
  const xrefOffset = pdf.length;
  pdf += 'xref\n0 10\n';
  pdf += '0000000000 65535 f\n';
  
  // Calculate object offsets (simplified - in real PDF, need exact byte positions)
  const offsets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let currentOffset = 0;
  const lines = pdf.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\d+ 0 obj/)) {
      const objNum = parseInt(lines[i]);
      if (objNum > 0 && objNum < 10) {
        offsets[objNum] = currentOffset;
      }
    }
    currentOffset += lines[i].length + 1; // +1 for newline
  }
  
  // Write xref entries
  for (let i = 1; i < 10; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n\n`;
  }
  
  // Trailer
  pdf += 'trailer\n<< /Size 10 /Root 1 0 R >>\n';
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  
  // Pad to ensure > 5KB
  while (Buffer.byteLength(pdf) < 5000) {
    pdf += '% Padding line to reach minimum size\n';
  }
  
  return Buffer.from(pdf, 'utf-8');
}

export default generateLargePdf;
