import { Request, Response } from "express";
import TransactionModel from "../transaction/transactionModel";
import useSelectedViewPeriode from "../../utils/selectedViewPeriode";
import { SuccessResponse } from "../../utils/response";

export interface TopExpenseItem {
    name: string;
    amount: number;
    color: string;
    icon: string;
    percentage: number;
}

export interface CategoryBreakdown {
    name: string;
    amount: number;
    color: string;
    icon: string;
    percentage: number;
}

class DashboardService {
    static async getDashboard(req: Request, res: Response) {
        const user = req.user!;
        const { view = "Month" } = req.query as { view?: string };

        const { currentPeriode } = useSelectedViewPeriode(view);
        const period = currentPeriode();

        const baseQuery: Record<string, any> = { user: user.id_user };
        if (view !== "All" && period.start && period.end) {
            baseQuery.$or = [
                { date: { $gte: period.start, $lte: period.end } },
                { date: { $exists: false }, createdAt: { $gte: period.start, $lte: period.end } },
            ];
        }

        const rawTransactions = await TransactionModel
            .find(baseQuery)
            .sort({ date: -1, createdAt: -1 })
            .populate("category")
            .lean();

        const allTransactions = rawTransactions.map((t: any) => ({
            ...t,
            date: t.date && !String(t.date).includes("2026-09-28T23:32:05") ? t.date : (t.createdAt || t.date),
        }));

        let incomeTotal = 0;
        let expenseTotal = 0;

        const expenseCategoryMap: Record<
            string,
            { name: string; amount: number; color: string; icon: string }
        > = {};

        for (const t of allTransactions) {
            const isIncome = t.type?.toLowerCase() === "income";
            const amount = t.amount || 0;

            if (isIncome) {
                incomeTotal += amount;
            } else {
                expenseTotal += amount;
                const cat = t.category && typeof t.category === "object" ? (t.category as any) : null;
                const catName = cat?.name || "Other";
                if (!expenseCategoryMap[catName]) {
                    expenseCategoryMap[catName] = {
                        name: catName,
                        amount: 0,
                        color: cat?.color || "#F43F5E",
                        icon: cat?.icon || "tag",
                    };
                }
                expenseCategoryMap[catName].amount += amount;
            }
        }

        const balance = incomeTotal - expenseTotal;
        const transactionCount = allTransactions.length;

        const topExpenses: TopExpenseItem[] = Object.values(expenseCategoryMap)
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 5)
            .map((item) => ({
                ...item,
                percentage: expenseTotal > 0 ? Math.round((item.amount / expenseTotal) * 100) : 0,
            }));

        const recentTransactions = allTransactions.slice(0, 8);

        return res.status(200).json(
            SuccessResponse({
                metrics: {
                    balance,
                    incomeTotal,
                    expenseTotal,
                    transactionCount,
                },
                recentTransactions,
                topExpenses,
            }, "Dashboard metrics retrieved successfully", 200)
        );
    }

    static async getAnalytics(req: Request, res: Response) {
        const user = req.user!;
        const { view = "Month" } = req.query as { view?: string };

        const { currentPeriode } = useSelectedViewPeriode(view);
        const period = currentPeriode();

        const baseQuery: Record<string, any> = { user: user.id_user };
        if (view !== "All" && period.start && period.end) {
            baseQuery.$or = [
                { date: { $gte: period.start, $lte: period.end } },
                { date: { $exists: false }, createdAt: { $gte: period.start, $lte: period.end } },
            ];
        }

        const rawTransactions = await TransactionModel
            .find(baseQuery)
            .sort({ date: -1, createdAt: -1 })
            .populate("category")
            .lean();

        const allTransactions = rawTransactions.map((t: any) => ({
            ...t,
            date: t.date && !String(t.date).includes("2026-09-28T23:32:05") ? t.date : (t.createdAt || t.date),
        }));

        let incomeTotal = 0;
        let expenseTotal = 0;
        let largestTransaction = 0;

        const incomeCatMap: Record<
            string,
            { name: string; amount: number; color: string; icon: string }
        > = {};
        const expenseCatMap: Record<
            string,
            { name: string; amount: number; color: string; icon: string }
        > = {};

        for (const t of allTransactions) {
            const isIncome = t.type?.toLowerCase() === "income";
            const amount = t.amount || 0;

            if (amount > largestTransaction) {
                largestTransaction = amount;
            }

            const cat = t.category && typeof t.category === "object" ? (t.category as any) : null;
            const catName = cat?.name || "General";

            if (isIncome) {
                incomeTotal += amount;
                if (!incomeCatMap[catName]) {
                    incomeCatMap[catName] = {
                        name: catName,
                        amount: 0,
                        color: cat?.color || "#10B981",
                        icon: cat?.icon || "trending_up",
                    };
                }
                incomeCatMap[catName].amount += amount;
            } else {
                expenseTotal += amount;
                if (!expenseCatMap[catName]) {
                    expenseCatMap[catName] = {
                        name: catName,
                        amount: 0,
                        color: cat?.color || "#F43F5E",
                        icon: cat?.icon || "trending_down",
                    };
                }
                expenseCatMap[catName].amount += amount;
            }
        }

        const transactionCount = allTransactions.length;
        const netSavings = incomeTotal - expenseTotal;
        const averageTransaction =
            transactionCount > 0
                ? Math.round((incomeTotal + expenseTotal) / transactionCount)
                : 0;

        const incomeByCategory: CategoryBreakdown[] = Object.values(incomeCatMap)
            .sort((a, b) => b.amount - a.amount)
            .map((item) => ({
                ...item,
                percentage: incomeTotal > 0 ? Math.round((item.amount / incomeTotal) * 100) : 0,
            }));

        const expenseByCategory: CategoryBreakdown[] = Object.values(expenseCatMap)
            .sort((a, b) => b.amount - a.amount)
            .map((item) => ({
                ...item,
                percentage: expenseTotal > 0 ? Math.round((item.amount / expenseTotal) * 100) : 0,
            }));

        return res.status(200).json(
            SuccessResponse({
                metrics: {
                    incomeTotal,
                    expenseTotal,
                    netSavings,
                    transactionCount,
                    averageTransaction,
                    largestTransaction,
                },
                incomeByCategory,
                expenseByCategory,
            }, "Analytics metrics retrieved successfully", 200)
        );
    }
}

export default DashboardService;
