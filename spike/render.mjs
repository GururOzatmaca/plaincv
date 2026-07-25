// SPIKE 1a — prove react-pdf: embedded fonts, bold/italic runs, selectable + ordered text, page count.
// Throwaway. Not app code.
import React from 'react';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  Document, Page, Text, View, StyleSheet, Font, renderToBuffer,
} from '@react-pdf/renderer';

const h = React.createElement;
const DIR = import.meta.dirname;
const FONTS = path.join(DIR, '..', 'public', 'fonts');

// ---- one shared token object (also drives the HTML paper in 1b) ----
const tokens = {
  fontFamily: 'Serif',
  basePt: 10.5,
  lineHeight: 1.42,
  margin: 44,          // pt
  headingScale: 1.7,
  accent: '#0f766e',
  paperMuted: '#565c63',
};

// ---- embed fonts (regular / bold / italic / bold-italic) ----
Font.register({
  family: 'Serif',
  fonts: [
    { src: path.join(FONTS, 'LiberationSerif-Regular.ttf'), fontWeight: 'normal', fontStyle: 'normal' },
    { src: path.join(FONTS, 'LiberationSerif-Bold.ttf'), fontWeight: 'bold', fontStyle: 'normal' },
    { src: path.join(FONTS, 'LiberationSerif-Italic.ttf'), fontWeight: 'normal', fontStyle: 'italic' },
    { src: path.join(FONTS, 'LiberationSerif-BoldItalic.ttf'), fontWeight: 'bold', fontStyle: 'italic' },
  ],
});

const t = tokens;
const s = StyleSheet.create({
  page: {
    fontFamily: t.fontFamily, fontSize: t.basePt, lineHeight: t.lineHeight,
    color: '#171b1e', paddingTop: t.margin, paddingBottom: t.margin,
    paddingLeft: t.margin, paddingRight: t.margin,
  },
  h1: { fontSize: t.basePt * t.headingScale * 1.15, fontWeight: 'bold', marginBottom: 2 },
  title: { fontSize: t.basePt * 1.12, color: t.accent, fontWeight: 'bold', marginBottom: 5 },
  contact: { fontSize: t.basePt * 0.9, color: t.paperMuted },
  rule: { borderBottomWidth: 1.5, borderBottomColor: t.accent, marginTop: 10, marginBottom: 10 },
  secH: {
    fontSize: t.basePt * t.headingScale * 0.6, color: t.accent, fontWeight: 'bold',
    // ATS-safe: uppercase in the data, NO textTransform, NO letterSpacing (both split glyphs in extraction)
    textTransform: 'none', letterSpacing: 0, marginTop: 12, marginBottom: 6,
    borderBottomWidth: 1, borderBottomColor: t.accent, paddingBottom: 2,
  },
  entryTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  role: { fontWeight: 'bold' },
  co: { fontStyle: 'italic', color: t.paperMuted },
  date: { color: t.paperMuted, fontSize: t.basePt * 0.9 },
  bullet: { flexDirection: 'row', marginBottom: 2 },
  dot: { width: 10 },
  entry: { marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: {
    borderWidth: 1, borderColor: t.accent, borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 1, fontSize: t.basePt * 0.9,
  },
});

const Bullet = (children) => h(View, { style: s.bullet }, h(Text, { style: s.dot }, '•'), h(Text, {}, children));

const doc = h(Document, {},
  h(Page, { size: 'A4', style: s.page },
    // header
    h(Text, { style: s.h1 }, 'James Carter'),
    h(Text, { style: s.title }, 'Senior Backend Engineer'),
    h(Text, { style: s.contact }, 'London, UK  |  james.carter@example.com  |  +44 20 7946 0000  |  github.com/jcarter'),
    h(View, { style: s.rule }),

    // profile
    h(Text, { style: s.secH }, 'PROFILE'),
    h(Text, {}, 'Backend engineer with 7 years building payment and point-of-sale systems at scale. Focused on reliability, clean data models, and cutting infrastructure cost.'),

    // experience
    h(Text, { style: s.secH }, 'EXPERIENCE'),
    h(View, { style: s.entry },
      h(View, { style: s.entryTop },
        h(Text, {}, h(Text, { style: s.role }, 'Senior Backend Engineer'), '  ', h(Text, { style: s.co }, 'Northwind Systems')),
        h(Text, { style: s.date }, '2022 - Present'),
      ),
      // bold + bold-italic runs inside one bullet
      Bullet([
        'Led the ',
        h(Text, { key: 'b', style: { fontWeight: 'bold' } }, 'payment migration'),
        ' that cut checkout latency by ',
        h(Text, { key: 'bi', style: { fontWeight: 'bold', fontStyle: 'italic' } }, '40%'),
        '.',
      ]),
      Bullet('Designed a multi-tenant schema serving 3M+ transactions per day.'),
    ),
    h(View, { style: s.entry },
      h(View, { style: s.entryTop },
        h(Text, {}, h(Text, { style: s.role }, 'Backend Engineer'), '  ', h(Text, { style: s.co }, 'Brightline Labs')),
        h(Text, { style: s.date }, '2019 - 2022'),
      ),
      Bullet('Built an event pipeline (Kafka) replacing nightly batch jobs.'),
      Bullet('Cut cloud spend 28% through right-sizing and caching.'),
    ),

    // skills
    h(Text, { style: s.secH }, 'SKILLS'),
    h(View, { style: s.chips },
      ...['Go', 'Python', 'PostgreSQL', 'Kafka', 'AWS', 'Docker', 'Redis'].map((k, i) =>
        h(Text, { key: i, style: s.chip }, k)),
    ),
  ),
);

// ---- render ----
const t0 = Date.now();
const buffer = await renderToBuffer(doc);
const renderMs = Date.now() - t0;
const outPath = path.join(DIR, 'out.pdf');
fs.writeFileSync(outPath, buffer);

// ---- extract text back with pdfjs (ATS proxy: selectable + reading order) ----
const require = createRequire(import.meta.url);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

const data = new Uint8Array(buffer);
const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
const numPages = pdf.numPages;

let fullText = '';
for (let p = 1; p <= numPages; p++) {
  const page = await pdf.getPage(p);
  const content = await page.getTextContent();
  fullText += content.items.map((it) => it.str).join(' ') + '\n';
}

// ---- checks ----
const has = (str) => fullText.includes(str);
const idx = (str) => fullText.indexOf(str);
// order checked via non-tracked body words (headers are letter-spaced, see note below)
const ordered = idx('point-of-sale') < idx('Northwind') && idx('Northwind') < idx('PostgreSQL')
  && idx('PostgreSQL') !== -1;
// ATS caveat: letterSpacing on uppercase headers splits glyphs -> extracts as "P R O F I L E"
const headersClean = has('PROFILE') || has('Profile');

const checks = [
  ['PDF written', fs.existsSync(outPath)],
  ['1 page (numPages === 1)', numPages === 1],
  ['name present', has('James Carter')],
  ['bold run text present', has('payment migration')],
  ['bold-italic run text present', has('40%')],
  ['reading order body correct (profile<exp<skills)', ordered],
  ['skills extracted', has('PostgreSQL') && has('Kafka')],
];
const notes = [
  ['section headers extract cleanly (no letter-splitting)', headersClean],
];

console.log('\n===== SPIKE 1a RESULT =====');
console.log(`render time      : ${renderMs} ms`);
console.log(`pdf size         : ${(buffer.length / 1024).toFixed(1)} KB`);
console.log(`numPages         : ${numPages}`);
console.log(`file             : ${outPath}`);
console.log('\n--- checks ---');
let pass = true;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) pass = false; }
console.log('\n--- notes (non-blocking) ---');
for (const [name, ok] of notes) { console.log(`${ok ? 'ok  ' : 'WARN'}  ${name}`); }
console.log('\n--- extracted text (reading order) ---');
console.log(fullText.trim());
console.log(`\n===== ${pass ? 'ALL PASS' : 'SOME FAILED'} =====\n`);
process.exit(pass ? 0 : 1);
