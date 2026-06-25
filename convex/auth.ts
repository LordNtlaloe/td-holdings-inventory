import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import type { DataModel } from "./_generated/dataModel";
import { ResendOTPPasswordReset } from "./resend.otp.password.reset";

export const { auth, signIn, signOut, store, isAuthenticated } =
  convexAuth({
    providers: [
      Password<DataModel>({
        reset: ResendOTPPasswordReset,
        profile(params) {
          const role =
            (params.role as
              | "super_admin"
              | "admin"
              | "manager"
              | "cashier"
              | undefined) ?? "cashier";

          return {
            email: params.email as string,
            name: (params.name as string | undefined) ?? (params.email as string),
            image: params.image as string | undefined,
            role,
            status: "active" as const,
          };
        },
        validatePasswordRequirements(password: string) {
          if (password.length < 8) {
            throw new Error("Password must be at least 8 characters");
          }
        },
      }),
    ],
  });