/**
 * nfsePdfNota.ts
 * Gera PDF da NFS-e com dados retornados pelo webservice ABRASF
 * Usa pdf-lib (já instalado)
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export interface DadosNota {
  numeroNfse: string;
  serieNfse: string;
  codigoVerificacao?: string;
  dataEmissao?: string;
  // Prestador
  prestadorRazaoSocial: string;
  prestadorCnpj: string;
  prestadorIm: string;
  prestadorMunicipio?: string;
  prestadorUf?: string;
  // Tomador
  tomadorNome: string;
  tomadorCpfCnpj: string;
  tomadorEmail?: string;
  // Serviço
  descricaoServico: string;
  codigoServico: string;
  competencia: string;
  // Valores
  valorServicos: number;
  aliquotaIss: number;
  valorIss: number;
  issRetido: boolean;
  valorLiquido: number;
}

function fmtMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCnpj(doc: string): string {
  const d = (doc || '').replace(/\D/g, '');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return doc;
}

export async function gerarPdfNota(dados: DadosNota): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontNormal = await doc.embedFont(StandardFonts.Helvetica);

  const azulEscuro = rgb(0.1, 0.2, 0.5);
  const cinzaClaro = rgb(0.92, 0.92, 0.92);
  const preto = rgb(0, 0, 0);
  const cinzaMedio = rgb(0.4, 0.4, 0.4);
  const verde = rgb(0.1, 0.5, 0.2);

  let y = height - 40;

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: azulEscuro });
  page.drawText('NOTA FISCAL DE SERVIÇOS ELETRÔNICA', {
    x: 40, y: height - 35,
    size: 16, font: fontBold, color: rgb(1, 1, 1),
  });
  page.drawText('NFS-e — Prefeitura Municipal de Vila Velha/ES', {
    x: 40, y: height - 55,
    size: 10, font: fontNormal, color: rgb(0.8, 0.8, 0.9),
  });

  // Número da nota em destaque
  page.drawRectangle({ x: width - 180, y: height - 78, width: 170, height: 68, color: rgb(0.95, 0.95, 1) });
  page.drawText(`Nº ${dados.numeroNfse}`, {
    x: width - 170, y: height - 42,
    size: 18, font: fontBold, color: azulEscuro,
  });
  page.drawText(`Série: ${dados.serieNfse || '1'}`, {
    x: width - 170, y: height - 60,
    size: 9, font: fontNormal, color: cinzaMedio,
  });
  if (dados.dataEmissao) {
    page.drawText(`Emitida em: ${dados.dataEmissao.substring(0, 10)}`, {
      x: width - 170, y: height - 74,
      size: 8, font: fontNormal, color: cinzaMedio,
    });
  }

  y = height - 95;

  // ── Seção Prestador ────────────────────────────────────────────────────────
  const drawSectionHeader = (title: string, yPos: number) => {
    page.drawRectangle({ x: 30, y: yPos - 4, width: width - 60, height: 18, color: azulEscuro });
    page.drawText(title, { x: 35, y: yPos, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    return yPos - 22;
  };

  const drawField = (label: string, value: string, xPos: number, yPos: number, labelWidth = 100) => {
    page.drawText(`${label}:`, { x: xPos, y: yPos, size: 8, font: fontBold, color: cinzaMedio });
    page.drawText(value || '-', { x: xPos + labelWidth, y: yPos, size: 8, font: fontNormal, color: preto });
  };

  y = drawSectionHeader('PRESTADOR DO SERVIÇO', y);
  drawField('Razão Social', dados.prestadorRazaoSocial, 35, y);
  y -= 14;
  drawField('CNPJ', fmtCnpj(dados.prestadorCnpj), 35, y);
  drawField('Insc. Municipal', dados.prestadorIm, 250, y);
  drawField('Município', `${dados.prestadorMunicipio || 'Vila Velha'} - ${dados.prestadorUf || 'ES'}`, 400, y, 70);
  y -= 20;

  // ── Seção Tomador ──────────────────────────────────────────────────────────
  y = drawSectionHeader('TOMADOR DO SERVIÇO', y);
  drawField('Nome/Razão Social', dados.tomadorNome, 35, y);
  y -= 14;
  drawField('CPF/CNPJ', fmtCnpj(dados.tomadorCpfCnpj), 35, y);
  if (dados.tomadorEmail) drawField('E-mail', dados.tomadorEmail, 250, y);
  y -= 20;

  // ── Seção Serviço ──────────────────────────────────────────────────────────
  y = drawSectionHeader('DISCRIMINAÇÃO DO SERVIÇO', y);
  // Quebrar descrição longa
  const descWords = dados.descricaoServico.split(' ');
  let line = '';
  const maxCharsPerLine = 90;
  const descLines: string[] = [];
  for (const word of descWords) {
    if ((line + ' ' + word).trim().length > maxCharsPerLine) {
      descLines.push(line.trim());
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) descLines.push(line);
  for (const dl of descLines.slice(0, 6)) {
    page.drawText(dl, { x: 35, y, size: 8, font: fontNormal, color: preto });
    y -= 12;
  }
  y -= 4;
  drawField('Código do Serviço', dados.codigoServico, 35, y);
  drawField('Competência', dados.competencia, 250, y);
  y -= 20;

  // ── Seção Valores ──────────────────────────────────────────────────────────
  y = drawSectionHeader('VALORES', y);
  // Tabela de valores
  const col1 = 35, col2 = 250, col3 = 400;
  page.drawRectangle({ x: 30, y: y - 60, width: width - 60, height: 68, color: cinzaClaro });

  drawField('Valor dos Serviços', `R$ ${fmtMoeda(dados.valorServicos)}`, col1, y);
  drawField('ISS Retido', dados.issRetido ? 'SIM' : 'NÃO', col2, y);
  drawField('Alíquota ISS', `${(dados.aliquotaIss * 100).toFixed(2)}%`, col3, y);
  y -= 16;
  drawField('Valor do ISS', `R$ ${fmtMoeda(dados.valorIss)}`, col1, y);
  drawField('Deduções', 'R$ 0,00', col2, y);
  y -= 16;

  // Valor líquido em destaque
  page.drawText('VALOR LÍQUIDO DA NOTA:', { x: col1, y, size: 10, font: fontBold, color: azulEscuro });
  page.drawText(`R$ ${fmtMoeda(dados.valorLiquido)}`, { x: col1 + 170, y, size: 14, font: fontBold, color: verde });
  y -= 24;

  // ── Código de verificação ──────────────────────────────────────────────────
  if (dados.codigoVerificacao) {
    y = drawSectionHeader('AUTENTICIDADE', y);
    page.drawText('Código de Verificação:', { x: 35, y, size: 9, font: fontBold, color: preto });
    page.drawText(dados.codigoVerificacao, { x: 160, y, size: 11, font: fontBold, color: azulEscuro });
    y -= 20;
  }

  // ── Rodapé ─────────────────────────────────────────────────────────────────
  const rodapeY = 30;
  page.drawLine({ start: { x: 30, y: rodapeY + 12 }, end: { x: width - 30, y: rodapeY + 12 }, thickness: 0.5, color: cinzaMedio });
  page.drawText('Documento gerado pelo Sistema Fraga Contabilidade — NFS-e Eletrônica', {
    x: 35, y: rodapeY,
    size: 7, font: fontNormal, color: cinzaMedio,
  });
  page.drawText(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, {
    x: width - 120, y: rodapeY,
    size: 7, font: fontNormal, color: cinzaMedio,
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
