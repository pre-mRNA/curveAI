import { z } from "zod";

export const onboardingInviteInputSchema = z
  .object({
    fullName: z.string().min(1),
    phoneNumber: z.string().min(3).optional(),
    email: z.email().optional(),
    role: z.string().min(1).optional(),
    ttlHours: z.number().min(1).max(24 * 14).optional(),
  })
  .strict();

export const onboardingStartInputSchema = z
  .object({
    inviteCode: z.string().min(12),
  })
  .strict();

export const onboardingVoiceTokenInputSchema = z
  .object({
    consentAccepted: z.boolean(),
    cloneConsentAccepted: z.boolean().default(false),
  })
  .strict();

export const onboardingTurnInputSchema = z
  .object({
    speaker: z.enum(["agent", "participant", "system"]),
    text: z.string().min(1),
    questionId: z.string().min(1).optional(),
  })
  .strict();

export const onboardingReviewPatchSchema = z
  .object({
    businessSummary: z.string().min(1).optional(),
    staffProfile: z
      .object({
        staffName: z.string().min(1).optional(),
        companyName: z.string().min(1).optional(),
        role: z.string().min(1).optional(),
        calendarProvider: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    communicationProfile: z
      .object({
        tone: z.string().min(1).optional(),
        salesStyle: z.string().min(1).optional(),
        riskTolerance: z.string().min(1).optional(),
        customerHandlingRules: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    pricingProfile: z
      .object({
        quotingStyle: z.string().min(1).optional(),
        calloutPolicy: z.string().min(1).optional(),
        afterHoursPolicy: z.string().min(1).optional(),
        approvalThreshold: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    businessPractices: z
      .object({
        services: z.array(z.string().min(1)).optional(),
        serviceAreas: z.array(z.string().min(1)).optional(),
        operatingHours: z.string().min(1).optional(),
        exclusions: z.array(z.string().min(1)).optional(),
        escalationRules: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    crmDiscovery: z
      .object({
        currentSystem: z.string().min(1).optional(),
        syncPreference: z.string().min(1).optional(),
        sourceOfTruth: z.string().min(1).optional(),
        notes: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    missingFields: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const onboardingVoiceSampleInputSchema = z
  .object({
    sampleLabel: z.string().min(1),
    durationSeconds: z.number().min(5).max(600),
    transcript: z.string().min(1).optional(),
    noiseLevel: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();
