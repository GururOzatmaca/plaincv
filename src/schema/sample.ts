import type { Resume } from './resume';
import { SCHEMA_VERSION } from './resume';
import { DEFAULT_THEME } from './factory';

// Seed document for a fresh session. Conforms to ResumeSchema.
//
// This is the first thing every user sees and the document the whole product gets
// judged on, so it is written to recruiter conventions rather than to fill space:
// reverse chronological, an action verb opening every bullet, a number in almost
// every one, 2-3 bullets per role, and every bullet inside two printed lines.
//
// It is also the fixture `npm run ats-check` measures, so it deliberately carries the
// shapes that break PDF text extraction: month+year dates long enough to wrap the
// date rail, five contacts so the split header has to wrap, three skill groups with
// unequal label widths, a bold run inside a bullet, and education notes. Keep it
// fitting ONE page in the tightest template (Harvard: 11pt body, 52pt margins) if you
// change it.
export const sampleResume: Resume = {
  schemaVersion: SCHEMA_VERSION,
  id: 'cv_sample',
  name: 'Backend Engineer CV',
  templateId: 'classic',
  theme: { ...DEFAULT_THEME },
  header: {
    fullName: 'James Carter',
    title: 'Senior Backend Engineer',
    contacts: [
      { id: 'c1', value: 'London, UK' },
      { id: 'c2', value: 'james.carter@example.com' },
      { id: 'c3', value: '+44 20 7946 0000' },
      { id: 'c4', value: 'linkedin.com/in/jcarter' },
      { id: 'c5', value: 'github.com/jcarter' },
    ],
  },
  sections: [
    {
      id: 's_profile',
      type: 'profile',
      title: 'Profile',
      text: [
        {
          text: 'Backend engineer with 8 years on payment and data infrastructure. Led a payments platform migration that cut checkout latency 40%, and reduced cloud spend 28% across two teams.',
        },
      ],
    },
    {
      id: 's_exp',
      type: 'experience',
      title: 'Experience',
      items: [
        {
          id: 'e1',
          role: 'Senior Backend Engineer',
          org: 'Northwind Systems',
          start: 'Sep 2022',
          end: 'Present',
          bullets: [
            {
              id: 'b_e1_1',
              runs: [
                { text: 'Led the ' },
                { text: 'payment platform migration', b: true },
                { text: ', cutting checkout latency by ' },
                { text: '40%', b: true },
                { text: ' and failed transactions by 18%.' },
              ],
            },
            { id: 'b_e1_2', runs: [{ text: 'Designed a multi-tenant PostgreSQL schema serving 3M+ transactions per day.' }] },
            { id: 'b_e1_3', runs: [{ text: 'Mentored 4 engineers and introduced trunk-based deploys, cutting release time from hours to minutes.' }] },
          ],
        },
        {
          id: 'e2',
          role: 'Backend Engineer',
          org: 'Brightline Labs',
          start: 'Sep 2019',
          end: 'Mar 2022',
          bullets: [
            { id: 'b_e2_1', runs: [{ text: 'Built a Kafka event pipeline replacing nightly batch jobs, cutting data lag from 12h to under 5 minutes.' }] },
            { id: 'b_e2_2', runs: [{ text: 'Reduced cloud spend 28% through right-sizing, caching, and query tuning.' }] },
            { id: 'b_e2_3', runs: [{ text: 'Shipped a public REST API adopted by 40+ partner integrations.' }] },
          ],
        },
        {
          id: 'e3',
          role: 'Junior Software Engineer',
          org: 'Halden Retail',
          start: 'Jul 2017',
          end: 'Aug 2019',
          bullets: [
            { id: 'b_e3_1', runs: [{ text: 'Automated inventory reconciliation, removing 10 hours of manual work per week.' }] },
            { id: 'b_e3_2', runs: [{ text: 'Added end-to-end tests that cut production incidents by 33%.' }] },
          ],
        },
      ],
    },
    // Skills sits below Experience: a recruiter scans for evidence before a keyword
    // list. It is still present from the very first session, which is what the Design
    // panel's Skills control needs in order not to look broken.
    {
      id: 's_skills',
      type: 'skills',
      title: 'Skills',
      items: [
        { id: 'sk1', label: 'Languages', values: ['Go', 'Python', 'TypeScript', 'SQL'] },
        { id: 'sk2', label: 'Infrastructure', values: ['AWS', 'Kubernetes', 'Terraform', 'Kafka'] },
        { id: 'sk3', label: 'Data', values: ['PostgreSQL', 'Redis', 'ClickHouse'] },
      ],
    },
    {
      id: 's_edu',
      type: 'education',
      title: 'Education',
      items: [
        {
          id: 'ed1',
          degree: 'MSc Computer Science',
          school: 'University of Manchester',
          start: '2016',
          end: '2017',
          note: [{ text: 'Distinction. Thesis on distributed transaction consistency.' }],
        },
        {
          id: 'ed2',
          degree: 'BSc Software Engineering',
          school: 'University of Leeds',
          start: '2013',
          end: '2016',
          note: [{ text: 'First-class honours.' }],
        },
      ],
    },
  ],
};
