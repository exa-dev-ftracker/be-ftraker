import { Request } from "express";
import UserModel from "../modules/user/userModel";

export function normalizeTimezone(tz?: string | null): string {
    if (!tz || typeof tz !== "string") return "UTC";
    const trimmed = tz.trim();
    const upper = trimmed.toUpperCase();
    if (upper === "WIB" || upper.includes("WIB")) return "Asia/Jakarta";
    if (upper === "WITA" || upper.includes("WITA")) return "Asia/Makassar";
    if (upper === "WIT" || upper.includes("WIT")) return "Asia/Jayapura";
    if (upper === "SGT" || upper.includes("SGT")) return "Asia/Singapore";
    if (upper === "JST" || upper.includes("JST")) return "Asia/Tokyo";
    if (upper === "EST" || upper.includes("EST")) return "America/New_York";
    if (upper === "PST" || upper.includes("PST")) return "America/Los_Angeles";
    try {
        Intl.DateTimeFormat(undefined, { timeZone: trimmed });
        return trimmed;
    } catch {
        return "UTC";
    }
}

export async function resolveUserTimezone(req: Request, userId?: string): Promise<string> {
    const queryTz = req.query?.timezone as string | undefined;
    if (queryTz && queryTz.trim()) {
        return normalizeTimezone(queryTz);
    }

    const headerTz = (req.headers["x-timezone"] as string | undefined) || (req.headers["timezone"] as string | undefined);
    if (headerTz && headerTz.trim()) {
        return normalizeTimezone(headerTz);
    }

    if (userId) {
        try {
            const user = await UserModel.findById(userId).select("timezone").lean();
            if (user?.timezone) {
                return normalizeTimezone(user.timezone);
            }
        } catch {
            // fallback to UTC on DB error
        }
    }

    return "UTC";
}
