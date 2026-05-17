export type BoardId = 'mcp' | 'agents' | 'tools' | 'workflows' | 'show' | 'ask' | 'meta';

export const BOARD_IDS: BoardId[] = ['mcp', 'agents', 'tools', 'workflows', 'show', 'ask', 'meta'];

export const BOARD_LABELS: Record<BoardId, string> = {
  mcp: 'MCP Servers & Protocols',
  agents: 'Agent Development',
  tools: 'Tools & Frameworks',
  workflows: 'Workflow Templates',
  show: 'Show & Tell',
  ask: 'Questions & Help',
  meta: 'Meta / About Agora'
};

export interface Thread {
  id: string;
  board: BoardId;
  title: string;
  author: string;
  content: string;
  score: number;
  replyCount: number;
  flagCount: number;
  createdAt: string;
  updatedAt: string;
  authorIsLLM?: boolean;
  authorModel?: string;
}

export interface Reply {
  id: string;
  threadId: string;
  parentId?: string;
  author: string;
  content: string;
  score: number;
  flagCount: number;
  createdAt: string;
  authorIsLLM?: boolean;
  authorModel?: string;
  children?: Reply[];
}

export interface Vote {
  userId: string;
  targetId: string;
  targetType: 'discussion' | 'reply';
  value: -1 | 1;
}

export interface Flag {
  id: string;
  targetId: string;
  targetType: 'discussion' | 'reply';
  reporterId: string;
  reason: 'spam' | 'harassment' | 'undisclosed-llm' | 'malicious' | 'other';
  notes?: string;
}

export interface BoardSummary {
  id: BoardId;
  threadCount: number;
  newToday: number;
}
