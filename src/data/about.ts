// src/data/about.ts
// Monograph content for /about — kept here so the page is trivially editable.
// Roles, formation, credentials and selected work follow the 2026 CV.

export interface AboutLink {
  label: string;
  href: string;
}

export interface AboutEntry {
  title: string;
  place: string;
  years: string;
  note: string;
}

export interface AboutWork {
  title: string;
  venue: string;
  year?: string;
  /** Where the title itself links to. */
  href?: string;
  /** Extra links shown beneath the entry. */
  links?: AboutLink[];
}

export interface AboutContact {
  label: string;
  value: string;
  href?: string;
}

export const about = {
  /** One-line discipline statement shown under the page title. */
  discipline:
    'IB DP Physics · Computer Science · Theory of Knowledge — The Bermuda High School',

  position: [
    'I study teaching the way one studies a building: not for its finishes, but for what holds it up. The work on this site begins from four structures — a ring of chairs that learns to carry a question, a prompt that is left to buckle, a timed silence that becomes a floor, and a margin that becomes a room for two voices. In each, the point of interest is the same: the moment a load passes from the teacher to the room.',
    'I teach in seminar and workshop settings where that handoff can be observed and, when it works, repeated. The archive exists because teaching is mostly lost. A lesson that holds is documented nowhere unless someone writes it down, and the documents that usually survive — syllabi, rubrics, final grades — record the scaffolding and not the load. These pages are an attempt to keep the load.',
  ],

  lineage: [
    {
      name: 'Paulo Freire',
      taken: 'The teacher must not deposit knowledge but enter the circle as a co-inquirer; the empty chair belongs to the syllabus.',
    },
    {
      name: 'John Dewey',
      taken: 'An aim is a way of ordering activity rather than a fixed end; the prompt is the problem the students reconstruct.',
    },
    {
      name: 'bell hooks',
      taken: 'Silence is not absence but a different kind of presence; the room must learn to dwell in it before it can think in it.',
    },
    {
      name: 'Lev Vygotsky',
      taken: 'Development happens between what a learner can do alone and what they can do with a more capable other; the margin is that space.',
    },
  ],

  roles: [
    {
      title: 'Lead Physics, Computer Science & Theory of Knowledge Teacher',
      place: 'The Bermuda High School · Hamilton, Bermuda',
      years: '2020 — Present',
      note: 'IB DP Physics (HL & SL) through the 2025 syllabus, Edexcel IGCSE and International A-Level Physics, IB Theory of Knowledge, and Cambridge IGCSE and KS3 Computer Science. DP Physics cohorts hold a consistent ~5.0 mean, above IB global averages. Homeroom Advisor and Round Square / CAS mentor.',
    },
    {
      title: 'Secondary Physics & Computer Science Teacher',
      place: 'The English School of Kyrenia · Kyrenia, Northern Cyprus',
      years: '2018 — 2020',
      note: 'IB DP Physics (HL & SL), A-Level and IGCSE Physics, built around conceptual modelling, uncertainty and experimental inquiry; Key Stage 3 Computer Science. Founded the High School Robotics Club.',
    },
    {
      title: 'Founding Head of Physics & Head of Computer Science',
      place: 'Cakir High School · Bursa, Turkey',
      years: '2017 — 2018',
      note: "Built the Physics and Computer Science departments from inception and authored the DP Physics curriculum documentation behind the school's IB Diploma Programme authorization.",
    },
  ] satisfies AboutEntry[],

  formation: [
    {
      title: 'M.A. Curriculum & Instruction, with Teaching Certificate',
      place: 'Bilkent University · Ankara, Turkey',
      years: '2015 — 2017',
      note: 'An IBO-recognized (IBEC) programme taught in English. Clinical practicum at Bilkent Laboratory & International School, with PGCE seminars at the University of Cambridge Faculty of Education and a placement at The King’s School, Canterbury.',
    },
    {
      title: 'B.Sc. Physics',
      place: 'Anadolu University · Eskişehir, Turkey',
      years: '2007 — 2014',
      note: 'Classical mechanics, electromagnetism, quantum mechanics, thermodynamics, and mathematical methods in physics.',
    },
  ] satisfies AboutEntry[],

  credentials: [
    {
      title: 'IB Educator Certificate in Teaching and Learning (DP Physics)',
      issuer: 'International Baccalaureate Organization',
    },
    {
      title: 'Secondary Teaching License in Physics, Grades 9–12',
      issuer: 'Ministry of National Education, Turkey',
    },
    {
      title: 'IB DP Physics Workshop, Category 2',
      issuer: 'Florida Association of IB World Schools · Tampa, 2022',
    },
  ],

  writing: [
    {
      title:
        'An Action Research into a Hands-on Solar Energy Activity, Adapted to Enhance Students’ Understanding of Selected Physics Concepts and to Advance Their Awareness of Renewable Energy',
      venue: 'M.A. thesis · Bilkent University',
      year: '2017',
      href: 'https://hdl.handle.net/11693/33352',
    },
    {
      title: 'Interactive Dynamic Digital Physics Textbook',
      venue:
        'Open-access IB DP Physics platform — parameter-driven simulations, interactive visualizations, diagnostic formative questions',
      href: 'https://drive.google.com/file/d/1jnzcG96RYx9bdSJj7XrwGxepks7ffjwv/view',
      links: [
        {
          label: 'Curriculum design blueprint',
          href: 'https://drive.google.com/file/d/14xLE9Dlnmxvd06bEHOduhp_ARZ-F-Zqk/view',
        },
      ],
    },
    {
      title: 'Space Explorers',
      venue:
        'Gamified astrophysics module — stellar evolution, orbital mechanics and black holes through applied spacecraft physics',
      href: 'https://drive.google.com/file/d/1WoNZbxOdJYyu6BBijnyII6Rnz6Tk_lSV/view',
    },
    {
      title: 'Classroom Demonstrations',
      venue: 'Selected physics practicals, documented for students',
      links: [
        {
          label: 'Drone kinematics analysis',
          href: 'https://drive.google.com/file/d/1agQXe-qzJHDB2kK5eFeRZx8Jj7jxVm7g/view',
        },
        {
          label: 'Projectile motion analysis',
          href: 'https://drive.google.com/file/d/1Aj7VFp1dTsfciAV7nJpQgiH6Dttf5Ba0/view',
        },
        {
          label: 'Student worksheet',
          href: 'https://drive.google.com/file/d/1aYC1vMHo9TVV6944ZmlK36ASzgyD7rIB/view',
        },
        {
          label: 'Specific heat capacity lab',
          href: 'https://drive.google.com/file/d/1clNym2vE50W6LtjoW1n1al2e2cNhaLdV/view',
        },
      ],
    },
  ] satisfies AboutWork[],

  contact: [
    {
      label: 'Email',
      value: 'tugcanyildirim88@gmail.com',
      href: 'mailto:tugcanyildirim88@gmail.com',
    },
    { label: 'Based in', value: 'Bermuda' },
    { label: 'References', value: 'Dossier and references available on request' },
  ] satisfies AboutContact[],
};
