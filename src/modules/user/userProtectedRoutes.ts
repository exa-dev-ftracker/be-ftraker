import { Router } from "express";
import UserService from "./userService";
import { wrappingDbTransaction } from "../../utils/db";

const router = Router();

router.get("/user/me", UserService.getProfile);
router.get("/user/settings", UserService.getSettings);
router.post("/user/bind-apple", wrappingDbTransaction(UserService.bindApple));
router.post("/user/unbind-apple", wrappingDbTransaction(UserService.unbindApple));
router.post("/user/bind-google", wrappingDbTransaction(UserService.bindGoogle));
router.patch("/user/timezone", wrappingDbTransaction(UserService.updateTimezone));
router.post("/user/phone", wrappingDbTransaction(UserService.updatePhone));
router.patch("/user/chatbot", wrappingDbTransaction(UserService.toggleChatbot));
router.delete("/user/account", wrappingDbTransaction(UserService.deleteAccount));
router.delete("/user/me", wrappingDbTransaction(UserService.deleteAccount));

export default router;
