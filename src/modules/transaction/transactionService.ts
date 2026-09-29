import { Request, Response } from "express";
import logger from "../../utils/logger";
import { formatErrorValidation, validate } from "../../utils/validation";
import { createTransactionBodySchema, getTransactionQuerySchema, updateTransactionBodySchema, n8nWebhookBodySchema } from "./transactionSchema";
import { ErrorResponse, SuccessResponse } from "../../utils/response";
import TransactionModel from "./transactionModel";
import useSelectedViewPeriode from "../../utils/selectedViewPeriode";
import { ZodError } from "zod";
import mongoose from "mongoose";

class TransactionService {

    private static buildFilter(query: any, userId: string): Record<string, any> {
        const { view = "All", type, category, search, startDate, endDate, year, month } = query;
        const filter: Record<string, any> = { user: userId };

        if (type && type !== "All") {
            filter.type = new RegExp(`^${type}$`, "i");
        }

        if (category && category !== "all") {
            filter.category = category;
        }

        if (search && String(search).trim()) {
            filter.description = { $regex: String(search).trim(), $options: "i" };
        }

        if (startDate && endDate) {
            const s = new Date(startDate);
            s.setHours(0, 0, 0, 0);
            const e = new Date(endDate);
            e.setHours(23, 59, 59, 999);
            filter.$or = [
                { date: { $gte: s, $lte: e } },
                { date: { $exists: false }, createdAt: { $gte: s, $lte: e } },
            ];
        } else if (year && month) {
            const y = parseInt(year);
            const m = parseInt(month) - 1;
            const s = new Date(y, m, 1, 0, 0, 0, 0);
            const e = new Date(y, m + 1, 0, 23, 59, 59, 999);
            filter.$or = [
                { date: { $gte: s, $lte: e } },
                { date: { $exists: false }, createdAt: { $gte: s, $lte: e } },
            ];
        } else if (year && !month) {
            const y = parseInt(year);
            const s = new Date(y, 0, 1, 0, 0, 0, 0);
            const e = new Date(y, 11, 31, 23, 59, 59, 999);
            filter.$or = [
                { date: { $gte: s, $lte: e } },
                { date: { $exists: false }, createdAt: { $gte: s, $lte: e } },
            ];
        } else if (view && view !== "All" && view !== "Custom") {
            const { currentPeriode } = useSelectedViewPeriode(view);
            const period = currentPeriode();
            if (period.start && period.end) {
                filter.$or = [
                    { date: { $gte: period.start, $lte: period.end } },
                    { date: { $exists: false }, createdAt: { $gte: period.start, $lte: period.end } },
                ];
            }
        }

        return filter;
    }

    static async getTransactions(req: Request, res: Response) {
        try {
            validate(req.query, getTransactionQuerySchema);

            const user = req.user!;
            const filter = TransactionService.buildFilter(req.query, user.id_user);
            const { sort = "newest" } = req.query as any;

            let sortOptions: Record<string, any> = { date: -1, createdAt: -1 };
            if (sort === "oldest") {
                sortOptions = { date: 1, createdAt: 1 };
            } else if (sort === "highest") {
                sortOptions = { amount: -1, date: -1 };
            } else if (sort === "lowest") {
                sortOptions = { amount: 1, date: -1 };
            }

            const rawTransactions = await TransactionModel
                .find(filter)
                .populate("category")
                .sort(sortOptions as any)
                .lean();

            const transactions = rawTransactions.map((t: any) => ({
                ...t,
                date: t.date && !String(t.date).includes("2026-09-28T23:32:05") ? t.date : (t.createdAt || t.date),
            }));

            return res.status(200).json(SuccessResponse(transactions, "Transactions retrieved successfully", 200));

        } catch (error) {
            logger.error(error);

            if (error instanceof ZodError) {
                const message = formatErrorValidation(error);
                return res.status(400).json(ErrorResponse("Validation error", message, 400));
            }

            return res.status(500).json(ErrorResponse("Internal server error", (error as Error).message, 500));
        }
    }

    static async getTransactionById(req: Request, res: Response) {
        const { transactionId } = req.params;
        const user = req.user!;

        const transaction = await TransactionModel
            .findOne({ _id: transactionId, user: user.id_user })
            .populate("category")
            .lean();

        if (!transaction) {
            return res.status(404).json(ErrorResponse("Not Found", "Transaction not found", 404));
        }

        return res.status(200).json(SuccessResponse({
            ...transaction,
            date: (transaction as any).date || (transaction as any).createdAt,
        }, "Transaction retrieved successfully", 200));
    }

    static async createTransaction(req: Request, res: Response, session: mongoose.ClientSession) {
        validate(req.body, createTransactionBodySchema);

        const { amount, type, description, category, date, createdAt } = req.body;
        const user = req.user!;

        // Real transaction date (when the transaction occurred)
        const transactionDate = date
            ? new Date(date)
            : (createdAt ? new Date(createdAt) : new Date());

        const transaction = new TransactionModel({
            user: user.id_user,
            amount,
            type: type.toLowerCase() === "income" ? "Income" : "Expense",
            description,
            category: category || null,
            date: transactionDate,
            // createdAt is automatically handled by Mongoose timestamps for the true entry time
        });

        await transaction.save({ session });
        await transaction.populate("category");

        const responseData = {
            ...transaction.toObject(),
            date: transaction.date || transaction.createdAt,
        };

        return res.status(201).json(SuccessResponse(responseData, "Transaction created successfully", 201));
    }

    static async updateTransaction(req: Request, res: Response, session: mongoose.ClientSession) {
        validate(req.body, updateTransactionBodySchema);

        const { amount, type, description, category, date, createdAt } = req.body;
        const { transactionId } = req.params;
        const user = req.user!;

        const transaction = await TransactionModel.findOne({ _id: transactionId, user: user.id_user });

        if (!transaction) {
            return res.status(404).json(ErrorResponse("Not Found", "Transaction not found", 404));
        }

        if (amount !== undefined) transaction.amount = amount;
        if (type !== undefined) transaction.type = type.toLowerCase() === "income" ? "Income" : "Expense";
        if (description !== undefined) transaction.description = description;
        if (category !== undefined) transaction.category = category;
        if (date !== undefined) transaction.date = new Date(date);
        else if (createdAt !== undefined) transaction.date = new Date(createdAt);

        await transaction.save({ session });
        await transaction.populate("category");

        const responseData = {
            ...transaction.toObject(),
            date: transaction.date || transaction.createdAt,
        };

        return res.status(200).json(SuccessResponse(responseData, "Transaction updated successfully", 200));
    }

    static async deleteTransaction(req: Request, res: Response, session: mongoose.ClientSession) {
        const { transactionId } = req.params;
        const user = req.user!;

        const transaction = await TransactionModel.findOneAndDelete(
            { _id: transactionId, user: user.id_user },
            { session }
        );

        if (!transaction) {
            return res.status(404).json(ErrorResponse("Not Found", "Transaction not found", 404));
        }

        return res.status(200).json(SuccessResponse(null, "Transaction deleted successfully", 200));
    }

    static async getTransactionSummary(req: Request, res: Response) {
        const user = req.user!;
        const filter = TransactionService.buildFilter(req.query, user.id_user);
        const transactions = await TransactionModel.find(filter);

        let incomeTotal = 0;
        let expenseTotal = 0;

        for (const t of transactions) {
            const isIncome = t.type?.toLowerCase() === "income";
            if (isIncome) {
                incomeTotal += t.amount;
            } else {
                expenseTotal += t.amount;
            }
        }

        const balance = incomeTotal - expenseTotal;

        return res.status(200).json(SuccessResponse({
            incomeTotal,
            expenseTotal,
            balance,
            transactionCount: transactions.length,
        }, "Transaction summary retrieved successfully", 200));
    }

    static async handleN8nWebhook(req: Request, res: Response, session: mongoose.ClientSession) {
        try {
            validate(req.body, n8nWebhookBodySchema);

            const { amount, type, description, category, date, createdAt, user } = req.body;
            const transactionDate = date
                ? new Date(date)
                : (createdAt ? new Date(createdAt) : new Date());

            const transaction = new TransactionModel({
                user,
                amount,
                type,
                description,
                category: category || null,
                date: transactionDate,
            });

            await transaction.save({ session });

            logger.info(`N8N Webhook: Transaction created`, {
                transactionId: transaction._id,
                amount,
                type,
                description,
                date: transaction.date,
                createdAt: transaction.createdAt,
                user
            });

            return res.status(201).json(SuccessResponse({
                transactionId: transaction._id,
                status: "success",
                message: "Transaction created from webhook"
            }, "Webhook transaction created successfully", 201));

        } catch (error) {
            logger.error("N8N Webhook Error", error);

            if (error instanceof ZodError) {
                const message = formatErrorValidation(error);
                return res.status(400).json(ErrorResponse("Validation error", message, 400));
            }

            return res.status(500).json(ErrorResponse("Internal server error", (error as Error).message, 500));
        }
    }
}

export default TransactionService;
