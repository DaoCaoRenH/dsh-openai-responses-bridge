import type {
  ClientRemote,
  CredentialInfo,
  LlmDiscoveredModel,
  LlmModelDiscoveryRequest,
  LlmProviderInfo,
  RemoteResult,
  SettingsDescribeValue,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'

export type {
  CredentialInfo,
  LlmDiscoveredModel,
  LlmModelDiscoveryRequest,
  LlmProviderInfo,
  RemoteResult,
  SettingsDescribeValue,
  SettingsNamespaceView,
  SettingsPathOpView,
}
export type { JsonValue } from '../types.ts'

export type BridgeRemoteResult<T> = RemoteResult<T>

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
