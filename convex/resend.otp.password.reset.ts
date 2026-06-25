import Resend from "@auth/core/providers/resend";
import { Resend as ResendAPI } from "resend";
import { type RandomReader, generateRandomString } from "@oslojs/crypto/random";

export const ResendOTPPasswordReset = Resend({
    id: "resend-otp",
    apiKey: process.env.AUTH_RESEND_KEY,
    async generateVerificationToken() {
        const random: RandomReader = {
            read(bytes) {
                crypto.getRandomValues(bytes as unknown as Uint8Array<ArrayBuffer>);
            },
        };
        return generateRandomString(random, "0123456789", 8);
    },
    async sendVerificationRequest({ identifier: email, provider, token }) {
        const resend = new ResendAPI(provider.apiKey);
        const { error } = await resend.emails.send({
            from: "TD Holdings <noreply@yourdomain.com>",
            to: [email],
            subject: "Reset your TD password",
            text: `Your password reset code is: ${token}\n\nThis code expires shortly. If you didn't request this, ignore this email.`,
        });
        if (error) throw new Error("Could not send reset email");
    },
});