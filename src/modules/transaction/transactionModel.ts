import { Schema, model, Document } from "mongoose";
import "../category/categoryModel";

export interface Transaction extends Document {
    user: Schema.Types.ObjectId;
    amount: number;
    type: string;
    description: string;
    category?: Schema.Types.ObjectId;
    linkedIncomeId?: Schema.Types.ObjectId;
    date: Date;
    createdAt: Date;
    updatedAt: Date;
}

const transactionSchema = new Schema<Transaction>(
    {
        user: { type: Schema.ObjectId, ref: "User", required: true },
        amount: { type: Number, required: true },
        type: { type: String, required: true },
        description: { type: String, required: true },
        category: { type: Schema.ObjectId, ref: "Category" },
        linkedIncomeId: { type: Schema.ObjectId, ref: "Transaction", default: null },
        date: {
            type: Date,
            default: function (this: any) {
                return this.createdAt || Date.now();
            },
        },
    },
    { timestamps: true }
);

transactionSchema.index({ linkedIncomeId: 1 });

export default model<Transaction>("Transaction", transactionSchema);
