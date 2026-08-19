import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId } from '@deepseek-ai/dsh-session'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { applyBridgeRequest } from '../src/compatibility.ts'
import { assertServiceable, Config } from '../src/config.ts'
import { HostedWebSearchObserver } from '../src/hosted-web-search/normalize.ts'
import {
  HOSTED_WEB_SEARCH_EVENT_TYPES,
  activeTurnStep,
  appendHostedWebSearchCheckpoint,
  registerHostedWebSearchSessionEvents,
} from '../src/hosted-web-search/session.ts'
import type { HostedWebSearchState } from '../src/hosted-web-search/events.ts'
import * as Bridge from '../src/index.ts'
import { resolveProfiles } from '../src/profiles.ts'

const servers: Array<ReturnType<typeof createServer>> = []

class MemorySettingsProvider extends SettingsProvider {
  readonly writable = true

  protected async load(): Promise<Record<string, unknown>> {
    return {}
  }

  protected async persist(): Promise<void> {}
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

function responseEvents(withReasoning = false): unknown[] {
  const reasoning = {
    type: 'reasoning',
    id: 'rs_1',
    summary: [{ type: 'summary_text', text: '思考内容' }],
    content: [],
    encrypted_content: 'encrypted-reasoning',
    status: 'completed',
  }
  const message = {
    type: 'message',
    id: 'msg_1',
    role: 'assistant',
    content: [{
      type: 'output_text',
      text: '回答内容',
      annotations: [{ type: 'url_citation', start_index: 0, end_index: 4, url: 'https://example.test/source', title: 'Example source' }],
    }],
    status: 'completed',
  }
  return [
    { type: 'response.created', response: { id: 'resp_1' } },
    ...(withReasoning ? [
      { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [], content: [] } },
      { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'rs_1', delta: '思考内容' },
      { type: 'response.output_item.done', output_index: 0, item: reasoning },
    ] : []),
    { type: 'response.output_item.added', output_index: withReasoning ? 1 : 0, item: { type: 'message', id: 'msg_1', role: 'assistant', content: [] } },
    { type: 'response.output_text.delta', output_index: withReasoning ? 1 : 0, item_id: 'msg_1', delta: '回答内容' },
    { type: 'response.output_item.done', output_index: withReasoning ? 1 : 0, item: message },
    {
      type: 'response.completed',
      response: {
        id: 'resp_1',
        status: 'completed',
        output: [
          ...(withReasoning ? [reasoning] : []),
          message,
          { type: 'web_search_call', id: 'search_1', status: 'completed', action: { type: 'search', query: 'DSH' , sources: [{ url: 'https://example.test/source', title: 'Example source' }] } },
        ],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      },
    },
  ]
}

async function mockResponses(withReasoning = false): Promise<{ url: string; body: (index?: number) => Promise<Record<string, unknown>> }> {
  const requestBodies: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requestBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
    for (const event of responseEvents(withReasoning)) response.write(`data: ${JSON.stringify(event)}\n\n`)
    response.end()
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    body: async (index = requestBodies.length - 1) => {
      for (let attempt = 0; attempt < 50 && requestBodies[index] === undefined; attempt += 1) await new Promise(resolve => setTimeout(resolve, 1))
      const requestBody = requestBodies[index]
      if (requestBody === undefined) throw new Error(`mock Responses request ${index} was not received`)
      return requestBody
    },
  }
}

async function mockGoogle(): Promise<{
  url: string
  request: () => { url: string | undefined; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> } | undefined
}> {
  let captured: { url: string | undefined; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> } | undefined
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    captured = {
      url: request.url,
      headers: request.headers,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
    response.write(`data: ${JSON.stringify({
      candidates: [{
        content: { role: 'model', parts: [{ text: 'Gemini response' }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
    })}\n\n`)
    response.end()
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}/v1beta`,
    request: () => captured,
  }
}

async function mockPrematureResponses(): Promise<{ url: string }> {
  const server = createServer(async (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
    for (const event of [
      { type: 'response.created', response: { id: 'resp_incomplete_stream' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'web_search_call', id: 'search_incomplete_stream', status: 'searching', action: { query: 'premature close' } },
      },
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`)
    // Deliberately close without response.completed/response.incomplete. The
    // native Pi parser must reject the response, while the Bridge observer
    // still emits a terminal failed checkpoint for the search card.
    response.end()
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${address.port}/v1` }
}

describe('native Responses payload delta', () => {
  it('removes only max_output_tokens and preserves other native fields', () => {
    const input = {
      model: 'm',
      max_output_tokens: 32,
      max_tokens: 16,
      client_metadata: { keep: false },
      parallel_tool_calls: false,
      text: { format: { type: 'text' }, verbosity: 'high' },
      reasoning: { effort: 'high', summary: 'detailed', context: 'last_turn' },
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
      include: ['web_search_call.action.sources'],
    }
    const output = applyBridgeRequest(input) as Record<string, unknown>
    expect(output).not.toBe(input)
    expect(input.max_output_tokens).toBe(32)
    expect(output).not.toHaveProperty('max_output_tokens')
    expect(output.max_tokens).toBe(16)
    expect(output.client_metadata).toEqual({ keep: false })
    expect(output.parallel_tool_calls).toBe(false)
    expect(output.text).toEqual({ format: { type: 'text' }, verbosity: 'high' })
    expect(output.text).not.toBe(input.text)
    expect(output.reasoning).toEqual({ effort: 'high', summary: 'detailed', context: 'last_turn' })
    expect(output.reasoning).not.toBe(input.reasoning)
    expect(output.tools).toEqual(input.tools)
    expect(output.tool_choice).toBe('auto')
    expect(output.include).toEqual(input.include)
  })

  it('does not add text when the payload does not contain a text object', () => {
    const output = applyBridgeRequest({
      model: 'bridge-model',
      input: [],
    }) as Record<string, unknown>

    expect(output).not.toHaveProperty('text')
  })

  it('adds the configured hosted web_search to an already native payload', () => {
    const output = applyBridgeRequest({
      model: 'm',
      input: [],
      tools: [
        { type: 'function', name: 'web_search', description: 'local executor' },
        { type: 'function', name: 'lookup' },
      ],
      reasoning: { effort: 'medium' },
      max_output_tokens: 32,
    }, {
      enabled: true,
      definitions: [{ type: 'web_search' }],
      toolChoice: 'auto',
    }) as Record<string, unknown>
    expect(output.max_output_tokens).toBeUndefined()
    expect(output.tools).toEqual([{ type: 'function', name: 'lookup' }, { type: 'web_search' }])
    expect(output.tool_choice).toBe('auto')
    expect(output.include).toEqual(['web_search_call.action.sources'])
    expect(output.reasoning).toEqual({ effort: 'medium' })
  })
})

describe('hosted Responses event normalization', () => {
  const options = {
    provider: 'gateway',
    model: 'bridge-model',
    turn: 4,
    step: 2,
  }

  function observe(events: readonly unknown[]): Array<{ kind: string; state: HostedWebSearchState }> {
    const checkpoints: Array<{ kind: string; state: HostedWebSearchState }> = []
    const observer = new HostedWebSearchObserver({
      ...options,
      onCheckpoint: (kind, state) => { checkpoints.push({ kind, state }) },
    })
    for (const event of events) observer.observe(event)
    return checkpoints
  }

  it('tracks searching, sources, citations, response id, and terminal completion', () => {
    const checkpoints = observe([
      { type: 'response.created', response: { id: 'resp_1' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'web_search_call', id: 'search_1', status: 'in_progress', action: { type: 'search', query: 'DeepSeek Harness' } },
      },
      { type: 'response.web_search_call.searching', call_id: 'search_1', action: { query: 'DeepSeek Harness' } },
      {
        type: 'response.output_text.annotation.added',
        output_index: 0,
        annotation: { type: 'url_citation', url: 'https://example.test/a', title: 'A', start_index: 0, end_index: 4 },
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'web_search_call',
          id: 'search_1',
          status: 'completed',
          action: { type: 'search', query: 'DeepSeek Harness', sources: [
            { url: 'https://example.test/a', title: 'A' },
            { url: 'file:///private', title: 'must be dropped' },
          ] },
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_1',
          status: 'completed',
          output: [{ type: 'web_search_call', id: 'search_1', status: 'completed', action: { type: 'search', query: 'DeepSeek Harness', sources: [{ url: 'https://example.test/a', title: 'A' }] } }],
        },
      },
    ])

    expect(checkpoints[0]).toMatchObject({ kind: 'start', state: { searchId: 'search_1', status: 'in_progress' } })
    const terminal = checkpoints.at(-1)
    expect(terminal).toMatchObject({
      kind: 'end',
      state: {
        responseId: 'resp_1',
        status: 'completed',
        queries: ['DeepSeek Harness'],
        sources: [{ url: 'https://example.test/a', title: 'A' }],
        citations: [{ url: 'https://example.test/a', title: 'A', startIndex: 0, endIndex: 4 }],
        turn: 4,
        step: 2,
      },
    })
    expect(checkpoints.filter(item => item.kind === 'end')).toHaveLength(1)
  })

  it('keeps separate search calls and deduplicates source/citation records', () => {
    const checkpoints = observe([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'web_search_call', id: 'search_1', action: { query: 'one', sources: [{ url: 'https://example.test/one' }] } } },
      { type: 'response.output_item.added', output_index: 1, item: { type: 'web_search_call', id: 'search_2', action: { query: 'two', sources: [{ url: 'https://example.test/two' }] } } },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'web_search_call', id: 'search_1', action: { query: 'one', sources: [{ url: 'https://example.test/one', title: 'One' }, { url: 'https://example.test/one' }] } } },
      { type: 'response.output_item.done', output_index: 1, item: { type: 'web_search_call', id: 'search_2', action: { query: 'two', sources: [{ url: 'https://example.test/two', title: 'Two' }] } } },
      { type: 'response.output_text.annotation.added', output_index: 0, annotation: { type: 'url_citation', url: 'https://example.test/one', title: 'One' } },
      { type: 'response.output_text.annotation.added', output_index: 0, annotation: { type: 'url_citation', url: 'https://example.test/one', title: 'One' } },
      { type: 'response.completed', response: { id: 'resp_multi', status: 'completed', output: [] } },
    ])

    const ended = checkpoints.filter(item => item.kind === 'end')
    expect(ended).toHaveLength(2)
    expect(ended.map(item => item.state.searchId)).toEqual(['search_1', 'search_2'])
    expect(ended[0]?.state.sources).toEqual([{ url: 'https://example.test/one' , title: 'One' }])
    expect(ended[0]?.state.citations).toEqual([{ url: 'https://example.test/one', title: 'One' }])
  })

  it('persists failed, aborted, and incomplete outcomes without throwing', () => {
    const failed: Array<{ kind: string; state: HostedWebSearchState }> = []
    const observer = new HostedWebSearchObserver({
      ...options,
      onCheckpoint: (kind, state) => { failed.push({ kind, state }) },
    })
    observer.observe({ type: 'response.output_item.added', output_index: 0, item: { type: 'web_search_call', id: 'failed_search', action: { query: 'failed' } } })
    observer.observe({ type: 'response.failed', response: { id: 'resp_failed', error: { code: 'bad_gateway', message: 'upstream unavailable' } } })
    observer.finish('aborted', { code: 'ABORTED', message: 'late abort must not duplicate end' })
    expect(failed.at(-1)).toMatchObject({ kind: 'end', state: { status: 'failed', error: { code: 'bad_gateway' } } })
    expect(failed.filter(item => item.kind === 'end')).toHaveLength(1)

    const incomplete: Array<{ kind: string; state: HostedWebSearchState }> = []
    const incompleteObserver = new HostedWebSearchObserver({
      ...options,
      onCheckpoint: (kind, state) => { incomplete.push({ kind, state }) },
    })
    incompleteObserver.observe({ type: 'response.output_item.added', output_index: 0, item: { type: 'web_search_call', id: 'incomplete_search', action: { query: 'incomplete' } } })
    incompleteObserver.observe({ type: 'response.incomplete', response: { id: 'resp_incomplete', status: 'incomplete', output: [] } })
    expect(incomplete.at(-1)).toMatchObject({ kind: 'end', state: { status: 'failed', error: { code: 'RESPONSE_INCOMPLETE' } } })

    const aborted: Array<{ kind: string; state: HostedWebSearchState }> = []
    const abortedObserver = new HostedWebSearchObserver({
      ...options,
      onCheckpoint: (kind, state) => { aborted.push({ kind, state }) },
    })
    abortedObserver.observe({ type: 'response.output_item.added', output_index: 0, item: { type: 'web_search_call', id: 'aborted_search', action: { query: 'aborted' } } })
    abortedObserver.finish('aborted', { code: 'ABORTED', message: 'cancelled' })
    expect(aborted.at(-1)).toMatchObject({ kind: 'end', state: { status: 'aborted', error: { code: 'ABORTED' } } })
  })
})

describe('hosted web_search session persistence', () => {
  it('registers ignorable event types and writes start/update/end checkpoints', () => {
    registerHostedWebSearchSessionEvents()
    expect([...KNOWN_SESSION_EVENT_TYPES]).toEqual(expect.arrayContaining([...HOSTED_WEB_SEARCH_EVENT_TYPES]))
    const session = Session.create(SessionId('bridge-hosted-search'))
    session.append('turn/start', { turn: 3 })
    session.append('step/start', { turn: 3, step: 1 })
    expect(activeTurnStep(session)).toEqual({ turn: 3, step: 1 })
    const state: HostedWebSearchState = {
      version: 1,
      searchId: 'search_1',
      turn: 3,
      step: 1,
      provider: 'gateway',
      model: 'bridge-model',
      status: 'in_progress',
      queries: ['DSH'],
      sources: [],
      citations: [],
    }
    expect(appendHostedWebSearchCheckpoint(session, 'bridge/hosted-web-search/start', state)).toBe(true)
    expect(appendHostedWebSearchCheckpoint(session, 'bridge/hosted-web-search/update', { ...state, status: 'searching' })).toBe(true)
    expect(appendHostedWebSearchCheckpoint(session, 'bridge/hosted-web-search/end', { ...state, status: 'completed' })).toBe(true)
    expect(session.events.slice(-3).map(event => event.type)).toEqual([
      'bridge/hosted-web-search/start',
      'bridge/hosted-web-search/update',
      'bridge/hosted-web-search/end',
    ])
    expect(Session.create(SessionId('bridge-hosted-search-replay'), session.events).events.slice(-2)[0]?.data).toMatchObject({ status: 'completed' })
  })
})

describe('settings safety boundary', () => {
  const base = {
    apiKeyEnv: 'BRIDGE_TEST_KEY',
    baseURL: 'https://example.test/v1',
    models: [{ id: 'm' }],
  }

  it('rejects executor-dependent hosted tools and unsafe image output', () => {
    expect(() => assertServiceable({ providers: { gateway: { ...base, hostedTools: { enabled: true, definitions: [{ type: 'shell' }] } } } })).toThrow(/executor/)
    expect(() => assertServiceable({ providers: { gateway: { ...base, hostedTools: { enabled: true, definitions: [{ type: 'image_generation' }], imageGeneration: { enabled: true } } } } })).toThrow(/output backend/)
  })

  it('materializes the fixed reasoning map for a model that omits it', () => {
    const resolved = Config({ providers: { gateway: base } })
    expect(resolved.providers?.gateway?.api).toBe('openai-responses')
    expect(resolved.providers?.gateway?.models?.[0]?.reasoningEfforts).toEqual({
      off: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    })
  })

  it('accepts Google Generative AI as a native route but rejects Responses hosted tools on it', () => {
    const google = Config({ providers: { google: {
      ...base,
      api: 'google-generative-ai',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    } } })
    expect(google.providers?.google?.api).toBe('google-generative-ai')
    expect(() => assertServiceable(google)).not.toThrow()
    expect(() => assertServiceable({ providers: {
      google: {
        ...google.providers!.google!,
        hostedTools: { enabled: true, definitions: [{ type: 'web_search' }] },
      },
    } })).toThrow(/only supported for the openai-responses protocol/)
  })
})

describe('Google native pi-ai route', () => {
  it('builds a google-generative-ai model without the Bridge Responses delta', () => {
    const profiles = resolveProfiles({ providers: {
      google: {
        api: 'google-generative-ai',
        apiKeyEnv: 'BRIDGE_TEST_KEY',
        baseURL: 'https://example.test/v1beta',
        models: [{ id: 'gemini-3.6-flash', input: ['text', 'image'] }],
      },
    } })
    const profile = profiles.get('google')!
    expect(profile.api).toBe('google-generative-ai')
    expect(profile.piProvider.getModels()[0]).toMatchObject({
      api: 'google-generative-ai',
      provider: 'google',
      id: 'gemini-3.6-flash',
      input: ['text', 'image'],
    })
  })

  it('sends a configured route through native Gemini generateContent streaming', async () => {
    vi.stubEnv('BRIDGE_TEST_KEY', 'test-key')
    const server = await mockGoogle()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Bridge, {
      providers: {
        google: {
          api: 'google-generative-ai',
          apiKeyEnv: 'BRIDGE_TEST_KEY',
          baseURL: server.url,
          reasoning: 'off',
          models: [{
            id: 'gemini-3.6-flash',
            input: ['text', 'image'],
            maxTokens: 8192,
            reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
          }],
        },
      },
    })
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: 'google',
      model: 'gemini-3.6-flash',
      system: 'native system',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hello Gemini' }], source: { kind: 'plugin', plugin: 'test' } })],
    })) assembler.push(chunk)
    const captured = server.request()
    if (captured === undefined) throw new Error(`Google request was not received; finish=${JSON.stringify(assembler.finish)} blocks=${JSON.stringify(assembler.blocks())}`)
    expect(captured?.url).toContain('/v1beta/models/gemini-3.6-flash:streamGenerateContent')
    expect(captured?.body.contents).toMatchObject([{ role: 'user', parts: [{ text: 'hello Gemini' }] }])
    expect(captured?.body).not.toHaveProperty('max_output_tokens')
    expect(captured?.body.systemInstruction).toMatchObject({ parts: [{ text: 'native system' }] })
    expect(captured?.body.generationConfig).toMatchObject({ maxOutputTokens: 8192 })
    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'Gemini response' }])
    await ctx.fiber.dispose()
  })
})

describe('DSH public adapter integration', () => {
  it('uses native Pi Responses conversion, removes max_output_tokens, and preserves replay', async () => {
    vi.stubEnv('BRIDGE_TEST_KEY', 'test-key')
    const server = await mockResponses(true)
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Bridge, {
      providers: {
        gateway: {
          apiKeyEnv: 'BRIDGE_TEST_KEY',
          baseURL: server.url,
          models: [{ id: 'bridge-model' }],
          hostedTools: { enabled: true, definitions: [{ type: 'web_search' }], toolChoice: 'auto' },
        },
      },
    })
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: 'gateway',
      model: 'bridge-model',
      maxTokens: 123,
      system: '原生系统提示词',
      tools: [{ name: 'web_search', description: 'local search', parameters: { type: 'object', properties: {} } }],
      messages: [createUserMessage({ content: [{ type: 'text', text: 'search' }], source: { kind: 'plugin', plugin: 'test' } })],
    })) assembler.push(chunk)
    const body = await server.body(0)
    expect(body.model).toBe('bridge-model')
    expect(body.max_output_tokens).toBeUndefined()
    expect(body.tools).toEqual([{ type: 'web_search' }])
    expect(body.tool_choice).toBe('auto')
    expect(body.include).toEqual(['web_search_call.action.sources'])
    expect((body.input as unknown[]).some(item => {
      const message = item as Record<string, unknown>
      return (message.role === 'developer' || message.role === 'system')
        && message.content === '原生系统提示词'
    })).toBe(true)
    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(assembler.blocks()).toEqual([
      { type: 'reasoning', text: '思考内容' },
      { type: 'text', text: '回答内容' },
    ])
    expect(assembler.replayState).toMatchObject({
      response: { kind: 'pi-ai', version: 2, api: 'openai-responses', provider: 'gateway', model: 'bridge-model' },
      blocks: [{ type: 'reasoning', thinkingSignature: expect.stringContaining('encrypted-reasoning') }, { type: 'text' }],
    })

    const assistant = assembler.message({
      kind: 'model',
      provider: 'gateway',
      model: 'bridge-model',
      replayState: assembler.replayState,
    })
    const nextAssembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: 'gateway',
      model: 'bridge-model',
      maxTokens: 123,
      messages: [
        createUserMessage({ content: [{ type: 'text', text: 'search' }], source: { kind: 'plugin', plugin: 'test' } }),
        assistant,
        createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'plugin', plugin: 'test' } }),
      ],
    })) nextAssembler.push(chunk)
    const secondBody = await server.body(1)
    expect(secondBody.max_output_tokens).toBeUndefined()
    expect((secondBody.input as unknown[]).some(item => (item as Record<string, unknown>).type === 'reasoning')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('keeps the local web_search function and does not add hosted definitions when hosted search is disabled', async () => {
    vi.stubEnv('BRIDGE_TEST_KEY', 'test-key')
    const server = await mockResponses(false)
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Bridge, {
      providers: {
        gateway: {
          apiKeyEnv: 'BRIDGE_TEST_KEY',
          baseURL: server.url,
          models: [{ id: 'bridge-model' }],
          hostedTools: { enabled: false, definitions: [{ type: 'web_search' }] },
        },
      },
    })
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: 'gateway',
      model: 'bridge-model',
      system: '原生系统提示词',
      tools: [{ name: 'web_search', description: 'local search', parameters: { type: 'object', properties: {} } }],
      messages: [createUserMessage({ content: [{ type: 'text', text: 'stable' }], source: { kind: 'plugin', plugin: 'test' } })],
    })) assembler.push(chunk)
    const body = await server.body(0)
    const input = body.input as unknown[]
    const systemMessages = input.filter(item => {
      const message = item as Record<string, unknown>
      return message.role === 'developer' || message.role === 'system'
    }) as Array<Record<string, unknown>>
    expect(systemMessages).toHaveLength(1)
    expect(systemMessages[0]?.content).toBe('原生系统提示词')
    expect(body.tools).toEqual([expect.objectContaining({ type: 'function', name: 'web_search' })])
    await ctx.fiber.dispose()
  })

  it('fails a hosted response when SSE closes before a terminal event', async () => {
    vi.stubEnv('BRIDGE_TEST_KEY', 'test-key')
    const server = await mockPrematureResponses()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Bridge, {
      providers: {
        gateway: {
          apiKeyEnv: 'BRIDGE_TEST_KEY',
          baseURL: server.url,
          models: [{ id: 'bridge-model' }],
          hostedTools: { enabled: true, definitions: [{ type: 'web_search' }] },
        },
      },
    })
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: 'gateway',
      model: 'bridge-model',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'premature' }], source: { kind: 'plugin', plugin: 'test' } })],
    })) assembler.push(chunk)
    expect(assembler.finish).toMatchObject({ kind: 'error' })
    await ctx.fiber.dispose()
  })

  it('registers and replaces routes when the live settings section changes', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MemorySettingsProvider)
    await ctx.plugin(Bridge)
    expect(ctx.llm.listProviders()).toEqual([])

    const settings = ctx.get('settings')!
    const bridgeNamespace = settingsNamespace('llm-openai-responses-bridge')
    const updates: unknown[][] = []
    ctx.on('settings/updated', (...args: unknown[]) => { updates.push(args) })
    await settings.update(bridgeNamespace, {
      providers: {
        gateway: {
          apiKeyEnv: 'BRIDGE_TEST_KEY',
          baseURL: 'https://example.test/v1',
          models: [{ id: 'bridge-model' }],
        },
      },
    })
    expect(settings.get(bridgeNamespace)).toMatchObject({ providers: { gateway: { baseURL: 'https://example.test/v1' } } })
    expect(updates).toHaveLength(1)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['gateway'])
    // Bridge routes are adapter-only so the native Models page does not join
    // them into its configurable-provider directory.
    expect(ctx.llm.listConfigurableProviders()).toEqual([])

    await settings.replace(bridgeNamespace, {})
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(ctx.llm.listProviders()).toEqual([])
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
    await ctx.fiber.dispose()
  })
})
