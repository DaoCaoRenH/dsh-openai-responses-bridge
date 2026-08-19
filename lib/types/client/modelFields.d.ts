import type { BridgeModelProfile } from '../types.ts';
/** A model row is the Bridge schema object, including Bridge-only capabilities. */
export type BridgeModelDraft = BridgeModelProfile;
export type ModelValidationKey = 'modelIdRequired' | 'modelIdDuplicate' | 'modelNameInvalid' | 'modelContextInvalid' | 'modelMaxTokensInvalid' | 'modelInputInvalid';
export interface BridgeModelsValidationFailure {
    index: number;
    key: ModelValidationKey;
}
/** Parse the same compact K/M capacity notation used by the native editor. */
export declare function parseCapacity(text: string): number | undefined;
/** Format a stored capacity without changing the underlying token count. */
export declare function formatCapacity(value: number): string;
/** Validate the model rows before the Bridge settings schema sees them. */
export declare function validateBridgeModels(value: readonly BridgeModelDraft[]): BridgeModelsValidationFailure | undefined;
