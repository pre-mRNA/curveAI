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

export const voiceContextInputSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    staffId: z.string().min(1).optional(),
    callerPhone: z.string().min(3).optional(),
    callerName: z.string().min(1).optional(),
    customerName: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    suburb: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    postcode: z.string().min(1).optional(),
    issue: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
  })
  .strict();

export const voiceQuoteInputSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    staffId: z.string().min(1).optional(),
    callerPhone: z.string().min(3).optional(),
    callerName: z.string().min(1).optional(),
    customerName: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    suburb: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    postcode: z.string().min(1).optional(),
    issue: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    urgency: z.string().min(1).optional(),
    complexity: z.number().min(0).max(10).optional(),
    hours: z.number().min(0).max(24).optional(),
    materialsEstimate: z.number().min(0).max(100000).optional(),
    rush: z.boolean().optional(),
  })
  .strict();

export const voiceCallbackInputSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    staffId: z.string().min(1).optional(),
    callerPhone: z.string().min(3).optional(),
    reason: z.string().min(1),
    dueAt: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const voiceAppointmentInputSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    staffId: z.string().min(1).optional(),
    startAt: z.string().min(1).optional(),
    endAt: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
    outlookEventId: z.string().min(1).optional(),
  })
  .strict();

export const sendPhotoLinkInputSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    staffId: z.string().min(1).optional(),
    callerPhone: z.string().min(3).optional(),
    notes: z.string().min(1).optional(),
    ttlHours: z.number().min(1).max(168).optional(),
  })
  .strict();

export const voicePostCallInputSchema = z
  .object({
    callId: z.string().min(1),
    jobId: z.string().min(1).optional(),
    staffId: z.string().min(1).optional(),
    callerPhone: z.string().min(3).optional(),
    direction: z.enum(["inbound", "outbound"]).default("inbound"),
    status: z.enum(["received", "in_progress", "completed", "callback_requested", "transferred", "abandoned"]),
    transcript: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    disposition: z.string().min(1).optional(),
  })
  .strict();
