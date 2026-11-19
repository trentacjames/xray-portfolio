const test = require('node:test');
const assert = require('node:assert');
const { extractHoldings } = require('../src/extract/claude');

test('forces the schema tool and reads its result', async () => {
  let sent;
  const client = { messages: { create: async req => {
    sent = req;
    return { stop_reason: 'tool_use', usage: { input_tokens: 3000, output_tokens: 800 },
      content: [{ type: 'tool_use', name: 'record_statement', input: { platform: 'X', holdings: [{ name: 'A' }] } }] };
  } } };
  const out = await extractHoldings('statement text', { client, model: 'claude-haiku-5-5' });
  assert.deepEqual(sent.tool_choice, { type: 'tool', name: 'record_statement' });
  assert.match(sent.messages[0].content, /<statement_text>/);
  assert.equal(out.rows.length, 1);
  assert.equal(out.statement.platform, 'X');
  assert.ok(Math.abs(out.estCostUsd - 0.0007) < 1e-9);
});
