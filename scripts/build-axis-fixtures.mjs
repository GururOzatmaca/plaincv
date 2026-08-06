/**
 * Rebuilds tests/axes/*.json.
 *
 * The shared fixtures in tests/fixtures carry no theme, so they only ever show a template's
 * defaults; these pin the corners of the design space a template never reaches on its own -
 * a cropped photo, chips as filled badges, a boxed heading, a date rail - for pdf-parity to
 * hold the exporter to. The photo is drawn here rather than committed as a separate asset so
 * the fixture stays one self-contained file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, findChrome, makeDie } from './lib/harness.mjs';

const die = makeDie({ needsCleanup: false });
const { chromium, chromePath } = await findChrome('build-axis-fixtures', die);
const browser = await chromium.launch({ executablePath: chromePath });
const page = await browser.newPage();
const photo = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = 200;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 300, 200);
  grad.addColorStop(0, '#2b6cb0');
  grad.addColorStop(1, '#f6ad55');
  g.fillStyle = grad;
  g.fillRect(0, 0, 300, 200);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(150, 100, 60, 0, Math.PI * 2);
  g.fill();
  // Bars top and bottom: a wrong crop shows up as one of them appearing or vanishing.
  g.fillStyle = '#1a202c';
  g.fillRect(0, 0, 300, 12);
  g.fillRect(0, 188, 300, 12);
  return c.toDataURL('image/jpeg', 0.82);
});
await browser.close();

const body = {
  header: {
    fullName: 'Renata Alvarez',
    title: 'Staff Data Engineer',
    contacts: [
      'renata.alvarez@example.com',
      '+34 611 900 244',
      'Valencia, Spain',
      'linkedin.com/in/renata-alvarez',
      'github.com/ralvarez',
    ],
    photo: { src: photo, zoom: 1.2, x: -4, y: 6 },
  },
  sections: [
    {
      type: 'profile',
      title: 'Profile',
      text: 'Data engineer who owns the warehouse that finance closes the books on, and the streaming layer three product teams build against.',
    },
    {
      type: 'experience',
      title: 'Experience',
      items: [
        {
          role: 'Staff Data Engineer',
          org: 'Meridian Retail',
          start: 'Mar 2021',
          end: 'Present',
          bullets: [
            'Rebuilt the nightly batch as an incremental dbt project, cutting the close from 6 hours to 40 minutes and making every model testable.',
            'Moved change capture onto Debezium and Kafka, ending the class of silent drift between the shop systems and the warehouse.',
          ],
        },
        {
          role: 'Data Engineer',
          org: 'Cadena Logistics',
          start: 'Jan 2018',
          end: 'Feb 2021',
          bullets: ['Owned the routing feature store behind a fleet of 900 vehicles, held to a 15 minute freshness budget.'],
        },
      ],
    },
    {
      type: 'skills',
      title: 'Skills',
      items: [
        { label: 'Languages', values: ['Python', 'SQL', 'Scala'] },
        { label: 'Platform', values: ['dbt', 'Airflow', 'Kafka', 'Snowflake'] },
        { label: 'Practices', values: ['Data contracts', 'Cost modelling'] },
      ],
    },
    {
      type: 'education',
      title: 'Education',
      items: [{ degree: 'BSc Computer Science', school: 'Universitat de Valencia', start: '2013', end: '2017', note: 'Distinction.' }],
    },
    {
      type: 'certifications',
      title: 'Certifications',
      items: [{ name: 'SnowPro Core', issuer: 'Snowflake', date: '2023' }],
    },
  ],
};

const cases = {
  'photo-badge': {
    templateId: 'banner',
    theme: {
      photo: true,
      photoShape: 'circle',
      photoSize: 26,
      headerLayout: 'photo',
      headingLayout: 'boxed',
      skillStyle: 'badge',
      dividers: true,
      accent: '#7c3aed',
      secondaryInk: 'soft',
    },
  },
  'rail-dates': {
    templateId: 'sharp',
    theme: {
      photo: true,
      photoShape: 'square',
      photoSize: 20,
      headerLayout: 'split',
      headingLayout: 'left-rail',
      entryLayout: 'date-rail',
      skillStyle: 'bullets',
      dividers: false,
      accent: '#b45309',
      marginXPt: 54,
    },
  },
  'plain-bare': {
    templateId: 'minimal',
    theme: {
      photo: false,
      headerLayout: 'centered',
      headingLayout: 'rule',
      skillStyle: 'plain',
      dividers: true,
      accent: '#0f766e',
      basePt: 11,
      lineHeight: 1.5,
    },
  },
};

const dir = join(ROOT, 'tests/axes');
mkdirSync(dir, { recursive: true });
for (const [name, extra] of Object.entries(cases)) {
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify({ name, ...extra, ...body }, null, 2)}\n`);
}
console.log(`wrote ${Object.keys(cases).length} axis fixtures to ${dir}`);
