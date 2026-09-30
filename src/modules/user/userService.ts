import UserModel from "./userModel";
import {Request, Response} from "express";
import zod from "zod";
import {validate} from "../../utils/validation";
import {loginBodySchema, loginWithAppleBodySchema, loginWithGoogleBodySchema, registerBodySchema} from "./userSchema";
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

        const {email, email_verified, name: googleName, sub: googleId} = ticket.getPayload() as any;

        if (!email_verified) {
            return res.status(400).json(ErrorResponse("Email not verified", null, 400));
        }

        // 1. Try finding user by google_id
        let user = googleId ? await UserModel.findOne({ google_id: googleId }) : null;

        // 2. If not found by google_id, try finding by email and auto-link
        if (!user && email) {
            user = await UserModel.findOne({ email });
            if (user) {
                if (googleId && !user.google_id) {
                    user.google_id = googleId;
                }
                if (!user.google_email) {
                    user.google_email = email;
                }
                await user.save({ session });
                logger.info(`Auto-linked Google ID to existing account: ${user.email}`);
            }
        }

        // 3. If still not found, create new account (Sign Up with Google)
        let isNewUser = false;
        if (!user) {
            isNewUser = true;
            let formattedName = "Google User";
            if (googleName && typeof googleName === "string" && googleName.trim()) {
                formattedName = googleName.trim();
            } else if (email) {
                formattedName = email.split("@")[0];
            }

            user = new UserModel({
                name: formattedName,
                email,
                password: null,
                google_id: googleId || null,
                google_email: email,
            });

            await user.save({ session });
            logger.info(`Created new user with Google ID: ${user.email}`);
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
            id_user: user.id,
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

        logger.info(`User ${user.email} logged in with Google successfully`);

        return res.status(isNewUser ? 201 : 200).json(
            SuccessResponse<ResponseAuth>(
                {accessToken, refreshToken},
                isNewUser ? "User registered with Google successfully" : "User logged in with Google successfully",
                isNewUser ? 201 : 200
            )
        );
    }

    static async loginWithApple(req: Request, res: Response, session: mongoose.ClientSession) {
        validate(req.body, loginWithAppleBodySchema);
        const { identityToken, userIdentifier, email, name } = req.body;

        if (!identityToken && !userIdentifier) {
            return res.status(400).json(ErrorResponse("Either identityToken or userIdentifier is required", null, 400));
        }

        const clientRedis = await getClientRedis();
        if (!clientRedis) {
            return res.status(500).json(ErrorResponse("Redis connection error", null, 500));
        }

        let appleUserId: string | null = userIdentifier || null;
        let resolvedEmail: string | null = email || null;

        if (identityToken) {
            const decoded = decodeJwt(identityToken) as any;
            if (decoded) {
                if (decoded.sub) appleUserId = decoded.sub;
                if (decoded.email && !resolvedEmail) resolvedEmail = decoded.email;
            }
        }

        if (!appleUserId && !resolvedEmail) {
            return res.status(400).json(ErrorResponse("Failed to identify Apple user", null, 400));
        }

        // 1. Try finding user by apple_id
        let user = appleUserId ? await UserModel.findOne({ apple_id: appleUserId }) : null;

        // 2. If not found by apple_id, try finding by email and auto-link
        if (!user && resolvedEmail) {
            user = await UserModel.findOne({ email: resolvedEmail });
            if (user) {
                if (appleUserId && !user.apple_id) {
                    user.apple_id = appleUserId;
                }
                if (!user.apple_email) {
                    user.apple_email = resolvedEmail;
                }
                await user.save({ session });
                logger.info(`Auto-linked Apple ID to existing account: ${user.email}`);
            }
        }

        // 3. If still not found, create new account (Sign Up with Apple)
        let isNewUser = false;
        if (!user) {
            isNewUser = true;
            let formattedName = "Apple User";
            if (name && typeof name === "string" && name.trim()) {
                formattedName = name.trim();
            }

            const fallbackEmail = resolvedEmail || `apple_${(appleUserId || Date.now().toString()).slice(0, 10)}@privaterelay.appleid.com`;

            user = new UserModel({
                name: formattedName,
                email: fallbackEmail,
                password: null,
                apple_id: appleUserId,
                apple_email: resolvedEmail,
            });

            await user.save({ session });
            logger.info(`Created new user with Apple ID: ${user.email}`);
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
            id_user: user.id,
            expireAt: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000)
        }).save({ session });

        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: "/",
            expires: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000)
        });

        await clientRedis.setEx(`refreshToken:${refreshToken}`, 60 * 60 * 24 * 30, refreshToken);

        logger.info(`User ${user.email} logged in with Apple successfully`);

        return res.status(isNewUser ? 201 : 200).json(
            SuccessResponse<ResponseAuth>(
                { accessToken, refreshToken },
                isNewUser ? "User registered with Apple successfully" : "User logged in with Apple successfully",
                isNewUser ? 201 : 200
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
            name: user.name,
            email: user.email,
            phone_number: user.phone_number || null,
            chatbot_enabled: user.chatbot_enabled || false,
            timezone: user.timezone || "UTC",
        }, "Settings retrieved successfully", 200));
    }

    static async updateTimezone(req: Request, res: Response, session: mongoose.ClientSession) {
        const userPayload = req.user!;
        const { timezone } = req.body;
        if (!timezone || typeof timezone !== "string") {
            return res.status(400).json(ErrorResponse("Bad Request", "Timezone string is required", 400));
        }
        const user = await UserModel.findById(userPayload.id_user);
        if (!user) {
            return res.status(404).json(ErrorResponse("User not found", null, 404));
        }
        user.timezone = timezone;
        await user.save({ session });
        return res.status(200).json(SuccessResponse({
            timezone: user.timezone,
        }, "Timezone updated successfully", 200));
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
