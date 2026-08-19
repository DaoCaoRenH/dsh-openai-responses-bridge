/** Browser half of the independent OpenAI third-party-model settings plugin. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export declare const inject: string[];
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'settings.openai-responses-bridge': import('./locales.ts').BridgeKey;
    }
}
/** Register the standalone section and keep it converged with Host invalidations. */
export declare function apply(ctx: ClientContext): void;
declare const _default: {
    inject: string[];
    apply: typeof apply;
};
export default _default;
