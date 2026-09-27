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

    static async getTransactions(req: Request, res: Response) {
        try {
            validate(req.query, getTransactionQuerySchema);

            const { view = "All", type, category, search } = req.query as any;
            const user = req.user!;

            const filter: Record<string, any> = { user: user.id_user };

            if (type) {
                filter.type = new RegExp(`^${type}$`, "i");
            }

            if (category) {
                filter.category = category;
            }

            if (search) {
                filter.description = { $regex: search, $options: "i" };
            }

            if (view !== "All") {
                const { currentPeriode } = useSelectedViewPeriode(view);
                const period = currentPeriode();
                if (period.start && period.end) {
                    filter.createdAt = {
                        $gte: period.start,
                        $lte: period.end,
                    };
                }
            }

            const transactions = await TransactionModel
                .find(filter)
                .populate("category")
                .sort({ createdAt: -1 });

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
            .populate("category");

        if (!transaction) {
            return res.status(404).json(ErrorResponse("Not Found", "Transaction not found", 404));
        }

        return res.status(200).json(SuccessResponse(transaction, "Transaction retrieved successfully", 200));
    }

    static async createTransaction(req: Request, res: Response, session: mongoose.ClientSession) {
        validate(req.body, createTransactionBodySchema);

        const { amount, type, description, category, createdAt } = req.body;
        const user = req.user!;

        const transaction = new TransactionModel({
            user: user.id_user,
            amount,
            type: type.toLowerCase() === "income" ? "Income" : "Expense",
            description,
            category: category || null,
            createdAt: createdAt ? new Date(createdAt) : new Date(),
        });

        await transaction.save({ session });
        await transaction.populate("category");

        return res.status(201).json(SuccessResponse(transaction, "Transaction created successfully", 201));
    }

    static async updateTransaction(req: Request, res: Response, session: mongoose.ClientSession) {
        validate(req.body, updateTransactionBodySchema);

        const { amount, type, description, category, createdAt } = req.body;
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
        if (createdAt !== undefined) transaction.createdAt = new Date(createdAt);

        await transaction.save({ session });
        await transaction.populate("category");

        return res.status(200).json(SuccessResponse(transaction, "Transaction updated successfully", 200));
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
        const transactions = await TransactionModel.find({ user: user.id_user });

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

            const { amount, type, description, category, createdAt, user } = req.body;

            const transaction = new TransactionModel({
                user,
                amount,
                type,
                description,
                category: category || null,
                createdAt: createdAt ? new Date(createdAt) : new Date(),
            });

            await transaction.save({ session });

            logger.info(`N8N Webhook: Transaction created`, {
                transactionId: transaction._id,
                amount,
                type,
                description,
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
