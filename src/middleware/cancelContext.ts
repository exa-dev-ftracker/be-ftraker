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
        if (!res.writableEnded) {
            isCancelled = true;
            controller.abort();
            logger.info(`[CancelContext] Request aborted by client: ${req.method} ${req.originalUrl}`);
        }
    };

    // In Node.js / Express, premature client disconnection is detected on the response stream closing
    res.on("close", onAbort);
    req.on("aborted", onAbort);

    req.isClientCancelled = () => {
        return isCancelled || Boolean(req.cancelSignal?.aborted);
    };

    res.on("finish", () => {
        res.off("close", onAbort);
        req.off("aborted", onAbort);
    });

    next();
};

export const isRequestCancelled = (req: Request, res?: Response): boolean => {
    if (req.isClientCancelled && req.isClientCancelled()) {
        return true;
    }
    if (Boolean(req.cancelSignal?.aborted)) {
        return true;
    }
    return false;
};
