interface ObservableSnapshot<T> {
    getSnapshot(): T;
    subscribe(listener: () => void): () => void;
}
type SnapshotSelectorHook<T> = <S>(selector: (snapshot: T) => S, equality?: (left: S, right: S) => boolean) => S;
/** Bind a DSH snapshot source without depending on the retired web-react package. */
export declare function bindSnapshotSelector<T>(source: ObservableSnapshot<T>): SnapshotSelectorHook<T>;
export {};
