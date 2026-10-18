// Минимальный генератор .docx без библиотек: собираем OOXML и упаковываем в ZIP (без сжатия).
// Блоки: { t: 'title'|'h'|'p'|'center'|'right'|'li'|'gap'|'sign', text, bold }

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function run(text, bold) {
  const parts = String(text ?? '').split('\n');
  return parts.map((p, i) =>
    `${i ? '<w:r><w:br/></w:r>' : ''}<w:r><w:rPr>${bold ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(p)}</w:t></w:r>`
  ).join('');
}

function para(block) {
  const { t, text, bold } = block;
  if (t === 'gap') return '<w:p/>';
  if (t === 'sign') {
    // Две колонки подписей через табуляцию
    const [left, right] = text;
    return `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="5100"/></w:tabs><w:spacing w:before="240"/></w:pPr>${run(left)}<w:r><w:tab/></w:r>${run(right)}</w:p>`;
  }
  const jc = { title: 'center', center: 'center', right: 'right', h: 'left', p: 'both', li: 'both' }[t] || 'both';
  const size = t === 'title' ? '<w:sz w:val="28"/>' : '';
  const spacing = t === 'h' ? '<w:spacing w:before="200" w:after="80"/>' : '<w:spacing w:after="80"/>';
  const ind = t === 'p' || t === 'li' ? '<w:ind w:firstLine="567"/>' : '';
  const isBold = bold || t === 'title' || t === 'h';
  const content = String(text ?? '').split('\n').map((p, i) =>
    `${i ? '<w:r><w:br/></w:r>' : ''}<w:r><w:rPr>${isBold ? '<w:b/>' : ''}${size}</w:rPr><w:t xml:space="preserve">${esc(p)}</w:t></w:r>`).join('');
  return `<w:p><w:pPr><w:jc w:val="${jc}"/>${spacing}${ind}</w:pPr>${content}</w:p>`;
}

export function documentXml(blocks) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${blocks.map(para).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

// --- ZIP (метод store) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files) {
  const enc = new TextEncoder();
  const chunks = []; const central = []; let offset = 0;
  for (const [name, content] of files) {
    const nameB = enc.encode(name);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, 0, true); local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, nameB.length, true); local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameB, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true); cen.setUint16(12, 0, true); cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameB.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

/** Собирает .docx и возвращает байты */
export function buildDocx(blocks) {
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', RELS],
    ['word/_rels/document.xml.rels', DOC_RELS],
    ['word/document.xml', documentXml(blocks)],
    ['word/styles.xml', STYLES],
  ]);
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
