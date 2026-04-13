import { z } from "zod";

export const voiceContextInputSchema = z.object({
  staffId: z.string().min(1).optional(),
  callerPhone: z.string().min(3).optional(),
  jobId: z.string().min(1).optional(),
  callerName: z.string().min(1).optional(),
  customerName: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  issue: z.string().min(1).optional(),
});

export const quoteInputSchema = z
  .object({
    staffId: z.string().min(1),
    jobId: z.string().min(1),
    callerPhone: z.string().min(3),
    issue: z.string().min(1).optional(),
    urgency: z.enum(["low", "medium", "high"]).optional(),
    complexity: z.number().min(1).max(10).optional(),
    hours: z.number().min(0.25).max(24).optional(),
    materialsEstimate: z.number().min(0).max(50000).optional(),
    rush: z.boolean().optional(),
    location: z.string().min(1).optional(),
  })
  .strict();

export const appointmentInputSchema = z
  .object({
    staffId: z.string().min(1),
    jobId: z.string().min(1),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    timezone: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
    outlookEventId: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.startAt == null && value.endAt == null) ||
      (value.startAt != null && value.endAt != null),
    {
      message: "startAt and endAt must be provided together",
      path: ["startAt"],
    },
  );

export const callbackInputSchema = z
  .object({
    staffId: z.string().min(1),
    jobId: z.string().min(1),
    callerPhone: z.string().min(3),
    reason: z.string().min(3),
    dueAt: z.string().datetime().optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const sendPhotoLinkInputSchema = z
  .object({
    staffId: z.string().min(1),
    jobId: z.string().min(1),
    callerPhone: z.string().min(3),
    notes: z.string().min(1).optional(),
    ttlHours: z.number().min(1).max(168).optional(),
  })
  .strict();

export const postCallInputSchema = z
  .object({
    staffId: z.string().min(1).optional(),
    callId: z.string().min(1).optional(),
    jobId: z.string().min(1).optional(),
    callerPhone: z.string().min(3).optional(),
    direction: z.enum(["inbound", "outbound"]).optional(),
    status: z
      .enum([
        "received",
        "in_progress",
        "completed",
        "callback_requested",
        "transferred",
        "abandoned",
      ])
      .optional(),
    transcript: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    disposition: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => value.callId != null || value.jobId != null, {
    message: "callId or jobId is required",
    path: ["callId"],
  });

export const staffInviteInputSchema = z
  .object({
    fullName: z.string().min(1),
    phoneNumber: z.string().min(3).optional(),
    email: z.email().optional(),
    role: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
  })
  .strict();

export const staffOtpVerificationInputSchema = z
  .object({
    staffId: z.string().min(1).optional(),
    inviteToken: z.string().min(8),
    otpCode: z.string().regex(/^\d{6}$/),
  })
  .strict();

export const voiceConsentInputSchema = z
  .object({
    staffId: z.string().min(1),
    consent: z.boolean(),
    signedBy: z.string().min(1).optional(),
    capturedAt: z.string().datetime().optional(),
  })
  .strict();

export const pricingInterviewInputSchema = z
  .object({
    staffId: z.string().min(1),
    responses: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const calendarConnectInputSchema = z
  .object({
    staffId: z.string().min(1),
    provider: z.literal("outlook").default("outlook"),
    accountEmail: z.email().optional(),
    calendarId: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    externalConnectionId: z.string().min(1).optional(),
  })
  .strict();

export type ValidationSchema<T> = z.ZodType<T>;
