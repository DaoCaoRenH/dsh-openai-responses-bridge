import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AddCustomProviderCard } from './AddCustomProviderCard.tsx'
import { ProviderSummaryCard } from './ProviderSummaryCard.tsx'
import type { BridgeKey } from './locales.ts'
import type { BridgeSettingsState, BridgeSettingsStore } from './store.ts'
import type { BridgeRemoteApi } from './remote.ts'
import styles from './BridgeSection.module.css'

export interface BridgeSectionInjected {
  controller: BridgeSettingsStore
  useSnapshot: <T>(selector: (state: BridgeSettingsState) => T) => T
  api: BridgeRemoteApi
  t: (key: BridgeKey) => string
}

export type BridgeSectionProps = Partial<BridgeSectionInjected>

/** Standalone settings section; it never renders inside native ModelsSection. */
export function BridgeSection(props: BridgeSectionProps): ReactNode {
  const { controller, useSnapshot, api, t } = props
  if (controller === undefined || useSnapshot === undefined || api === undefined || t === undefined) return null
  return <Loaded controller={controller} useSnapshot={useSnapshot} api={api} t={t} />
}

function Loaded({ controller, useSnapshot, api, t }: BridgeSectionInjected): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  if (state.status === 'idle' || state.status === 'loading') {
    return <section className={styles['section']} aria-busy="true"><p className={styles['loading']}>{t('loading')}</p></section>
  }

  if (state.status === 'error') {
    return (
      <section className={styles['section']}>
        <p className={styles['error']} role="alert">{`${t('loadFailed')}: ${state.error ?? ''}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>{t('retry')}</button>
      </section>
    )
  }

  if (state.status === 'missing' || state.namespace === undefined) {
    return (
      <section className={styles['section']}>
        <h2 className={styles['sectionTitle']}>{t('title')}</h2>
        <p className={styles['intro']}>{t('namespaceMissing')}</p>
      </section>
    )
  }

  const routeIds = state.routes.map(route => route.route)
  return (
    <section className={styles['section']} aria-labelledby="bridge-section-title">
      <header className={styles['sectionHeader']}>
        <div>
          <h2 id="bridge-section-title" className={styles['sectionTitle']}>{t('title')}</h2>
          <p className={styles['intro']}>{t('intro')}</p>
        </div>
      </header>

      {state.routes.length === 0 && !adding
        ? <p className={styles['empty']}>{t('empty')}</p>
        : null}
      {state.routes.length > 0
        ? (
          <div className={styles['providerList']} aria-label={t('added')}>
            {state.routes.map(row => (
              <ProviderSummaryCard
                key={row.route}
                {...row}
                namespace={state.namespace!}
                writable={state.writable}
                api={api}
                t={t}
                onChanged={() => { void controller.load() }}
              />
            ))}
          </div>
        )
        : null}

      {adding
        ? (
          <AddCustomProviderCard
            namespace={state.namespace}
            existingRoutes={routeIds}
            writable={state.writable}
            api={api}
            t={t}
            onCancel={() => { setAdding(false) }}
            onSaved={() => { setAdding(false); void controller.load() }}
          />
        )
        : (
          <button
            type="button"
            className={styles['addButton']}
            onClick={() => { setAdding(true) }}
            disabled={!state.writable}
          >
            <span aria-hidden="true">＋</span> {t('add')}
          </button>
        )}
      {!state.writable ? <p className={styles['notice']}>{t('readOnly')}</p> : null}
    </section>
  )
}
