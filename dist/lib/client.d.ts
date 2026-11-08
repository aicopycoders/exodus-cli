export interface ApiResponse<T> {
    ok: boolean;
    status: number;
    data: T;
}
export declare function getApiUrl(): string;
export declare function apiGet<T>(path: string, opts?: {
    skipActiveBrand?: boolean;
    activeBrandOverride?: string;
}): Promise<ApiResponse<T>>;
export declare function apiGetText(path: string, opts?: {
    skipActiveBrand?: boolean;
    activeBrandOverride?: string;
}): Promise<ApiResponse<string>>;
export declare function apiPost<T>(path: string, body: unknown, opts?: {
    ccCommand?: string;
}): Promise<ApiResponse<T>>;
export declare function resolveDashboardUrl(opts: {
    override?: string;
    apiUrl?: string;
}): string;
export declare function getDashboardUrl(): string;
export declare function apiGetDashboard<T>(path: string, opts?: {
    timeoutMs?: number;
    activeBrandOverride?: string;
}): Promise<ApiResponse<T>>;
export declare function apiPostDashboard<T>(path: string, body: unknown, opts?: {
    timeoutMs?: number;
    activeBrandOverride?: string;
}): Promise<ApiResponse<T>>;
export declare function apiDeleteDashboard<T>(path: string): Promise<ApiResponse<T>>;
