import * as zod from 'zod'

export const loginBodySchema = zod.object({
    email: zod.email("Invalid email format"),
    password: zod.string()
})

export const registerBodySchema = zod.object({
    name: zod.string().min(3, "Name is required"),
    email: zod.email("Invalid email format"),
    password: zod.string().min(6, "Password must be at least 6 characters long")
})

export const loginWithGoogleBodySchema = zod.object({
    credential: zod.jwt("Invalid JWT format"),
})

export const loginWithAppleBodySchema = zod.object({
    identityToken: zod.string().optional(),
    userIdentifier: zod.string().optional(),
    email: zod.string().optional().nullable(),
    name: zod.string().optional().nullable(),
    code: zod.string().optional().nullable(),
})