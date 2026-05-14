/**
 * @perry/export — DOCX Exporter
 *
 * Professional KDP-ready DOCX interior formatting.
 * Supports: title page, copyright, dedication, TOC, chapter headings
 * with page breaks, scene breaks, back matter.
 *
 * Ported from V4 — standalone, no service dependencies.
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, SectionType,
} from 'docx';

export interface DocxExportOptions {
  title: string;
  author: string;
  content: string;
  subtitle?: string;
  dedication?: string;
  copyright?: string;
  authorBio?: string;
  alsoBy?: string[];
  newsletterCta?: string;
  trimSize?: '5x8' | '5.5x8.5' | '6x9';
}

const TRIM_MARGINS: Record<string, { top: number; bottom: number; left: number; right: number }> = {
  '5x8':     { top: 1080, bottom: 1080, left: 1080, right: 864 },
  '5.5x8.5': { top: 1080, bottom: 1080, left: 1080, right: 864 },
  '6x9':     { top: 1152, bottom: 1152, left: 1152, right: 864 },
};

export async function generateDocxBuffer(options: DocxExportOptions): Promise<Buffer> {
  const { title, author, content, subtitle, dedication, copyright, authorBio, alsoBy, newsletterCta } = options;
  const margins = TRIM_MARGINS[options.trimSize || '5.5x8.5'];
  const sections: any[] = [];

  // ── Title Page ──
  const titlePageParas: any[] = [];
  for (let i = 0; i < 12; i++) titlePageParas.push(new Paragraph({ children: [] }));
  titlePageParas.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: title.toUpperCase(), bold: true, size: 52, font: 'Georgia' })],
    spacing: { after: 200 },
  }));
  if (subtitle) {
    titlePageParas.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: subtitle, italics: true, size: 28, font: 'Georgia' })],
      spacing: { after: 600 },
    }));
  }
  titlePageParas.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: author, size: 28, font: 'Georgia' })],
    spacing: { before: 400 },
  }));
  sections.push({ properties: { page: { margin: margins } }, children: titlePageParas });

  // ── Copyright Page ──
  const year = new Date().getFullYear();
  const copyrightText = copyright || `Copyright \u00A9 ${year} ${author}. All rights reserved.\n\nNo part of this publication may be reproduced, distributed, or transmitted in any form or by any means, including photocopying, recording, or other electronic or mechanical methods, without the prior written permission of the author.\n\nThis is a work of fiction. Names, characters, places, and incidents either are the product of the author's imagination or are used fictitiously.\n\nFirst Edition: ${year}\n\nISBN: [ISBN placeholder]`;
  const copyrightParas: any[] = [];
  for (let i = 0; i < 20; i++) copyrightParas.push(new Paragraph({ children: [] }));
  for (const line of copyrightText.split('\n')) {
    copyrightParas.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: line.trim(), size: 18, font: 'Georgia' })],
      spacing: { after: 100 },
    }));
  }
  sections.push({ properties: { type: SectionType.NEXT_PAGE, page: { margin: margins } }, children: copyrightParas });

  // ── Dedication ──
  if (dedication) {
    const dedicationParas: any[] = [];
    for (let i = 0; i < 12; i++) dedicationParas.push(new Paragraph({ children: [] }));
    dedicationParas.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: dedication, italics: true, size: 24, font: 'Georgia' })],
    }));
    sections.push({ properties: { type: SectionType.NEXT_PAGE, page: { margin: margins } }, children: dedicationParas });
  }

  // ── Main Content ──
  const mainParagraphs = parseMarkdownToDocx(content);
  sections.push({ properties: { type: SectionType.NEXT_PAGE, page: { margin: margins } }, children: mainParagraphs });

  // ── Back Matter ──
  const backMatter: any[] = [];
  if (authorBio) {
    backMatter.push(new Paragraph({ children: [new TextRun({ text: '', break: 1 })] }));
    backMatter.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'ABOUT THE AUTHOR', bold: true, size: 28, font: 'Georgia' })],
      spacing: { after: 400 },
    }));
    for (const line of authorBio.split('\n')) {
      backMatter.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: line.trim(), size: 22, font: 'Georgia' })],
        spacing: { after: 200 },
      }));
    }
  }
  if (alsoBy && alsoBy.length > 0) {
    backMatter.push(new Paragraph({ children: [] }));
    backMatter.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `ALSO BY ${author.toUpperCase()}`, bold: true, size: 28, font: 'Georgia' })],
      spacing: { after: 400 },
    }));
    for (const book of alsoBy) {
      backMatter.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: book, italics: true, size: 22, font: 'Georgia' })],
        spacing: { after: 100 },
      }));
    }
  }
  if (newsletterCta) {
    backMatter.push(new Paragraph({ children: [] }));
    backMatter.push(new Paragraph({ children: [] }));
    for (const line of newsletterCta.split('\n')) {
      backMatter.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: line.trim(), size: 22, font: 'Georgia' })],
        spacing: { after: 200 },
      }));
    }
  }
  if (backMatter.length > 0) {
    sections.push({ properties: { type: SectionType.NEXT_PAGE, page: { margin: margins } }, children: backMatter });
  }

  const doc = new Document({ creator: author, title, description: 'Generated by P.E.R.R.Y. System', sections });
  return (await Packer.toBuffer(doc)) as Buffer;
}

function parseMarkdownToDocx(content: string): any[] {
  const paragraphs: any[] = [];
  const lines = content.split('\n');
  let isFirstChapter = true;

  for (const line of lines) {
    if (line.match(/^#{1,2}\s/)) {
      const headingText = line.replace(/^#{1,2}\s+/, '');
      if (!isFirstChapter) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ break: 1, text: '' })], pageBreakBefore: true }));
      }
      isFirstChapter = false;
      for (let s = 0; s < 4; s++) paragraphs.push(new Paragraph({ children: [] }));
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: headingText.toUpperCase(), bold: true, size: 28, font: 'Georgia' })],
        spacing: { after: 600 },
      }));
      continue;
    }
    if (line.startsWith('### ')) {
      paragraphs.push(new Paragraph({ text: line.replace(/^### /, ''), heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } }));
      continue;
    }
    if (line.trim().match(/^(\*\s*\*\s*\*|~~~|---|\* \* \*)$/)) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: '* * *', size: 22, font: 'Georgia' })],
        spacing: { before: 400, after: 400 },
      }));
      continue;
    }
    if (line.trim() === '') {
      paragraphs.push(new Paragraph({ children: [], spacing: { after: 100 } }));
      continue;
    }
    const children = parseInlineFormatting(line);
    paragraphs.push(new Paragraph({ children, spacing: { after: 100, line: 276 }, indent: { firstLine: 360 } }));
  }
  return paragraphs;
}

function parseInlineFormatting(text: string): any[] {
  const children: any[] = [];
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      children.push(new TextRun({ text: part.slice(2, -2), bold: true, size: 22, font: 'Georgia' }));
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      children.push(new TextRun({ text: part.slice(1, -1), italics: true, size: 22, font: 'Georgia' }));
    } else if (part) {
      children.push(new TextRun({ text: part, size: 22, font: 'Georgia' }));
    }
  }
  return children;
}
