import { startOfMonth, endOfMonth, sub, startOfDay, endOfDay, startOfYear, endOfYear, startOfWeek, endOfWeek } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { normalizeTimezone } from './timezone';

export default function useSelectedView(periode: string, timeZone: string = 'UTC') {
    const tz = normalizeTimezone(timeZone);
    const now = new Date();
    const zonedNow = toZonedTime(now, tz);

    const lastPeriode = (() => {
        let start: Date | undefined;
        let end: Date | undefined;
        switch (periode) {
            case 'Day': {
                const prev = sub(zonedNow, { days: 1 });
                start = fromZonedTime(startOfDay(prev), tz);
                end = fromZonedTime(endOfDay(prev), tz);
                return { start, end };
            }
            case 'Month': {
                const prev = sub(zonedNow, { months: 1 });
                start = fromZonedTime(startOfMonth(prev), tz);
                end = fromZonedTime(endOfMonth(prev), tz);
                return { start, end };
            }
            case 'Year': {
                const prev = sub(zonedNow, { years: 1 });
                start = fromZonedTime(startOfYear(prev), tz);
                end = fromZonedTime(endOfYear(prev), tz);
                return { start, end };
            }
            case 'Week': {
                const prev = sub(zonedNow, { weeks: 1 });
                start = fromZonedTime(startOfWeek(prev, { weekStartsOn: 1 }), tz);
                end = fromZonedTime(endOfWeek(prev, { weekStartsOn: 1 }), tz);
                return { start, end };
            }
        }
        return { start, end };
    });

    const currentPeriode = (() => {
        let start: Date | undefined;
        let end: Date | undefined;
        switch (periode) {
            case 'Day': {
                start = fromZonedTime(startOfDay(zonedNow), tz);
                end = fromZonedTime(endOfDay(zonedNow), tz);
                return { start, end };
            }
            case 'Month': {
                start = fromZonedTime(startOfMonth(zonedNow), tz);
                end = fromZonedTime(endOfMonth(zonedNow), tz);
                return { start, end };
            }
            case 'Year': {
                start = fromZonedTime(startOfYear(zonedNow), tz);
                end = fromZonedTime(endOfYear(zonedNow), tz);
                return { start, end };
            }
            case 'Week': {
                start = fromZonedTime(startOfWeek(zonedNow, { weekStartsOn: 1 }), tz);
                end = fromZonedTime(endOfWeek(zonedNow, { weekStartsOn: 1 }), tz);
                return { start, end };
            }
        }
        return { start, end };
    });

    return { lastPeriode, currentPeriode };
};