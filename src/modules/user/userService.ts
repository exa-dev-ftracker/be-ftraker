import UserModel from "./userModel";
import {Request, Response} from "express";
import zod from "zod";
import {validate} from "../../utils/validation";
import {loginBodySchema, loginWithGoogleBodySchema, registerBodySchema} from "./userSchema";
import logger from "../../utils/logger";
import {ErrorResponse, SuccessResponse} from "../../utils/response";
import {comparePassword, encryptPassword} from "../../utils/bcrypt";
import {checkExpiredToken, decodeJwt, generateJwt} from "../../utils/jwt";
import {OAuth2Client} from "google-auth-library";
import Config from "../../config";
import {ResponseAuth} from "../../types/user";
import mongoose from "mongoose";
import tokenModel from "../token/tokenModel";
import TransactionModel from "../transaction/transactionModel";
import CategoryModel from "../category/categoryModel";
import getClientRedis from "../../databases/redis";

class UserService {

    static async login(req: Request, res: Response, session: mongoose.ClientSession) {
        validate(req.body, loginBodySchema);

        const {email, password} = req.body as zod.infer<typeof loginBodySchema>;
        const user = await UserModel.findOne({email});

        const clientRedis = await getClientRedis();
        if (!clientRedis) {
            return res.status(500).json(ErrorResponse("Redis connection error", null, 500));
        }

        if (!user || !user.password || !(await comparePassword(password, user.password))) {
            return res.status(400).json(ErrorResponse("Email or Password is wrong", null, 400));
        }

        const accessToken = generateJwt({
            email: user.email,
            name: user.name,
            type: "access",
            id_user: user.id
        });

        const refreshToken = generateJwt({
            email: user.email,
            name: user.name,
            type: "refresh",
            id_user: user.id
        });

        await new tokenModel({
            token: refreshToken,
            id_user: user._id,
            expireAt: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000)
        }).save({session});

        await clientRedis.setEx(`refreshToken:${refreshToken}`, 60 * 60 * 24 * 30, refreshToken);

        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: "/",
            expires: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000)
        });

        logger.info(`User ${email} logged in successfully`);

        return res.status(200).json(
            SuccessResponse<ResponseAuth>(
                {accessToken, refreshToken},
                "Login successful",
                200
            )
        );
    }

    static async register(req: Request, res: Response, session: mongoose.ClientSession) {
        validate(req.body, registerBodySchema);

        const {email, password, name} = req.body as zod.infer<typeof registerBodySchema>;
        const clientRedis = await getClientRedis();

        if (!clientRedis) {
            return res.status(500).json(ErrorResponse("Redis connection error", null, 500));
        }

        const hashedPassword = await encryptPassword(password);

        const newUser = new UserModel({email, password: hashedPassword, name});
        await newUser.save({session});

        const accessToken = generateJwt({
            email: newUser.email,
            name: newUser.name,
            type: "access",
            id_user: newUser.id
        });

        const refreshToken = generateJwt({
            email: newUser.email,
            name: newUser.name,
            type: "refresh",
            id_user: newUser.id
        });

        await new tokenModel({
            token: refreshToken,
            id_user: newUser._id,
            expireAt: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000)
        }).save({session});

        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: "/",
            expires: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000)
        });

        await clientRedis.setEx(`refreshToken:${refreshToken}`, 60 * 60 * 24 * 30, refreshToken);

        logger.info(`User ${email} registered successfully`);

        return res.status(201).json(
            SuccessResponse<ResponseAuth>(
                {accessToken, refreshToken},
                "User registered successfully",
                201
            )
        );
    }

    static async loginWithGoogle(req: Request, res: Response, session: mongoose.ClientSession) {
        validate(req.body, loginWithGoogleBodySchema);
        const {credential} = req.body;

        const clientRedis = await getClientRedis();
        if (!clientRedis) {
            return res.status(500).json(ErrorResponse("Redis connection error", null, 500));
        }

        const client = new OAuth2Client(Config.GOOGLE_CLIENT_ID);

        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: Config.GOOGLE_CLIENT_ID
        });

        const {email, email_verified} = ticket.getPayload() as any;

        if (!email_verified) {
            return res.status(400).json(ErrorResponse("Email not verified", null, 400));
        }

        const existingUser = await UserModel.findOne({email});

        if (!existingUser) {
            return res.status(404).json(ErrorResponse("User does not exist", null, 404));
        }

        const accessToken = generateJwt({
            email,
            name: existingUser.name,
            type: "access",
            id_user: existingUser.id
        });

        const refreshToken = generateJwt({
            email,
            name: existingUser.name,
            type: "refresh",
            id_user: existingUser.id
        });

        await new tokenModel({
            token: refreshToken,
            id_user: existingUser.id,
            expireAt: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000)
        }).save({session});

        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: "/",
            expires: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000)
        });

        await clientRedis.setEx(`refreshToken:${refreshToken}`, 60 * 60 * 24 * 30, refreshToken);

        logger.info(`User ${email} logged in with Google successfully`);

        return res.status(200).json(
            SuccessResponse<ResponseAuth>(
                {accessToken, refreshToken},
                "User already exists",
                200
            )
        );
    }

    static async logout(req: Request, res: Response, session: mongoose.ClientSession) {
        let {token} = req.body;

        if (!token) token = req.cookies?.refreshToken;

        if (!token) {
            return res.status(401).json(ErrorResponse("Refresh token not found", null, 401));
        }

        const clientRedis = await getClientRedis();
        if (!clientRedis) {
            return res.status(500).json(ErrorResponse("Redis connection error", null, 500));
        }

        const decoded = decodeJwt(token);
        if (!decoded?.email) {
            return res.status(401).json(ErrorResponse("Invalid token", null, 401));
        }

        await tokenModel.deleteOne({token}, {session});
        res.clearCookie("refreshToken");
        await clientRedis.del(`refreshToken:${token}`);

        logger.info(`User ${decoded.email} logged out successfully`);

        return res.status(200).json(SuccessResponse(null, "Logged out successfully", 200));
    }

    static async refreshToken(req: Request, res: Response, session: mongoose.ClientSession) {
        let refreshToken = req.cookies?.refreshToken || req.headers.authorization?.split(" ")[1] || req.body.refreshToken;

        const clientRedis = await getClientRedis();
        if (!clientRedis) {
            return res.status(500).json(ErrorResponse("Redis connection error", null, 500));
        }

        if (!refreshToken) {
            return res.status(409).json(ErrorResponse("Refresh token not found", null, 400));
        }

        const redisToken = await clientRedis.get(`refreshToken:${refreshToken}`);

        if (!redisToken) {
            const tokenInDb = await tokenModel.findOne({token: refreshToken});
            if (!tokenInDb) {
                return res.status(401).json(ErrorResponse("Invalid refresh token", null, 401));
            }
            await clientRedis.setEx(`refreshToken:${refreshToken}`, 60 * 60 * 24 * 30, refreshToken);
        }

        const payload = decodeJwt(refreshToken);
        if (!payload || !payload.email) {
            return res.status(401).json(ErrorResponse("Invalid refresh token", null, 401));
        }

        const {expired, willExpireSoon} = checkExpiredToken(refreshToken);

        if (expired) {
            await tokenModel.deleteOne({token: refreshToken}, {session});
            await clientRedis.del(`refreshToken:${refreshToken}`);

            return res.status(401).json(ErrorResponse("Refresh token has expired", null, 401));
        }

        if (willExpireSoon) {
            const newRefreshToken = generateJwt({
                email: payload.email,
                name: payload.name,
                type: "refresh",
                id_user: payload.id_user
            });

            const newAccessToken = generateJwt({
                email: payload.email,
                name: payload.name,
                type: "access",
                id_user: payload.id_user
            });

            await tokenModel.updateOne(
                {token: refreshToken},
                {
                    token: newRefreshToken,
                    expireAt: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000)
                },
                {session}
            );

            await clientRedis.del(`refreshToken:${refreshToken}`);
            await clientRedis.setEx(`refreshToken:${newRefreshToken}`, 60 * 60 * 24 * 30, newRefreshToken);

            res.cookie("refreshToken", newRefreshToken, {
                httpOnly: true,
                secure: true,
                sameSite: "none",
                path: "/",
                expires: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000)
            });

            logger.info(`Refresh token rotated for ${payload.email}`);

            return res.status(200).json(
                SuccessResponse(
                    {accessToken: newAccessToken, refreshToken: newRefreshToken},
                    "Token refreshed successfully",
                    200
                )
            );
        }

        const newAccessToken = generateJwt({
            email: payload.email,
            name: payload.name,
            type: "access",
            id_user: payload.id_user
        });

        return res.status(200).json(
            SuccessResponse(
                {accessToken: newAccessToken, refreshToken},
                "Token refreshed successfully",
                200
            )
        );
    }

    static async getProfile(req: Request, res: Response) {
        const userPayload = req.user!;
        const user = await UserModel.findById(userPayload.id_user).select("-password -token");
        if (!user) {
            return res.status(404).json(ErrorResponse("User not found", null, 404));
        }
        return res.status(200).json(SuccessResponse(user, "User profile retrieved successfully", 200));
    }

    static async getSettings(req: Request, res: Response) {
        const userPayload = req.user!;
        const user = await UserModel.findById(userPayload.id_user);
        if (!user) {
            return res.status(404).json(ErrorResponse("User not found", null, 404));
        }
        return res.status(200).json(SuccessResponse({
            phone_number: user.phone_number || null,
            chatbot_enabled: user.chatbot_enabled || false,
        }, "Settings retrieved successfully", 200));
    }

    static async updatePhone(req: Request, res: Response, session: mongoose.ClientSession) {
        const userPayload = req.user!;
        const { phone_number } = req.body;
        const user = await UserModel.findById(userPayload.id_user);
        if (!user) {
            return res.status(404).json(ErrorResponse("User not found", null, 404));
        }
        user.phone_number = phone_number;
        await user.save({ session });
        return res.status(200).json(SuccessResponse({
            phone_number: user.phone_number,
            chatbot_enabled: user.chatbot_enabled,
        }, "Phone number updated successfully", 200));
    }

    static async toggleChatbot(req: Request, res: Response, session: mongoose.ClientSession) {
        const userPayload = req.user!;
        const { chatbot_enabled } = req.body;
        const user = await UserModel.findById(userPayload.id_user);
        if (!user) {
            return res.status(404).json(ErrorResponse("User not found", null, 404));
        }
        user.chatbot_enabled = Boolean(chatbot_enabled);
        await user.save({ session });
        return res.status(200).json(SuccessResponse({
            phone_number: user.phone_number,
            chatbot_enabled: user.chatbot_enabled,
        }, "Chatbot status updated successfully", 200));
    }

    static async deleteAccount(req: Request, res: Response, session: mongoose.ClientSession) {
        const userPayload = req.user!;
        const userId = userPayload.id_user;

        const user = await UserModel.findById(userId);
        if (!user) {
            return res.status(404).json(ErrorResponse("User not found", null, 404));
        }

        // 1. Delete all transactions belonging to this user
        await TransactionModel.deleteMany({ user: userId }, { session });

        // 2. Delete all categories belonging to this user
        await CategoryModel.deleteMany({ user: userId }, { session });

        // 3. Invalidate redis tokens and remove from DB
        const tokens = await tokenModel.find({ id_user: userId });
        const clientRedis = await getClientRedis();
        if (clientRedis) {
            for (const t of tokens) {
                await clientRedis.del(t.token);
            }
        }
        await tokenModel.deleteMany({ id_user: userId }, { session });

        // 4. Delete user record permanently
        await UserModel.findByIdAndDelete(userId, { session });

        logger.info(`[Delete Account] User ${user.email} (${userId}) deleted account permanently`);

        return res.status(200).json(SuccessResponse(null, "Account and all associated data deleted successfully", 200));
    }
}

export default UserService;
