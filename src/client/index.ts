/** Browser half of the independent OpenAI third-party-model settings plugin. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { bindSnapshotSelector } from './bind.ts'
import { BridgeSection } from './BridgeSection.tsx'
import type { BridgeSectionInjected } from './BridgeSection.tsx'
import { registerHostedWebSearchConversationNode } from './HostedWebSearchNode.tsx'
import { BridgeSettingsStore, refreshIfLoaded } from './store.ts'
import { en, zh } from './locales.ts'
import type { BridgeRemoteApi } from './remote.ts'

const COPY_NS = 'settings.openai-responses-bridge'

export const inject = [
  'slots', 'locale', 'remote', 'remote.credentials', 'remote.llm', 'remote.settings', 'uiConversation',
]

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.openai-responses-bridge': import('./locales.ts').BridgeKey
  }
}

/** Register the standalone section and keep it converged with Host invalidations. */
export function apply(ctx: ClientContext): void {
  registerHostedWebSearchConversationNode(ctx)
  ctx.effect(() => ctx.locale.register(COPY_NS, { zh, en }), 'openai-responses-bridge: copy dictionaries')
  const remote = ctx.remote as unknown as BridgeRemoteApi
  const controller = new BridgeSettingsStore(remote)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const t = ctx.locale.bind(COPY_NS) as BridgeSectionInjected['t']
  const injected = (): BridgeSectionInjected => ({
    controller,
    useSnapshot,
    api: remote,
    t,
  })

  ctx.effect(() => {
    const refresh = (): void => { refreshIfLoaded(controller) }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns === 'llm-openai-responses-bridge') refresh()
      }),
      ctx.remote.$on('credentials/reference-updated', refresh),
      ctx.remote.$on('llm/adapters-updated', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'openai-responses-bridge: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'openai-responses-bridge',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, BridgeSection))
}

export default { inject, apply }
