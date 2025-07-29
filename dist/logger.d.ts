export declare const logger: import("pino").Logger<never>;
export declare const logBanner: (title: string) => void;
export declare const logSection: (message: string) => void;
export declare const logSuccess: (message: string, details?: Record<string, unknown>) => void;
export declare const logError: (message: string, error?: Error | unknown) => void;
export declare const logInfo: (icon: string, message: string, details?: Record<string, unknown>) => void;
export default logger;
//# sourceMappingURL=logger.d.ts.map