import { useState } from 'react'
import {
  DisclosureRow,
  IconSearchOutline16,
  StateDot,
  WebBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WebBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostedWebSearchChatData } from './HostedWebSearchDefinition.ts'
import css from './HostedWebSearchCard.module.css'

function statusLabel(status: HostedWebSearchChatData['status']): string {
  if (status === 'completed') return '搜索完成'
  if (status === 'failed') return '搜索失败'
  if (status === 'aborted') return '搜索已中断'
  if (status === 'searching') return '正在搜索'
  return '搜索中'
}

function sourceViews(data: HostedWebSearchChatData): Array<{
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}> {
  const result = data.sources.map(source => ({
    url: source.url,
    ...source.title === undefined ? {} : { title: source.title },
    ...source.snippet === undefined ? {} : { snippet: source.snippet },
    ...source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt },
  }))
  const seen = new Set(result.map(source => source.url))
  for (const citation of data.citations) {
    if (seen.has(citation.url)) continue
    seen.add(citation.url)
    result.push({
      url: citation.url,
      ...citation.title === undefined ? {} : { title: citation.title },
      ...citation.quotedText === undefined ? {} : { snippet: citation.quotedText },
    })
  }
  return result
}

export function HostedWebSearchCard({ data, labels }: { data: HostedWebSearchChatData; labels: WebBlockLabels }) {
  const [open, setOpen] = useState(false)
  const sources = sourceViews(data)
  const query = data.queries.at(-1)
  const expandable = sources.length > 0 || data.error !== undefined || data.status !== 'in_progress'
  return (
    <div className={css.root} data-hosted-web-search data-status={data.status}>
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={data.status === 'in_progress' || data.status === 'searching'
          ? <StateDot state="ongoing" />
          : <IconSearchOutline16 size={14} />}
        title="Web Search OpenAI"
        open={open}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setOpen(value => !value) }}
        collapsedContent={(
          <>
            {query !== undefined && (
              <>
                <span className={css.separator} aria-hidden />
                <span className={css.summary}>{query}</span>
              </>
            )}
            <span className={css.separator} aria-hidden />
            <span className={css.status}>{statusLabel(data.status)}</span>
            {sources.length > 0 && (
              <>
                <span className={css.separator} aria-hidden />
                <span className={css.status}>{sources.length} 个来源</span>
              </>
            )}
          </>
        )}
      >
        <div className={css.body}>
          <div className={css.meta}>{data.provider} · {data.model}</div>
          <WebBlock kind="search" labels={labels} sources={sources} truncated={data.truncated === true} />
          {data.error !== undefined && <p className={css.error}>{data.error.message}</p>}
        </div>
      </DisclosureRow>
    </div>
  )
}
