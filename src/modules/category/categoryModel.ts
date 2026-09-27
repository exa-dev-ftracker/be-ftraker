import { Schema, model, Document } from "mongoose";

export interface Category extends Document {
    user: Schema.Types.ObjectId;
    name: string;
    type: "income" | "expense" | null;
    color: string;
    icon: string;
    createdAt: Date;
    updatedAt: Date;
}

const categorySchema = new Schema<Category>(
    {
        user: { type: Schema.ObjectId, ref: "User", required: true },
        name: { type: String, required: true },
        type: { type: String, default: null },
        color: { type: String, default: "#10b981" },
        icon: { type: String, default: "i-heroicons-tag" },
    },
    { timestamps: true }
);

export default model<Category>("Category", categorySchema);
