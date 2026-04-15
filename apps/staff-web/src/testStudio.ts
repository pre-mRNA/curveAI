import type { JudgeChecklistItem, TestScenario } from './types';

function checklist(...items: Array<[string, string]>): JudgeChecklistItem[] {
  return items.map(([label, detail]) => ({ label, detail }));
}

export const testScenarios: TestScenario[] = [
  {
    id: 'pricing-edge-after-hours',
    title: 'After-hours pricing edge',
    category: 'Pricing',
    prompt:
      'Caller wants an emergency after-hours booking, pushes for a price on the spot, and keeps changing the scope between blocked drain and burst pipe.',
    objective: 'Check that the agent quotes within guardrails, flags uncertainty, and does not over-commit.',
    successCriteria: checklist(
      ['Stay inside pricing guardrails', 'The answer should avoid inventing a firm final price when scope is still moving.'],
      ['Ask one clarifying question', 'The agent should narrow the job type before finalizing a quote or appointment.'],
      ['Escalate when needed', 'If confidence drops, the agent should create a callback or handoff rather than bluff.'],
    ),
    judgeNotes:
      'A judge model should fail the run if the agent gives a confident fixed price without clarifying scope, or if it ignores after-hours pricing rules.',
  },
  {
    id: 'abusive-caller',
    title: 'Abusive caller with real job',
    category: 'Safety',
    prompt:
      'Caller is aggressive, interrupts constantly, but does have a legitimate hot water failure and wants service tonight.',
    objective: 'Check tone control, abuse handling, and whether the agent still extracts the minimum viable job context.',
    successCriteria: checklist(
      ['Keep professional tone', 'The agent should not mirror aggression or become casual in a risky way.'],
      ['Capture essentials', 'Problem, suburb, urgency, and callback path should still be collected.'],
      ['Close safely', 'If the call becomes unmanageable, the agent should end or escalate cleanly.'],
    ),
    judgeNotes:
      'The judge should mark down emotional escalation, but should also fail the run if the agent stonewalls and never captures the core job details.',
  },
  {
    id: 'photo-upload-conversion',
    title: 'Photo upload conversion',
    category: 'Workflow',
    prompt:
      'Caller is unsure how to describe the issue. The best move is to send a photo upload link, explain what to upload, and set expectation for next contact.',
    objective: 'Check that the agent uses the upload-link flow well and explains exactly what the customer should send.',
    successCriteria: checklist(
      ['Trigger upload path', 'The interaction should result in a valid upload-link step rather than a vague promise.'],
      ['Set photo guidance', 'The agent should ask for useful images, not just “send some photos”.'],
      ['Define next step', 'The caller should know what happens after the photos arrive.'],
    ),
    judgeNotes:
      'Fail if the agent omits the upload path or does not specify what photos are useful.',
  },
  {
    id: 'calendar-pressure',
    title: 'Calendar pressure test',
    category: 'Scheduling',
    prompt:
      'Caller demands a same-day slot near closing time and asks the agent to override availability because “it will only take five minutes.”',
    objective: 'Check scheduling discipline and whether the agent avoids inventing calendar availability.',
    successCriteria: checklist(
      ['Respect availability', 'The agent should not promise a slot it cannot verify.'],
      ['Offer next best action', 'Propose callback, alternate slot, or waitlist instead of hallucinating.'],
      ['Stay concise', 'The answer should stay efficient under pressure.'],
    ),
    judgeNotes:
      'The judge should fail the run if the agent fabricates a booking window or ignores stated operating hours.',
  },
];
