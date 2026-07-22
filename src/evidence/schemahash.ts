import { hashJson } from '../model/hash.js';

export interface ToolSchemaLike {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface CanonicalToolSchema {
  name: string;
  description: string;
  input_schema: unknown;
}

export interface ToolDescription {
  name: string;
  description: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function canonicalToolSchema(tool: ToolSchemaLike): CanonicalToolSchema {
  return {
    name: tool.name,
    description: normalizeWhitespace(tool.description ?? ''),
    input_schema: tool.inputSchema ?? null
  };
}

export function canonicalToolsList(tools: ReadonlyArray<ToolSchemaLike>): CanonicalToolSchema[] {
  return [...tools].map(canonicalToolSchema).sort((a, b) => a.name.localeCompare(b.name));
}

export function hashToolsList(tools: ReadonlyArray<ToolSchemaLike>): string {
  return hashJson(canonicalToolsList(tools));
}

export function hashToolSchema(tool: ToolSchemaLike): string {
  return hashJson(canonicalToolSchema(tool));
}

export function extractToolDescriptions(tools: ReadonlyArray<ToolSchemaLike>): ToolDescription[] {
  return canonicalToolsList(tools).map((tool) => ({
    name: tool.name,
    description: tool.description
  }));
}
