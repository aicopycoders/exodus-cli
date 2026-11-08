export declare function hasBinary(name: string): boolean;
export declare function probeDurationSec(filePath: string): number | null;
export interface KeySyncResult {
    pulled: string[];
    failed: string[];
    error?: string;
}
export declare function syncKeysToEnv(): Promise<KeySyncResult>;
export interface RequiredKey {
    label: string;
    anyOf: string[];
}
export declare const PIXAR_REQUIRED_KEYS: RequiredKey[];
export declare const PIXAR_MUX_ENV_VARS: string[];
type Env = Record<string, string | undefined>;
export declare function missingRequiredKeys(env: Env, required?: RequiredKey[]): string[];
export declare function missingRequiredEnvVars(env: Env, required?: RequiredKey[]): string[];
export declare function muxConfigured(env: Env): boolean;
export {};
