import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

describe('MCP server', () => {
  const mcpServer = createServer();
  const client = new Client({ name: 'test', version: '0.0.0' });

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await mcpServer.close();
  });

  it('exposes planning tools and Playwright pairing prompts', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map(tool => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_layers',
        'discover_packages',
        'analyze_changes',
        'get_coverage',
        'coverage_gaps',
        'inventory_tests',
        'recommend_automation',
        'generate_test_plan',
        'generate_layer_brief',
        'generate_playwright_brief',
      ]),
    );

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map(p => p.name)).toEqual(
      expect.arrayContaining([
        'fill_automation_gaps',
        'playwright_from_coverage',
        'unit_from_coverage',
      ]),
    );

    const result = await client.callTool({ name: 'list_layers', arguments: { cwd: process.cwd() } });
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text) as { layers: Array<{ id: string; playwrightMcp: boolean }> };
    expect(parsed.layers.some(l => l.id === 'unit')).toBe(true);
    expect(parsed.layers.some(l => l.id === 'ui' && l.playwrightMcp)).toBe(true);
  });
});
