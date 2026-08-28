/**
 * Bridge adaptation of DSH's native model-list editor.
 *
 * The interaction is intentionally the same as the native CustomProviderCard:
 * model rows stay compact, advanced fields are disclosed per row, and model
 * discovery opens a picker instead of silently writing settings. The row type
 * is BridgeModelProfile, so Bridge input modalities are retained instead of
 * being reduced to pi-ai's generic record shape. Reasoning is not user-editable
 * here; every new model receives Bridge's fixed dispatch map.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { DEFAULT_REASONING_EFFORTS } from '../types.ts'
import type { BridgeModelProfile } from '../types.ts'
import { messageOf } from './store.ts'
import type { BridgeKey } from './locales.ts'
import { formatCapacity, parseCapacity } from './modelFields.ts'
import type { BridgeModelDraft } from './modelFields.ts'
import type { BridgeLlmRemote, LlmDiscoveredModel } from './remote.ts'
import styles from './BridgeSection.module.css'

export interface BridgeProbeTarget {
  settingsNs: string
  provider?: string
  baseURL?: string
  api?: string
  apiKey?: string
}

export interface BridgeModelListEditorProps {
  models: readonly BridgeModelDraft[]
  onChange: (models: BridgeModelDraft[]) => void
  probe: BridgeProbeTarget
  probeBlocked?: string
  api: Pick<{ llm: BridgeLlmRemote }, 'llm'>
  t: (key: BridgeKey) => string
  disabled: boolean
}

type CapacityField = 'contextWindow' | 'maxTokens'
type InputMode = 'text' | 'text-image'
type BridgeModelPatch = {
  [Key in keyof BridgeModelProfile]?: BridgeModelProfile[Key] | undefined
}

function textOf(model: BridgeModelDraft, key: 'id' | 'name'): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

function numberOf(model: BridgeModelDraft, key: CapacityField): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

function inputModeOf(model: BridgeModelDraft): InputMode {
  return model.input?.includes('image') === true ? 'text-image' : 'text'
}

function adopt(candidate: LlmDiscoveredModel): BridgeModelDraft {
  return {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    input: ['text'],
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
    reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS },
  }
}

function IconChevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    >
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconTrash(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

function IconPlus(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function keyFor(index: number, field: CapacityField): string {
  return `${String(index)}:${field}`
}

function reindexBuffers(current: ReadonlyMap<string, string>, removed: number): Map<string, string> {
  const next = new Map<string, string>()
  for (const [key, value] of current) {
    const index = Number(key.slice(0, key.indexOf(':')))
    if (index === removed) continue
    next.set(index > removed ? key.replace(/^\d+/u, String(index - 1)) : key, value)
  }
  return next
}

/** Render Bridge model rows and the OpenAI-compatible /models picker. */
export function BridgeModelListEditor({
  models, onChange, probe, probeBlocked, api, t, disabled,
}: BridgeModelListEditorProps): ReactNode {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly LlmDiscoveredModel[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(new Map())

  const patch = (index: number, next: BridgeModelPatch): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return { ...model }
      const copy: BridgeModelDraft = { ...model }
      for (const [key, value] of Object.entries(next)) {
        const clear = key !== 'id' && (value === undefined || value === '')
        if (clear) delete (copy as unknown as Record<string, unknown>)[key]
        else (copy as unknown as Record<string, unknown>)[key] = value
      }
      return copy
    }))
  }

  const editCapacity = (index: number, field: CapacityField, text: string): void => {
    setEditing(current => new Map(current).set(keyFor(index, field), text))
    patch(index, { [field]: parseCapacity(text) })
  }

  const capacityText = (model: BridgeModelDraft, index: number, field: CapacityField): string => {
    const typed = editing.get(keyFor(index, field))
    return typed ?? (numberOf(model, field) === undefined ? '' : formatCapacity(numberOf(model, field)!))
  }

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await api.llm.discoverModels(
        probe.settingsNs,
        {
          ...probe.provider === undefined ? {} : { provider: probe.provider },
          ...probe.baseURL === undefined || probe.baseURL.trim().length === 0 ? {} : { baseURL: probe.baseURL.trim() },
          ...probe.api === undefined ? {} : { api: probe.api },
          ...probe.apiKey === undefined || probe.apiKey.trim().length === 0 ? {} : { apiKey: probe.apiKey.trim() },
        },
      )
      if (!response.ok) {
        setFailure(response.error.message)
        return
      }
      if (response.value.length === 0) {
        setFailure(t('fetchEmpty'))
        return
      }
      const known = new Set(models.map(model => textOf(model, 'id')))
      setCandidates(response.value)
      setPicked(new Set(response.value.filter(model => !known.has(model.id)).map(model => model.id)))
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
  }

  const adoptPicked = (): void => {
    if (candidates === undefined) return
    const byId = new Map(models.map(model => [textOf(model, 'id'), model]))
    for (const candidate of candidates) {
      if (picked.has(candidate.id) && !byId.has(candidate.id)) byId.set(candidate.id, adopt(candidate))
    }
    onChange([...byId.values()])
    closePicker()
  }

  const remove = (index: number): void => {
    onChange(models.filter((_model, at) => at !== index))
    setExpanded(current => new Set([...current].filter(at => at !== index).map(at => at > index ? at - 1 : at)))
    setEditing(current => reindexBuffers(current, index))
  }

  const toggleExpanded = (index: number): void => {
    setExpanded(current => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  const askable = probe.baseURL !== undefined && probe.baseURL.trim().length > 0
  const fetchDisabled = disabled || busy || !askable || probeBlocked !== undefined

  return (
    <section className={styles['modelCatalog']} aria-label={t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{t('models')}</span>
          <span className={styles['modelCatalogMeta']}>{probeBlocked ?? t('modelsHint')}</span>
        </div>
        <button
          type="button"
          className={styles['linkButton']}
          disabled={fetchDisabled}
          title={probeBlocked ?? (askable ? undefined : t('fetchNeedsBaseUrl'))}
          onClick={() => { void fetchModels() }}
        >
          {busy ? t('fetching') : t('fetchModels')}
        </button>
      </div>

      {models.length === 0 ? <p className={styles['modelEmpty']}>{t('modelsEmpty')}</p> : null}
      <div className={styles['modelList']}>
        {models.map((model, index) => (
          <div key={index} className={styles['modelEntry']}>
            <div className={styles['modelRow']}>
              <input
                className={styles['input']}
                type="text"
                value={textOf(model, 'id')}
                placeholder={t('modelId')}
                aria-label={`${t('modelId')} ${index + 1}`}
                disabled={disabled}
                onChange={(event) => { patch(index, { id: event.target.value }) }}
                onBlur={(event) => { const trimmed = event.target.value.trim(); if (trimmed !== event.target.value) patch(index, { id: trimmed }) }}
              />
              <input
                className={styles['input']}
                type="text"
                value={textOf(model, 'name')}
                placeholder={t('modelName')}
                aria-label={`${t('modelName')} ${index + 1}`}
                disabled={disabled}
                onChange={(event) => { patch(index, { name: event.target.value }) }}
                onBlur={(event) => { if (event.target.value.trim() === '') patch(index, { name: undefined }) }}
              />
              <button
                type="button"
                className={styles['iconButton']}
                aria-label={`${t('modelAdvanced')} ${index + 1}`}
                aria-expanded={expanded.has(index)}
                title={t('modelAdvanced')}
                onClick={() => { toggleExpanded(index) }}
              >
                <IconChevron open={expanded.has(index)} />
              </button>
              <button
                type="button"
                className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
                aria-label={`${t('removeModel')} ${index + 1}`}
                title={t('removeModel')}
                disabled={disabled}
                onClick={() => { remove(index) }}
              >
                <IconTrash />
              </button>
            </div>

            {expanded.has(index)
              ? (
                <div className={styles['modelAdvanced']}>
                  <label className={styles['modelField']}>
                    <span className={styles['modelFieldLabel']}>{t('modelInput')}</span>
                    <select
                      className={styles['input']}
                      value={inputModeOf(model)}
                      disabled={disabled}
                      aria-label={`${t('modelInput')} ${index + 1}`}
                      onChange={(event) => { patch(index, { input: event.target.value === 'text-image' ? ['text', 'image'] : ['text'] }) }}
                    >
                      <option value="text">{t('textOnly')}</option>
                      <option value="text-image">{t('textImage')}</option>
                    </select>
                  </label>
                  <label className={styles['modelField']}>
                    <span className={styles['modelFieldLabel']}>{t('contextWindow')}</span>
                    <input
                      className={styles['input']}
                      type="text"
                      inputMode="numeric"
                      value={capacityText(model, index, 'contextWindow')}
                      placeholder="256K"
                      aria-label={`${t('contextWindow')} ${index + 1}`}
                      disabled={disabled}
                      onChange={(event) => { editCapacity(index, 'contextWindow', event.target.value) }}
                    />
                  </label>
                  <label className={styles['modelField']}>
                    <span className={styles['modelFieldLabel']}>{t('maxTokens')}</span>
                    <input
                      className={styles['input']}
                      type="text"
                      inputMode="numeric"
                      value={capacityText(model, index, 'maxTokens')}
                      placeholder="32K"
                      aria-label={`${t('maxTokens')} ${index + 1}`}
                      disabled={disabled}
                      onChange={(event) => { editCapacity(index, 'maxTokens', event.target.value) }}
                    />
                  </label>
                </div>
              )
              : null}
          </div>
        ))}
      </div>

      <button
        type="button"
        className={styles['addModelButton']}
        disabled={disabled}
        onClick={() => { onChange([...models, { id: '', input: ['text'], reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS } }]) }}
      >
        <IconPlus /> {t('addModel')}
      </button>
      {failure === undefined ? null : <p className={styles['error']} role="alert">{failure}</p>}

      <Modal
        open={candidates !== undefined}
        onClose={closePicker}
        title={t('fetchTitle')}
        closeLabel={t('close')}
        description={t('fetchDescription')}
        className={styles['fetchDialog'] as string}
        footer={(
          <>
            <Button variant="outline" onClick={closePicker}>{t('cancel')}</Button>
            <Button variant="outline" onClick={adoptPicked}>{t('fetchAdopt')}</Button>
          </>
        )}
      >
        <ul className={styles['candidateList']}>
          {(candidates ?? []).map(candidate => (
            <li key={candidate.id} className={styles['candidate']}>
              <label className={styles['candidateLabel']}>
                <input
                  type="checkbox"
                  checked={picked.has(candidate.id)}
                  onChange={() => { setPicked(current => { const next = new Set(current); if (!next.delete(candidate.id)) next.add(candidate.id); return next }) }}
                />
                <span className={styles['candidateId']}>{candidate.id}</span>
              </label>
            </li>
          ))}
        </ul>
      </Modal>
    </section>
  )
}
