import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  BRIDGE_SETTINGS_NS, initialProviderDraft, providerDraftFromProfile, providerEditOps,
  providerProfileFromDraft, validateProviderDraft,
} from './fields.ts'
import type { ProviderDraft } from './fields.ts'
import type { BridgeProviderProfile } from '../types.ts'
import type { BridgeApiProtocol } from '../types.ts'
import { BridgeModelListEditor } from './BridgeModelListEditor.tsx'
import type { BridgeModelDraft } from './modelFields.ts'
import type { BridgeKey } from './locales.ts'
import styles from './BridgeSection.module.css'

interface AddCustomProviderCardProps {
  namespace: SettingsNamespaceView
  existingRoutes: readonly string[]
  writable: boolean
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  t: (key: BridgeKey) => string
  mode?: 'create' | 'edit'
  route?: string
  profile?: BridgeProviderProfile
  credentialConfigured?: boolean
  onCancel: () => void
  onSaved: () => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setField<K extends keyof ProviderDraft>(
  setDraft: React.Dispatch<React.SetStateAction<ProviderDraft>>,
  key: K,
  value: ProviderDraft[K],
): void {
  setDraft(current => ({ ...current, [key]: value }))
}

/** Native-shaped creation card whose persistence seam is owned by the Bridge. */
export function AddCustomProviderCard({
  namespace, existingRoutes, writable, api, t, mode = 'create', route, profile: initialProfile, credentialConfigured = false, onCancel, onSaved,
}: AddCustomProviderCardProps): ReactNode {
  const editing = mode === 'edit'
  const [draft, setDraft] = useState<ProviderDraft>(() => (
    editing && initialProfile !== undefined && route !== undefined
      ? providerDraftFromProfile(route, initialProfile)
      : initialProviderDraft()
  ))
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [committed, setCommitted] = useState(false)
  const validation = useMemo(
    () => validateProviderDraft(draft, existingRoutes, { requireApiKey: !editing }),
    [draft, editing, existingRoutes],
  )
  const disabled = busy || !writable
  const profileDisabled = disabled || committed
  const existingProfile = editing ? initialProfile : undefined
  const title = editing ? t('edit') : t('add')
  const googleProtocol = draft.api === 'google-generative-ai'
  const validationVisible = validation !== undefined && (
    validation.field === 'route' && draft.route.trim().length > 0
    || validation.field === 'baseURL' && draft.baseURL.trim().length > 0
    || validation.field === 'apiKey' && draft.apiKey.trim().length > 0
    || validation.field === 'models' && draft.models.length > 0
  )

  const save = async (): Promise<void> => {
    if (disabled || validation !== undefined) return
    setBusy(true)
    setFailure(undefined)
    try {
      const draftProfile = providerProfileFromDraft(draft)
      if (!committed) {
        const response = await api.settings.mutate({
          ns: namespace.ns,
          ops: editing
            ? providerEditOps(draft.route.trim(), existingProfile!, draft)
            : [{
                op: 'set',
                path: ['providers', draft.route.trim()],
                value: draftProfile,
              }],
          expectedRevision: namespace.revision,
        })
        if (!response.result.ok) {
          setFailure(response.result.error.code === 'settings-conflict' ? t('conflict') : response.result.error.message)
          return
        }
        // A retry after credential failure must not repeat the settings write
        // with the now-stale revision or overwrite the route's unknown fields.
        setCommitted(true)
      }

      if (draft.apiKey.trim().length > 0) {
        const ref = editing
          ? existingProfile?.apiKeyEnv ?? draftProfile.apiKeyEnv
          : draftProfile.apiKeyEnv
        const stored = await api.credentials.set({ ref: ref!, value: draft.apiKey.trim() })
        if (!stored.result.ok) {
          setFailure(t('savedWithCredentialFailure').replace('{error}', stored.result.error.message))
          return
        }
      }
      onSaved()
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const changeModels = (models: BridgeModelDraft[]): void => { setField(setDraft, 'models', models) }
  const changeProtocol = (api: BridgeApiProtocol): void => {
    setDraft(current => ({
      ...current,
      api,
      ...api === 'google-generative-ai' ? { webSearch: false } : {},
    }))
  }

  return (
    <form
      className={styles['addCard']}
      onSubmit={(event) => { event.preventDefault(); void save() }}
      aria-label={title}
    >
      <div className={styles['editor']}>
        <div className={styles['editorHeader']}>
          <span className={styles['editorTitle']}>{title}</span>
          <span className={styles['editorRoute']}>{draft.route || t('custom')}</span>
        </div>

        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('providerId')}</span>
          <input
            className={styles['input']}
            type="text"
            value={draft.route}
            placeholder="acme-gateway"
            aria-label={t('providerId')}
            aria-describedby="bridge-provider-id-hint"
            disabled={profileDisabled || editing}
            onChange={(event) => { setField(setDraft, 'route', event.target.value) }}
            required
          />
          <span className={styles['advancedHint']} id="bridge-provider-id-hint">{t('providerIdHint')}</span>
        </label>

        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('displayName')}</span>
          <input
            className={styles['input']}
            type="text"
            value={draft.displayName}
            placeholder={draft.route || t('displayName')}
            aria-label={t('displayName')}
            disabled={profileDisabled}
            onChange={(event) => { setField(setDraft, 'displayName', event.target.value) }}
          />
        </label>

        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('baseURL')}</span>
          <input
            className={styles['input']}
            type="url"
            value={draft.baseURL}
            placeholder="https://gateway.example/v1"
            aria-label={t('baseURL')}
            aria-describedby="bridge-base-url-hint"
            disabled={profileDisabled}
            onChange={(event) => { setField(setDraft, 'baseURL', event.target.value) }}
            required
          />
          <span className={styles['advancedHint']} id="bridge-base-url-hint">{t(googleProtocol ? 'baseURLGoogleHint' : 'baseURLHint')}</span>
        </label>

        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('apiProtocol')}</span>
          <select
            className={styles['input']}
            value={draft.api}
            aria-label={t('apiProtocol')}
            aria-describedby="bridge-api-protocol-hint"
            disabled={profileDisabled}
            onChange={(event) => { changeProtocol(event.target.value as BridgeApiProtocol) }}
          >
            <option value="google-generative-ai">{t('apiProtocolGoogle')}</option>
            <option value="openai-responses">{t('apiProtocolOpenAI')}</option>
          </select>
          <span className={styles['advancedHint']} id="bridge-api-protocol-hint">
            {t(googleProtocol ? 'apiProtocolGoogleHint' : 'apiProtocolHint')}
          </span>
        </label>

        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('apiKey')}</span>
          <input
            className={styles['input']}
            type="password"
            value={draft.apiKey}
            autoComplete="new-password"
            placeholder="••••••••"
            aria-label={t('apiKey')}
            aria-describedby="bridge-api-key-hint"
            disabled={disabled}
            onChange={(event) => { setField(setDraft, 'apiKey', event.target.value) }}
            required={!editing}
          />
          <span className={styles['advancedHint']} id="bridge-api-key-hint">
            {editing ? t(credentialConfigured ? 'apiKeyEditConfiguredHint' : 'apiKeyEditMissingHint') : t('apiKeyHint')}
          </span>
        </label>

        <BridgeModelListEditor
          models={draft.models}
          onChange={changeModels}
          probe={{
            settingsNs: BRIDGE_SETTINGS_NS,
            baseURL: draft.baseURL,
            api: googleProtocol ? 'google-generative-ai' : 'openai-responses-bridge',
            ...draft.apiKey.trim().length === 0 ? {} : { apiKey: draft.apiKey },
          }}
          {...googleProtocol ? { probeBlocked: t('fetchModelsGoogleHint') } : {}}
          api={api}
          t={t}
          disabled={profileDisabled}
        />

        <label className={styles['switchRow']}>
          <input
            type="checkbox"
            checked={!googleProtocol && draft.webSearch}
            onChange={(event) => { setField(setDraft, 'webSearch', event.target.checked) }}
            disabled={profileDisabled || googleProtocol}
          />
          <span>
            <strong>{t('webSearch')}</strong>
            <small>{t(googleProtocol ? 'webSearchGoogleHint' : 'webSearchHint')}</small>
          </span>
        </label>

        {validationVisible ? <p className={styles['error']} role="alert" aria-live="polite">{validation.message}</p> : null}
        {failure === undefined ? null : <p className={styles['error']} role="alert">{failure}</p>}
        {!writable ? <p className={styles['notice']}>{t('readOnly')}</p> : null}

        <div className={styles['editorActions']}>
          <button type="button" className={styles['secondaryButton']} onClick={onCancel} disabled={busy}>{t('cancel')}</button>
          <button type="submit" className={styles['primaryButton']} disabled={disabled || validation !== undefined}>
            {busy ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </form>
  )
}
