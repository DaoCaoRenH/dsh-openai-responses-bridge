import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { AddCustomProviderCard } from './AddCustomProviderCard.tsx'
import { deriveApiKeyRef, providerDeleteOps, webSearchOps, webSearchEnabled } from './fields.ts'
import type { BridgeProviderProfile } from '../types.ts'
import type { BridgeKey } from './locales.ts'
import { summaryOf } from './fields.ts'
import type { BridgeRemoteApi, CredentialInfo, SettingsNamespaceView } from './remote.ts'
import styles from './BridgeSection.module.css'

interface ProviderSummaryCardProps {
  route: string
  profile: BridgeProviderProfile
  credentialRef: string | undefined
  credential: CredentialInfo | undefined
  active: boolean
  namespace: SettingsNamespaceView
  writable: boolean
  api: BridgeRemoteApi
  t: (key: BridgeKey) => string
  onChanged: () => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Route summary with Bridge-owned edit, delete, and web_search actions. */
export function ProviderSummaryCard({
  route, profile, credentialRef, credential, active, namespace, writable, api, t, onChanged,
}: ProviderSummaryCardProps): ReactNode {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined)
  const summary = summaryOf(profile)
  const configured = credential?.configured === true
  const credentialLabel = credential?.writable === false
    ? t('credentialReadOnly')
    : configured ? t('credentialConfigured') : t('credentialMissing')
  const providerLabel = profile.displayName === undefined || profile.displayName === route
    ? route
    : `${profile.displayName} (${route})`
  const googleProtocol = profile.api === 'google-generative-ai'
  const protocolLabel = t(googleProtocol ? 'apiProtocolGoogle' : 'apiProtocolOpenAI')
  // Only credentials derived by this settings card are owned by the Bridge
  // delete action. Existing YAML credential references must remain intact.
  const managedCredentialRef = profile.apiKeyEnv === deriveApiKeyRef(route) && credential?.writable === true
    ? profile.apiKeyEnv
    : undefined

  if (editing) {
    return (
      <AddCustomProviderCard
        namespace={namespace}
        existingRoutes={[]}
        writable={writable}
        api={api}
        t={t}
        mode="edit"
        route={route}
        profile={profile}
        credentialConfigured={configured}
        onCancel={() => { setEditing(false) }}
        onSaved={() => { setEditing(false); onChanged() }}
      />
    )
  }
  const toggle = async (enabled: boolean): Promise<void> => {
    if (busy || deleting || !writable) return
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await api.settings.mutate(
        namespace.ns,
        webSearchOps(route, profile, enabled),
        namespace.revision,
      )
      if (!response.ok) {
        setFailure(response.error.code === 'settings-conflict' ? t('conflict') : response.error.message)
        return
      }
      onChanged()
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const openDelete = (): void => {
    if (busy || deleting || !writable) return
    setDeleteFailure(undefined)
    setDeleteOpen(true)
  }

  const closeDelete = (): void => {
    if (deleting) return
    setDeleteOpen(false)
    setDeleteFailure(undefined)
  }

  const confirmDelete = async (): Promise<void> => {
    if (busy || deleting || !writable) return
    setDeleting(true)
    setDeleteFailure(undefined)
    try {
      // Match DSH's native removal semantics: remove a card-owned credential
      // first, while leaving YAML/external credential references untouched.
      if (managedCredentialRef !== undefined) {
        const credential = await api.credentials.unset(managedCredentialRef)
        if (!credential.ok) {
          setDeleteFailure(credential.error.message)
          return
        }
      }
      const response = await api.settings.mutate(
        namespace.ns,
        providerDeleteOps(route),
        namespace.revision,
      )
      if (!response.ok) {
        setDeleteFailure(response.error.code === 'settings-conflict' ? t('conflict') : response.error.message)
        return
      }
      setDeleteOpen(false)
      onChanged()
    } catch (error) {
      setDeleteFailure(messageOf(error))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <article className={styles['providerCard']} aria-label={`${profile.displayName ?? route} (${route})`}>
      <div className={styles['cardHeader']}>
        <div className={styles['providerIdentity']}>
          <span className={`${styles['statusDot']} ${active ? styles['statusDotActive'] : styles['statusDotDormant']}`} aria-hidden="true" />
          <div>
            <h3 className={styles['cardTitle']}>{profile.displayName ?? route}</h3>
            <p className={styles['cardSubtitle']}><code>{route}</code> · {protocolLabel}</p>
          </div>
        </div>
        <span className={styles['badge']}>{t('custom')}</span>
      </div>

      <dl className={styles['summaryGrid']}>
        <div><dt>{t('baseURL')}</dt><dd title={summary.baseURL}>{summary.baseURL || '—'}</dd></div>
        <div><dt>{t('modelId')}</dt><dd>{summary.model}</dd></div>
        <div><dt>{t('apiKey')}</dt><dd>{credentialLabel}</dd></div>
      </dl>

      <div className={styles['cardFooter']}>
        <span className={styles['stateText']}>
          {active ? t('active') : t('dormant')} · {credentialLabel}
        </span>
        <button
          type="button"
          className={styles['secondaryButton']}
          onClick={() => { setEditing(true) }}
          disabled={busy || deleting || !writable}
        >
          {t('edit')}
        </button>
        <button
          type="button"
          className={styles['dangerButton']}
          onClick={openDelete}
          disabled={busy || deleting || !writable}
          aria-label={`${t('delete')}: ${route}`}
        >
          {t('delete')}
        </button>
        {googleProtocol
          ? <span className={styles['stateText']} title={t('webSearchGoogleHint')}>{t('webSearchUnavailable')}</span>
          : (
              <label className={styles['switchControl']}>
                <input
                  type="checkbox"
                  checked={webSearchEnabled(profile)}
                  onChange={(event) => { void toggle(event.target.checked) }}
                  disabled={busy || deleting || !writable}
                  aria-label={`${t('webSearch')}: ${route}`}
                />
                <span>{busy ? t('toggleSaving') : t('webSearch')}</span>
              </label>
            )}
      </div>
      {failure === undefined ? null : <p className={styles['error']} role="alert">{failure}</p>}
      {credentialRef === undefined ? <p className={styles['notice']}>{t('noCredential')}</p> : null}
      <Modal
        open={deleteOpen}
        onClose={closeDelete}
        title={t('deleteTitle').replace('{provider}', providerLabel)}
        closeLabel={t('close')}
        description={(managedCredentialRef === undefined ? t('deleteDescription') : t('deleteDescriptionWithCredential')).replace('{provider}', providerLabel)}
        className={styles['deleteDialog'] as string}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={closeDelete}>{t('cancel')}</Button>
            <Button
              variant="outline"
              className={styles['deleteConfirm']}
              disabled={deleting}
              onClick={() => { void confirmDelete() }}
            >
              {(deleting ? t('deleting') : t('deleteConfirm')).replace('{provider}', providerLabel)}
            </Button>
          </>
        )}
      >
        {deleteFailure === undefined ? null : <p className={styles['error']} role="alert">{deleteFailure}</p>}
      </Modal>
    </article>
  )
}
