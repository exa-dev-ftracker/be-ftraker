import zod from "zod";

export const createTransactionBodySchema = zod.object({
    amount: zod.number().min(1, "Amount must be a positive number"),
    type: zod.string().refine(
        (val) => ["income", "expense", "Income", "Expense", "Expanse"].includes(val),
        { message: "Type must be either 'income' or 'expense'" }
    ),
    description: zod.string().min(1, "Description is required"),
    category: zod.string().optional(),
    date: zod.string().optional().refine((d) => {
        if (d) {
            const parsed = new Date(d);
            return !isNaN(parsed.getDate());
        }
        return true;
    }, { message: "Invalid date format for transaction date" }),
    createdAt: zod.string().optional().refine((date) => {
        if (date) {
            const parsedDate = new Date(date);
            return !isNaN(parsedDate.getDate());
        }
        return true;
    }, {
        message: "Invalid date format for createdAt",
    }),
});

export const updateTransactionBodySchema = zod.object({
    amount: zod.number().min(1, "Amount must be a positive number").optional(),
    type: zod.string().refine(
        (val) => ["income", "expense", "Income", "Expense", "Expanse"].includes(val),
        { message: "Type must be either 'income' or 'expense'" }
    ),
    description: zod.string().min(1, "Description is required").optional(),
    category: zod.string().optional(),
    date: zod.string().optional().refine((d) => {
        if (d) {
            const parsed = new Date(d);
            return !isNaN(parsed.getDate());
        }
        return true;
    }, { message: "Invalid date format for transaction date" }),
    createdAt: zod.string().optional().refine((date) => {
        if (date) {
            const parsedDate = new Date(date);
            return !isNaN(parsedDate.getDate());
        }
        return true;
    }, {
        message: "Invalid date format for createdAt",
    }),
});

export const getTransactionQuerySchema = zod.object({
    view: zod.string().optional(),
    type: zod.string().optional(),
    category: zod.string().optional(),
    search: zod.string().optional(),
});

export const n8nWebhookBodySchema = zod.object({
    amount: zod.number().min(1, "Amount must be a positive number"),
    type: zod.string(),
    description: zod.string().min(1, "Description is required"),
    category: zod.string().optional(),
    date: zod.string().optional(),
    createdAt: zod.string().optional(),
    user: zod.string().regex(/^[0-9a-f]{24}$/, "Invalid MongoDB ObjectId"),
});
