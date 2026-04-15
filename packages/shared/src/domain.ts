import { z } from "zod";

export const appointmentStatusSchema = z.enum([
  "pending",
  "confirmed",
  "reschedule_required",
  "cancelled",
]);

export const quoteStatusSchema = z.enum([
  "draft",
  "presented",
  "accepted",
  "callback_required",
]);

export const experimentVariantSchema = z.enum(["control", "surge", "discount"]);

export const locationSchema = z.object({
  address: z.string(),
  suburb: z.string(),
  state: z.string(),
  postcode: z.string(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const photoAssetSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  filename: z.string(),
  uploadedAt: z.string(),
});

export const appointmentSchema = z.object({
  id: z.string(),
  staffId: z.string(),
  jobId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: appointmentStatusSchema,
  calendarEventId: z.string().optional(),
});

export const quoteSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  staffId: z.string(),
  variant: experimentVariantSchema,
  basePrice: z.number(),
  strategyAdjustment: z.number(),
  experimentAdjustment: z.number(),
  presentedPrice: z.number(),
  floorPrice: z.number(),
  ceilingPrice: z.number(),
  confidence: z.number().min(0).max(1),
  status: quoteStatusSchema,
  rationale: z.array(z.string()),
});

export const callbackTaskSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  staffId: z.string(),
  reason: z.string(),
  dueAt: z.string(),
  status: z.enum(["open", "completed"]),
});

export const callerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  phoneNumber: z.string(),
  email: z.string().email().optional(),
});

export const callSchema = z.object({
  id: z.string(),
  staffId: z.string(),
  callerId: z.string(),
  transcript: z.string().optional(),
  recordingUrl: z.string().optional(),
  summary: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
});

export const jobCardSchema = z.object({
  id: z.string(),
  staffId: z.string(),
  caller: callerSchema,
  summary: z.string(),
  status: z.enum(["new", "quoted", "booked", "callback_required"]),
  location: locationSchema,
  quote: quoteSchema.optional(),
  appointment: appointmentSchema.optional(),
  callbackTask: callbackTaskSchema.optional(),
  photos: z.array(photoAssetSchema),
  proposedNextAction: z.string(),
});

export const pricingExperimentSchema = z.object({
  id: z.string(),
  staffId: z.string(),
  name: z.string(),
  description: z.string(),
  controlMultiplier: z.number(),
  surgeMultiplier: z.number(),
  discountMultiplier: z.number(),
  floorPrice: z.number(),
  ceilingPrice: z.number(),
});

export const pricingInterviewSchema = z.object({
  id: z.string(),
  staffId: z.string(),
  transcript: z.string(),
  heuristics: z.array(z.string()),
  serviceAreaNotes: z.array(z.string()),
  marginPreference: z.string(),
});

export const staffProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  phoneNumber: z.string(),
  outlookCalendarId: z.string().optional(),
  voiceCloneId: z.string().optional(),
  pricingInterview: pricingInterviewSchema.optional(),
});

export type Appointment = z.infer<typeof appointmentSchema>;
export type CallbackTask = z.infer<typeof callbackTaskSchema>;
export type Call = z.infer<typeof callSchema>;
export type Caller = z.infer<typeof callerSchema>;
export type JobCard = z.infer<typeof jobCardSchema>;
export type PhotoAsset = z.infer<typeof photoAssetSchema>;
export type PricingExperiment = z.infer<typeof pricingExperimentSchema>;
export type PricingInterview = z.infer<typeof pricingInterviewSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type StaffProfile = z.infer<typeof staffProfileSchema>;
