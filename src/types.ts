export interface AgoraPlugin {}

export interface Package {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: 'mcp' | 'prompt' | 'workflow' | 'skill';
  tags: string[];
  stars: number;
  installs: number;
  repository?: string;
  npmPackage?: string;
  createdAt: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  author: string;
  prompt: string;
  model?: string;
  tags: string[];
  stars: number;
  forks: number;
  createdAt: string;
}

export interface Discussion {
  id: string;
  title: string;
  author: string;
  content: string;
  category: 'question' | 'idea' | 'showcase' | 'discussion';
  replies: number;
  stars: number;
  createdAt: string;
}

export interface Tutorial {
  id: string;
  title: string;
  description: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  duration: string;
  steps: TutorialStep[];
}

export interface TutorialStep {
  title: string;
  content: string;
  code?: string;
}