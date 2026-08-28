import type {
  ClientRemote,
  ClientResult,
  CredentialInfo,
  JsonValue,
  LlmDiscoveredModel,
  LlmModelDiscoveryRequest,
  LlmProviderInfo,
  SettingsDescribeValue,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'

export type {
  ClientResult,
  CredentialInfo,
  JsonValue,
  LlmDiscoveredModel,
  LlmModelDiscoveryRequest,
  LlmProviderInfo,
  SettingsDescribeValue,
  SettingsNamespaceView,
  SettingsPathOpView,
}

export type BridgeRemoteResult<T> = ClientResult<T>

export type BridgeSettingsRemote = Pick<
  ClientRemote['settings'],
  'describe' | 'mutate'
>

export type BridgeCredentialsRemote = Pick<
  ClientRemote['credentials'],
  'describe' | 'set' | 'unset'
>

export type BridgeLlmRemote = Pick<
  ClientRemote['llm'],
  'listProviders' | 'discoverModels'
>

export type BridgeRemoteApi = Pick<
  ClientRemote,
  'settings' | 'credentials' | 'llm'
>
