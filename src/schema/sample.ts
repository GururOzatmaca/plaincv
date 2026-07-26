import type { Resume } from './resume';
import { SCHEMA_VERSION } from './resume';
import { DEFAULT_THEME } from './factory';

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
          text: 'Backend engineer with ten years on payment and data infrastructure, most of it in small teams that own what they ship. Currently owns a payments platform handling 3M+ transactions a day at 99.98% availability.',
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
                { text: ', cutting checkout latency ' },
                { text: '40%', b: true },
                { text: '.' },
              ],
            },
            { id: 'b_e1_2', runs: [{ text: 'Designed a multi-tenant PostgreSQL schema serving 3M+ transactions per day.' }] },
            { id: 'b_e1_3', runs: [{ text: 'Cut on-call pages 60% with SLO alerting and load-shedding on the payments API.' }] },
          ],
        },
        {
          id: 'e2',
          role: 'Backend Engineer',
          org: 'Brightline Labs',
          start: 'Sep 2019',
          end: 'Aug 2022',
          bullets: [
            { id: 'b_e2_1', runs: [{ text: 'Built a Kafka event pipeline replacing nightly batch jobs, 12h data lag to 5 minutes.' }] },
            { id: 'b_e2_2', runs: [{ text: 'Reduced cloud spend 28% through right-sizing, caching and query tuning.' }] },
            { id: 'b_e2_3', runs: [{ text: 'Shipped a public REST API adopted by 40+ partner integrations.' }] },
          ],
        },
        {
          id: 'e3',
          role: 'Software Engineer',
          org: 'Halden Retail',
          start: 'Jul 2017',
          end: 'Aug 2019',
          bullets: [
            { id: 'b_e3_1', runs: [{ text: 'Automated inventory reconciliation, removing 10 hours of manual work per week.' }] },
            { id: 'b_e3_2', runs: [{ text: 'Added end-to-end tests to the checkout flow, cutting production incidents 33%.' }] },
          ],
        },
      ],
    },

    {
      id: 's_skills',
      type: 'skills',
      title: 'Skills',
      items: [
        { id: 'sk1', label: 'Languages', values: ['Go', 'Python', 'TypeScript', 'SQL'] },
        { id: 'sk2', label: 'Infrastructure', values: ['AWS', 'Kubernetes', 'Terraform', 'Kafka'] },
        { id: 'sk3', label: 'Data', values: ['PostgreSQL', 'Redis', 'ClickHouse'] },
        { id: 'sk4', label: 'Practices', values: ['CI/CD', 'Observability', 'Load testing', 'Incident response'] },
      ],
    },
    {
      id: 's_edu',
      type: 'education',
      title: 'Education',
      items: [
        {
          id: 'ed2',
          degree: 'BSc Software Engineering',
          school: 'University of Leeds',
          start: '2011',
          end: '2014',
        },
      ],
    },
    {
      id: 's_cert',
      type: 'certifications',
      title: 'Certifications',
      items: [
        { id: 'ct1', name: 'AWS Certified Solutions Architect (Associate)', issuer: 'Amazon Web Services', date: '2024' },
        { id: 'ct2', name: 'Certified Kubernetes Administrator', issuer: 'The Linux Foundation', date: '2022' },
      ],
    },
  ],
};
