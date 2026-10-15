import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";

declare global {
    namespace Express {
        interface Request {
            isClientCancelled?: () => boolean;
            cancelSignal?: AbortSignal;
        }
    }
}

/**
 * Middleware to track client request lifecycle and cancellation.
 * When a client disconnects or aborts (e.g. mobile app cancels previous HTTP request on rapid month switching),
 * this middleware flags the request and provides cancellation helpers.
 */
export const cancelContextMiddleware = (req: Request, res: Response, next: NextFunction) => {
    let isCancelled = false;
    const controller = new AbortController();
    req.cancelSignal = controller.signal;

    const onAbort = () => {
        if (!res.writableEnded && !res.headersSent) {
            isCancelled = true;
            controller.abort();
            logger.info(`[CancelContext] Request aborted by client: ${req.method} ${req.originalUrl}`);
        }
    };

    req.on("close", () => {
        if (!res.writableEnded && !res.headersSent) {
            onAbort();
        }
    });

    req.on("aborted", onAbort);

    req.isClientCancelled = () => {
        return isCancelled || req.destroyed || Boolean((req as any).signal?.aborted) || res.writableEnded || res.headersSent;
    };

    res.on("finish", () => {
        req.off("close", onAbort);
        req.off("aborted", onAbort);
    });

    next();
};

export const isRequestCancelled = (req: Request, res?: Response): boolean => {
    if (req.isClientCancelled && req.isClientCancelled()) {
        return true;
    }
    if (req.destroyed || Boolean((req as any).signal?.aborted)) {
        return true;
    }
    if (res && (res.writableEnded || res.headersSent)) {
        return true;
    }
    return false;
};
