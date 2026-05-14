/**
 * @perry/export — EPUB3 Exporter
 *
 * Generates valid EPUB3 archives from markdown manuscript content.
 * Uses adm-zip to build the EPUB ZIP structure.
 *
 * Ported from V4 — standalone, no service dependencies.
 */

import AdmZip from 'adm-zip';

export interface EpubExportOptions {
  title: string;
  author: string;
  content: string;
  subtitle?: string;
  description?: string;
  language?: string;
  isbn?: string;
  authorBio?: string;
  coverImageBuffer?: Buffer;
}

interface Chapter {
  title: string;
  content: string;
  filename: string;
}

export async function generateEpubBuffer(options: EpubExportOptions): Promise<Buffer> {
  const {
    title, author, content, subtitle, description,
    language = 'en', isbn, authorBio, coverImageBuffer,
  } = options;

  const bookId = isbn || `perry-${Date.now()}`;
  const chapters = splitIntoChapters(content);
  const zip = new AdmZip();

  zip.addFile('mimetype', Buffer.from('application/epub+zip', 'utf-8'));

  zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`, 'utf-8'));

  const manifestItems = chapters.map((ch, i) =>
    `    <item id="chapter${i + 1}" href="${ch.filename}" media-type="application/xhtml+xml"/>`
  ).join('\n');
  const spineItems = chapters.map((_, i) =>
    `    <itemref idref="chapter${i + 1}"/>`
  ).join('\n');
  const coverManifest = coverImageBuffer
    ? '\n    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>'
    : '';

  zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(title)}${subtitle ? ': ' + escapeXml(subtitle) : ''}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${language}</dc:language>
    ${description ? `<dc:description>${escapeXml(description)}</dc:description>` : ''}
    <dc:date>${new Date().toISOString().split('T')[0]}</dc:date>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="style.css" media-type="text/css"/>${coverManifest}
${manifestItems}
    ${authorBio ? '<item id="about" href="about.xhtml" media-type="application/xhtml+xml"/>' : ''}
  </manifest>
  <spine>
${spineItems}
    ${authorBio ? '<itemref idref="about"/>' : ''}
  </spine>
</package>`, 'utf-8'));

  const tocItems = chapters.map(ch =>
    `      <li><a href="${ch.filename}">${escapeXml(ch.title)}</a></li>`
  ).join('\n');

  zip.addFile('OEBPS/nav.xhtml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escapeXml(title)} — Table of Contents</title><link rel="stylesheet" href="style.css" type="text/css"/></head>
<body>
  <nav epub:type="toc" id="toc"><h1>Table of Contents</h1><ol>
${tocItems}
  </ol></nav>
</body></html>`, 'utf-8'));

  zip.addFile('OEBPS/style.css', Buffer.from(`body{font-family:Georgia,'Times New Roman',serif;font-size:1em;line-height:1.6;margin:1em;color:#1a1a1a}
h1{font-size:1.8em;text-align:center;margin-top:3em;margin-bottom:1.5em;page-break-before:always;font-weight:bold;text-transform:uppercase;letter-spacing:.05em}
h1:first-of-type{page-break-before:avoid}
p{text-indent:1.5em;margin:0;text-align:justify}
p.first,p.scene-start{text-indent:0}
.scene-break{text-align:center;margin:1.5em 0;font-size:1.2em;letter-spacing:.3em}
.about-author{text-align:center;margin-top:2em}
.about-author h2{text-transform:uppercase;letter-spacing:.1em}`, 'utf-8'));

  for (const chapter of chapters) {
    const chapterHtml = markdownToXhtml(chapter.content);
    zip.addFile(`OEBPS/${chapter.filename}`, Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escapeXml(chapter.title)}</title><link rel="stylesheet" href="style.css" type="text/css"/></head>
<body><h1>${escapeXml(chapter.title)}</h1>
${chapterHtml}
</body></html>`, 'utf-8'));
  }

  if (authorBio) {
    zip.addFile('OEBPS/about.xhtml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml">
<head><title>About the Author</title><link rel="stylesheet" href="style.css" type="text/css"/></head>
<body><div class="about-author"><h2>About the Author</h2>
${authorBio.split('\n').map(line => `<p>${escapeXml(line.trim())}</p>`).join('\n')}
</div></body></html>`, 'utf-8'));
  }

  if (coverImageBuffer) {
    zip.addFile('OEBPS/images/cover.jpg', coverImageBuffer);
  }

  return zip.toBuffer();
}

function splitIntoChapters(content: string): Chapter[] {
  const chapters: Chapter[] = [];
  const lines = content.split('\n');
  let currentTitle = 'Untitled';
  let currentContent: string[] = [];
  let chapterNum = 0;

  for (const line of lines) {
    if (line.match(/^#{1,2}\s/)) {
      if (currentContent.length > 0 || chapterNum > 0) {
        chapterNum++;
        chapters.push({ title: currentTitle, content: currentContent.join('\n').trim(), filename: `chapter${chapterNum}.xhtml` });
      }
      currentTitle = line.replace(/^#{1,2}\s+/, '');
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0) {
    chapterNum++;
    chapters.push({ title: currentTitle, content: currentContent.join('\n').trim(), filename: `chapter${chapterNum}.xhtml` });
  }

  if (chapters.length === 0 && content.trim()) {
    chapters.push({ title: 'Chapter 1', content: content.trim(), filename: 'chapter1.xhtml' });
  }

  return chapters;
}

function markdownToXhtml(markdown: string): string {
  const lines = markdown.split('\n');
  const output: string[] = [];
  let isFirst = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') { isFirst = true; continue; }
    if (trimmed.match(/^(\*\s*\*\s*\*|~~~|---|\* \* \*)$/)) { output.push('  <p class="scene-break">* * *</p>'); isFirst = true; continue; }
    if (trimmed.startsWith('### ')) { output.push(`  <h3>${escapeXml(trimmed.replace(/^### /, ''))}</h3>`); isFirst = true; continue; }

    let html = escapeXml(trimmed);
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    output.push(`  <p${isFirst ? ' class="first"' : ''}>${html}</p>`);
    isFirst = false;
  }
  return output.join('\n');
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
