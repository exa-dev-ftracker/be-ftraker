import {Router} from "express";
import UserService from "./userService";
import {wrappingDbTransaction} from "../../utils/db";

const router = Router();

// langsung bungkus tiap service dgn transaction wrapper
router.post("/login", wrappingDbTransaction(UserService.login));
router.post("/register", wrappingDbTransaction(UserService.register));
router.post("/login-with-google", wrappingDbTransaction(UserService.loginWithGoogle));
router.post("/login-with-apple", wrappingDbTransaction(UserService.loginWithApple));
router.post("/logout", wrappingDbTransaction(UserService.logout));
router.post("/refresh", wrappingDbTransaction(UserService.refreshToken));

export default router;
