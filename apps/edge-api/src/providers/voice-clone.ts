import type { VoiceSampleAssessment } from "../models.js";

export interface VoiceCloneProvider {
  assessSample(input: {
    sampleLabel: string;
    durationSeconds: number;
    transcript?: string;
    noiseLevel?: "low" | "medium" | "high";
  }): Promise<VoiceSampleAssessment>;
}

export class HeuristicVoiceCloneProvider implements VoiceCloneProvider {
  async assessSample(input: {
    sampleLabel: string;
    durationSeconds: number;
    transcript?: string;
    noiseLevel?: "low" | "medium" | "high";
  }): Promise<VoiceSampleAssessment> {
    const transcriptLength = input.transcript?.trim().length ?? 0;
    const durationScore = Math.min(Math.max(input.durationSeconds / 90, 0.2), 1);
    const noisePenalty =
      input.noiseLevel === "high" ? 0.35 : input.noiseLevel === "medium" ? 0.18 : 0.05;
    const transcriptBonus = transcriptLength > 80 ? 0.08 : 0;
    const qualityScore = Number(
      Math.max(0.15, Math.min(0.98, durationScore - noisePenalty + transcriptBonus)).toFixed(2),
    );

    return {
      sampleLabel: input.sampleLabel,
      recommendedForClone: qualityScore >= 0.62,
      qualityScore,
      reasons:
        qualityScore >= 0.62
          ? ["The sample length and clarity are sufficient for a first cloning pass."]
          : [
              "Record a longer sample in a quieter environment.",
              "Use a headset or phone mic close to the speaker and avoid interruptions.",
            ],
      durationSeconds: input.durationSeconds,
      capturedAt: new Date().toISOString(),
    };
  }
}
