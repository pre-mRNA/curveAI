import type { PricingExperiment, PricingInterview, Quote } from "./domain.js";

export type PricingSignal = {
  urgency: "low" | "medium" | "high";
  complexity: "simple" | "standard" | "complex";
  afterHours: boolean;
  estimatedHours: number;
  materialsCost: number;
  travelKm: number;
};

export type PricingComputationInput = {
  baseCallout: number;
  experiment: PricingExperiment;
  interview?: PricingInterview;
  signal: PricingSignal;
  variant: Quote["variant"];
};

const urgencyMultiplier: Record<PricingSignal["urgency"], number> = {
  low: 1,
  medium: 1.08,
  high: 1.18,
};

const complexityMultiplier: Record<PricingSignal["complexity"], number> = {
  simple: 1,
  standard: 1.14,
  complex: 1.28,
};

export function chooseVariant(seed: string): Quote["variant"] {
  const bucket = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
  if (bucket === 1) {
    return "surge";
  }
  if (bucket === 2) {
    return "discount";
  }
  return "control";
}

export function computeQuote(input: PricingComputationInput): Omit<Quote, "id" | "jobId" | "staffId" | "status"> {
  const labour = input.signal.estimatedHours * 145;
  const travel = input.signal.travelKm * 2.2;
  const afterHours = input.signal.afterHours ? 85 : 0;

  const rawBase =
    (input.baseCallout + labour + input.signal.materialsCost + travel + afterHours) *
    urgencyMultiplier[input.signal.urgency] *
    complexityMultiplier[input.signal.complexity];

  const heuristicBias =
    input.interview?.heuristics.some((value) => /premium|margin|urgency/i.test(value)) ? 0.06 : 0;

  const strategyAdjustment = rawBase * heuristicBias;

  const experimentMultiplier =
    input.variant === "surge"
      ? input.experiment.surgeMultiplier
      : input.variant === "discount"
        ? input.experiment.discountMultiplier
        : input.experiment.controlMultiplier;

  const experimentAdjustment = rawBase * (experimentMultiplier - 1);
  const unclamped = rawBase + strategyAdjustment + experimentAdjustment;
  const presentedPrice = clamp(unclamped, input.experiment.floorPrice, input.experiment.ceilingPrice);

  const rationale = [
    `Base workload calculated from ${input.signal.estimatedHours.toFixed(1)} labour hours and travel.`,
    `Urgency ${input.signal.urgency} and complexity ${input.signal.complexity} were applied as weighted multipliers.`,
    `Variant ${input.variant} used multiplier ${experimentMultiplier.toFixed(2)} inside guardrails.`,
  ];

  if (strategyAdjustment > 0) {
    rationale.push("Staff pricing interview heuristics nudged margin upward.");
  }

  return {
    variant: input.variant,
    basePrice: roundCurrency(rawBase),
    strategyAdjustment: roundCurrency(strategyAdjustment),
    experimentAdjustment: roundCurrency(experimentAdjustment),
    presentedPrice: roundCurrency(presentedPrice),
    floorPrice: input.experiment.floorPrice,
    ceilingPrice: input.experiment.ceilingPrice,
    confidence: computeConfidence(input.signal),
    rationale,
  };
}

function computeConfidence(signal: PricingSignal): number {
  const deductions =
    (signal.complexity === "complex" ? 0.18 : 0) +
    (signal.urgency === "high" ? 0.1 : 0) +
    (signal.materialsCost > 600 ? 0.08 : 0);

  return Math.max(0.42, roundConfidence(0.92 - deductions));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}
