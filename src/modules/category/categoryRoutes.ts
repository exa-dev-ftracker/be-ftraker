import { Router } from "express";
import CategoryService from "./categoryService";
import { wrappingDbTransaction } from "../../utils/db";

const router = Router();

router.get("/categories", CategoryService.getCategories);
router.post("/categories", wrappingDbTransaction(CategoryService.createCategory));
router.put("/categories/:categoryId", wrappingDbTransaction(CategoryService.updateCategory));
router.delete("/categories/:categoryId", wrappingDbTransaction(CategoryService.deleteCategory));

export default router;
