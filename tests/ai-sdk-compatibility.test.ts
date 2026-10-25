import { expect, it } from 'vitest'
import { generateText, stepCountIs, tool } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
}

it('round-trips a validated Zod 4 tool call through the real SDK loop', async () => {
  const inputs: unknown[] = []
  const model = new MockLanguageModelV3({ doGenerate: [
    { content: [{ type: 'tool-call', toolCallId: 'read-1', toolName: 'readStatus', input: '{"caseId":"demo"}' }],
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] },
    { content: [{ type: 'text', text: 'The case passed.' }],
      finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] },
  ] })
  const result = await generateText({ model, prompt: 'Read the demo case status.', stopWhen: stepCountIs(2),
    tools: { readStatus: tool({ inputSchema: z.object({ caseId: z.string().min(1) }).strict(),
      execute: async input => { inputs.push(input); return { status: 'passed' } },
    }) },
  })
  expect(inputs).toEqual([{ caseId: 'demo' }])
  expect(result.text).toBe('The case passed.')
  expect(result.steps).toHaveLength(2)
  expect(result.steps[0]?.toolResults[0]).toMatchObject({ toolCallId: 'read-1', output: { status: 'passed' } })
  expect(model.doGenerateCalls[1]?.prompt).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: 'tool', content: expect.arrayContaining([
      expect.objectContaining({ type: 'tool-result', toolCallId: 'read-1', output: { type: 'json', value: { status: 'passed' } } }),
    ]) }),
  ]))
})

it('rejects invalid model tool arguments before executing a host callback', async () => {
  let executions = 0
  const model = new MockLanguageModelV3({ doGenerate: {
    content: [{ type: 'tool-call', toolCallId: 'bad-1', toolName: 'readStatus', input: '{"caseId":42}' }],
    finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [],
  } })
  const result = await generateText({ model, prompt: 'Read a case status.',
    tools: { readStatus: tool({ inputSchema: z.object({ caseId: z.string() }).strict(),
      execute: async () => { executions += 1; return { status: 'passed' } },
    }) },
  })
  expect(executions).toBe(0)
  expect(result.toolCalls[0]).toMatchObject({ toolCallId: 'bad-1', invalid: true })
})
