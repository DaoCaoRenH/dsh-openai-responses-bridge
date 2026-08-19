import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as Bridge from '../src/index.ts'
import { discoverModels } from '../src/discovery.ts'

const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

async function modelServer(body: unknown): Promise<{ url: string; headers: () => Record<string, string | string[] | undefined> }> {
  let requestHeaders: Record<string, string | string[] | undefined> = {}
  const server = createServer((_request, response) => {
    requestHeaders = _request.headers
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    headers: () => requestHeaders,
  }
}

describe('Bridge model discovery', () => {
  it('uses the fixed Bridge protocol, sends the one-shot key, and maps OpenAI /models rows', async () => {
    const server = await modelServer({
      data: [
        { id: 'model-a', name: 'Model A', context_window: 131072, max_output_tokens: 32768 },
        { id: '', name: 'ignored' },
      ],
    })
    const models = await discoverModels({
      baseURL: server.url,
      api: 'openai-responses-bridge',
      apiKey: 'probe-key',
    })
    expect(models).toEqual([{
      id: 'model-a',
      name: 'Model A',
      contextWindow: 131072,
      maxTokens: 32768,
    }])
    expect(server.headers().authorization).toBe('Bearer probe-key')
  })

  it('accepts the common models fallback and rejects native protocol names', async () => {
    const server = await modelServer({ models: [{ id: 'fallback-model' }] })
    await expect(discoverModels({ baseURL: server.url, api: 'google-generative-ai' })).rejects.toThrow('enter models manually')
    await expect(discoverModels({ baseURL: server.url, api: 'openai-responses' })).rejects.toThrow('does not support protocol')
    await expect(discoverModels({ baseURL: server.url, api: 'openai-responses-bridge' })).resolves.toEqual([{ id: 'fallback-model' }])
  })

  it('is registered under the Bridge namespace without changing native protocol registration', async () => {
    const server = await modelServer({ data: [{ id: 'registered-model' }] })
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Bridge)
    await expect(ctx.llm.discoverModels('llm-openai-responses-bridge', {
      baseURL: server.url,
      api: 'openai-responses-bridge',
    })).resolves.toEqual([{ id: 'registered-model' }])
    await ctx.fiber.dispose()
  })
})
