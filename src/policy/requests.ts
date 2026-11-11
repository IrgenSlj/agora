// Session-log events as Cedar requests (schema: defaults/agora.cedarschema).

import type { AgentEvent } from '../events/schema.js';

export type AgentAction = 'read' | 'write' | 'exec' | 'connect' | 'call';

export interface CedarRequest {
  action: AgentAction;
  principal: { type: 'Agent'; id: string };
  resource: { type: 'File' | 'Program' | 'Peer' | 'Tool'; id: string };
  /** Entities the request needs: the principal and the resource. */
  entities: { uid: { type: string; id: string }; attrs: Record<string, unknown>; parents: [] }[];
}

export interface ToolFacts {
  /** Revocation status per MCP server name, when it was looked up. */
  revoked?: (server: string) => boolean | undefined;
}

/** The request for one event, or undefined for events no policy governs. */
export function requestFor(
  event: Pick<AgentEvent, 'host' | 'kind' | 'subject'>,
  facts: ToolFacts = {}
): CedarRequest | undefined {
  const principal = { type: 'Agent' as const, id: event.host };
  const agent = { uid: principal, attrs: { host: event.host }, parents: [] as [] };
  const make = (
    action: AgentAction,
    type: CedarRequest['resource']['type'],
    attrs: Record<string, unknown>
  ): CedarRequest => {
    const resource = { type, id: event.subject };
    return {
      action,
      principal,
      resource,
      entities: [agent, { uid: resource, attrs, parents: [] }]
    };
  };

  switch (event.kind) {
    case 'file_read':
    case 'file_write': {
      const cls = event.subject.startsWith('class:')
        ? event.subject.slice('class:'.length)
        : 'repo';
      return make(event.kind === 'file_read' ? 'read' : 'write', 'File', {
        path: event.subject,
        class: cls
      });
    }
    case 'exec':
      return make('exec', 'Program', { name: event.subject });
    case 'net': {
      const i = event.subject.lastIndexOf(':');
      const port = i > 0 ? Number(event.subject.slice(i + 1)) : Number.NaN;
      const host = i > 0 && Number.isInteger(port) ? event.subject.slice(0, i) : event.subject;
      return make('connect', 'Peer', { host, port: Number.isInteger(port) ? port : 0 });
    }
    case 'tool_call': {
      const mcp = /^mcp:([^/]+)\/(.+)$/.exec(event.subject);
      if (mcp) {
        const server = mcp[1] as string;
        const revoked = facts.revoked?.(server);
        return make('call', 'Tool', {
          name: mcp[2],
          server,
          mcp: true,
          ...(revoked === undefined ? {} : { revoked })
        });
      }
      const name = event.subject.startsWith('tool:') ? event.subject.slice(5) : event.subject;
      return make('call', 'Tool', { name, server: '', mcp: false });
    }
    default:
      return undefined;
  }
}
