import type { Profile } from '@/types/profile'

export const profile: Profile = {
  name: 'Sidharth Sahoo',
  title: 'DevOps / MLOps / AIOps / SRE Engineer',
  currentCompany: 'Tiger Analytics',
  location: 'Bangalore, India',
  email: 'sidharth.backend@gmail.com',
  phone: '+91 8895825688',
  links: [
    { label: 'GitHub', url: 'https://github.com/sidharth971', icon: 'github' },
    { label: 'LinkedIn', url: 'https://linkedin.com/in/sidharth-973', icon: 'linkedin' },
    { label: 'Email', url: 'mailto:sidharth.backend@gmail.com', icon: 'mail' },
  ],
  summary:
    'Engineer with 4+ years of experience spanning full-stack application development and, more recently, DevOps, MLOps, AIOps and SRE practice. Started as an Application Developer building Python/Django REST APIs and React frontends on AWS, then moved into operating and scaling generative-AI and cloud-native systems — CI/CD pipelines, agentic RAG pipelines, and GenAI workloads on AWS Bedrock and ECS. Comfortable owning a system end to end, from the API to the pipeline that deploys and monitors it.',
  experience: [
    {
      id: 'tiger-analytics',
      company: 'Tiger Analytics',
      companyGroupId: 'tiger-analytics',
      title: 'DevOps / MLOps / AIOps / SRE Engineer',
      startDate: '2026-04-01',
      endDate: null,
      location: 'Bangalore, India',
      bullets: [],
      skills: ['DevOps', 'MLOps', 'AIOps', 'SRE', 'AWS'],
      isPlaceholder: true,
    },
    {
      id: 'aumovio-devops',
      company: 'Aumovio',
      companyGroupId: 'aumovio',
      title: 'DevOps / MLOps / AIOps / SRE Engineer',
      startDate: '2025-09-01',
      endDate: '2026-03-31',
      location: 'Bangalore, India',
      summary:
        'Continued the DevOps/MLOps/AIOps/SRE remit from Continental Automotive after its automotive division was spun off and renamed Aumovio.',
      bullets: [
        'Operated and supported GenAI workloads within the AWS Bedrock environment.',
        'Contributed to improving system efficiency by streamlining CI/CD and deployment processes.',
        'Assisted in resolving production issues, ensuring smooth operations for GenAI services.',
      ],
      skills: ['AWS Bedrock', 'ECS', 'Docker', 'Jenkins', 'CI/CD', 'PGVector'],
    },
    {
      id: 'continental-devops',
      company: 'Continental Automotive Components India Pvt Ltd',
      companyGroupId: 'continental',
      title: 'DevOps / MLOps / AIOps / SRE Engineer',
      startDate: '2023-12-01',
      endDate: '2025-09-30',
      location: 'Bangalore, India',
      summary:
        'Shifted focus from application development to operating GenAI and RAG systems in production — deployment, pipeline automation, and reliability of AI services.',
      bullets: [
        'Developed and operated FastAPI services powering GenAI applications.',
        'Built and integrated agentic RAG pipelines, using PGVector for embedding storage and retrieval.',
        'Deployed and managed GenAI workloads within the AWS Bedrock and ECS environment.',
        'Reduced deployment time by 40% by implementing CI/CD pipelines with Docker and Jenkins.',
      ],
      skills: ['FastAPI', 'Langchain', 'PGVector', 'AWS Bedrock', 'ECS', 'Docker', 'Jenkins', 'Agentic AI', 'MCP'],
    },
    {
      id: 'continental-appdev',
      company: 'Continental Automotive Components India Pvt Ltd',
      companyGroupId: 'continental',
      title: 'Application Developer',
      startDate: '2021-12-01',
      endDate: '2023-12-01',
      location: 'Bangalore, India',
      summary:
        'Started career building full-stack internal tools and REST APIs, with early hands-on AWS cloud deployment experience.',
      bullets: [
        'Developed full-stack applications using Python, Django, Flask, and FastAPI, focused on RESTful APIs.',
        'Designed and implemented responsive user interfaces with React.',
        'Managed relational databases including PostgreSQL and MySQL.',
        'Deployed applications on AWS (EC2, S3) and containerized services with Docker.',
        'Achieved 95% accuracy in data validation through automated testing.',
      ],
      skills: ['Python', 'Django', 'Flask', 'FastAPI', 'React', 'PostgreSQL', 'MySQL', 'Docker', 'AWS EC2', 'AWS S3'],
    },
  ],
  projects: [
    {
      id: 'maia-attesting',
      name: 'MAIA — Attesting',
      category: 'Generative AI',
      description:
        'A generative AI tool that automates test case and test script creation from user-uploaded requirements, cutting manual QA authoring time.',
      bullets: [
        'Built with Python and Langchain to power an AI-driven testing tool.',
        'Used PGVector for efficient embedding storage and retrieval.',
        'Deployed on AWS Bedrock and ECS with a React-based frontend.',
      ],
      relatedExperienceId: 'continental-devops',
      tags: ['Python', 'Langchain', 'PGVector', 'Agentic AI', 'MCP', 'AWS Bedrock', 'ECS', 'React'],
      period: 'Jan 2025 – Present',
    },
    {
      id: 'spares',
      name: 'Spares',
      category: 'Project Tracking Tool',
      description:
        'A project tracking tool for managing and visualizing project-related data and delivery pipelines.',
      bullets: [
        'Developed and exposed APIs using Flask for seamless data integration.',
        'Automated deployments on AWS EC2, enabling efficient delivery of data pipelines.',
      ],
      relatedExperienceId: 'continental-appdev',
      tags: ['Python', 'Django', 'FastAPI', 'MySQL', 'PostgreSQL', 'AWS EC2', 'ETL', 'Jenkins', 'Docker'],
      period: 'Dec 2021 – Oct 2025',
    },
    {
      id: 'emp-transfer',
      name: 'EMPTransfer',
      category: 'HR Tracking Tool',
      description:
        'A Django-based tool for the HR department that streamlined employee transfer and induction workflows.',
      bullets: [
        'Built a secure Django backend for HR workflows with authentication.',
        'Deployed the application on AWS EC2.',
        'Collaborated with stakeholders on features, testing, and documentation.',
      ],
      relatedExperienceId: 'continental-appdev',
      tags: ['Python', 'FastAPI', 'MySQL', 'React', 'Jenkins', 'Docker', 'AWS EC2'],
      period: 'Aug 2022 – May 2023',
    },
  ],
  skills: [
    { category: 'Languages', skills: ['Python', 'JavaScript', 'HTML', 'CSS', 'SQL'] },
    { category: 'Python', skills: ['Django', 'Flask', 'FastAPI', 'Automation'] },
    { category: 'Web Development', skills: ['React', 'REST APIs'] },
    { category: 'Generative AI', skills: ['Langchain', 'PGVector', 'AWS Bedrock', 'Agentic AI', 'MCP'] },
    { category: 'DevOps / MLOps / SRE', skills: ['CI/CD', 'Jenkins', 'Docker', 'ECS', 'IAM', 'Monitoring & Reliability'] },
    { category: 'Cloud & Data', skills: ['AWS', 'EC2', 'S3', 'Lambda', 'Data Pipelines', 'ETL', 'PostgreSQL', 'MySQL'] },
  ],
  certifications: [{ name: 'Certified Generative AI For Business Lead', year: '2023' }],
  education: [
    {
      institution: 'BPUT (Biju Patnaik University of Technology)',
      degree: 'B.Tech',
      field: 'Technology',
      year: '2021',
      location: 'Bhubaneswar, Odisha',
    },
  ],
  languages: ['English', 'Hindi', 'Odia'],
  honors: [{ title: 'Clapas Point', issuer: 'Aumovio', date: 'Dec 2025' }],
}
