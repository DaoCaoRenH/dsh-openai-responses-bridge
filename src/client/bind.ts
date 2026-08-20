import { useRef, useSyncExternalStore } from 'react'

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

type SnapshotSelectorHook<T> = <S>(
  selector: (snapshot: T) => S,
  equality?: (left: S, right: S) => boolean,
) => S

/** Bind a DSH snapshot source without depending on the retired web-react package. */
export function bindSnapshotSelector<T>(source: ObservableSnapshot<T>): SnapshotSelectorHook<T> {
  const subscribe = (listener: () => void): (() => void) => source.subscribe(listener)
  const getSnapshot = (): T => source.getSnapshot()

  return function useSelector<S>(selector: (snapshot: T) => S, equality?: (left: S, right: S) => boolean): S {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const selected = selector(snapshot)
    const cached = useRef<{ value: S } | undefined>(undefined)
    const equal = equality ?? Object.is

    if (cached.current === undefined || !equal(cached.current.value, selected)) {
      cached.current = { value: selected }
    }
    return cached.current.value
  }
}
