import type { Resume } from './resume';
import { SCHEMA_VERSION } from './resume';
import { DEFAULT_THEME } from './factory';

// Seed document for a fresh session. Conforms to ResumeSchema.
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
      { id: 'c4', value: 'github.com/jcarter' },
    ],
  },
  sections: [
    // Present from the start so the Design panel's Skills control has something to
    // act on; without it the picker looks broken on a fresh session.
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
      id: 's_exp',
      type: 'experience',
      title: 'Experience',
      items: [
        {
          id: 'e1',
          role: 'Senior Backend Engineer',
          org: 'Northwind Systems',
          start: '2022',
          end: 'Present',
          bullets: [
            {
              id: 'b_e1_1',
              runs: [
                { text: 'Led the ' },
                { text: 'payment platform migration', b: true },
                { text: ', cutting checkout latency by ' },
                { text: '40%', b: true },
                { text: ' and reducing failed transactions by 18%.' },
              ],
            },
            { id: 'b_e1_2', runs: [{ text: 'Designed a multi-tenant PostgreSQL schema serving 3M+ transactions per day.' }] },
            { id: 'b_e1_3', runs: [{ text: 'Mentored 4 engineers and introduced trunk-based deploys, dropping release time from hours to minutes.' }] },
          ],
        },
        {
          id: 'e2',
          role: 'Backend Engineer',
          org: 'Brightline Labs',
          start: '2019',
          end: '2022',
          bullets: [
            { id: 'b_e2_1', runs: [{ text: 'Built an event pipeline (Kafka) replacing nightly batch jobs, cutting data lag from 12h to under 5 minutes.' }] },
            { id: 'b_e2_2', runs: [{ text: 'Reduced cloud spend 28% through right-sizing, caching, and query tuning.' }] },
            { id: 'b_e2_3', runs: [{ text: 'Shipped a public REST API adopted by 40+ partner integrations.' }] },
          ],
        },
        {
          id: 'e3',
          role: 'Junior Software Engineer',
          org: 'Halden Retail',
          start: '2017',
          end: '2019',
          bullets: [
            { id: 'b_e3_1', runs: [{ text: 'Automated inventory reconciliation, eliminating ~10 hours of manual work per week.' }] },
            { id: 'b_e3_2', runs: [{ text: 'Added end-to-end tests that cut production incidents by a third.' }] },
          ],
        },
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
