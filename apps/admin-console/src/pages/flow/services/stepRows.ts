import type { ExecutionRequirement } from '@odudu/contracts/admin';
import { authenticatorText } from '#/pages/flow/services/flowWording';
import { OTP, requirementText } from '#/pages/flow/services/requirement';
import { canMove, type Direction, type Step } from '#/pages/flow/services/steps';

export interface MoveButton {
  label: string;
  enabled: boolean;
}

// A step as the list draws it: its position, what it is and asks, and the
// two moves it may make.
export interface StepRow {
  authenticator: string;
  position: number;
  disabled: boolean;
  what: string;
  requirementWhat: string;
  // Whom the one-time password step asks, on that step alone.
  otpReading: string | null;
  requirement: ExecutionRequirement;
  requirementLabel: string;
  up: MoveButton;
  down: MoveButton;
}

export function moveLabel(authenticator: string, direction: Direction): string {
  return `Move ${authenticator} ${direction}`;
}

function moveButton(steps: readonly Step[], authenticator: string, direction: Direction) {
  return {
    label: moveLabel(authenticator, direction),
    enabled: canMove(steps, authenticator, direction),
  };
}

export function stepRows(steps: readonly Step[], reading: string | null): StepRow[] {
  return steps.map((step, at) => ({
    authenticator: step.authenticator,
    position: at + 1,
    disabled: step.requirement === 'disabled',
    what: authenticatorText(step.authenticator),
    requirementWhat: requirementText(step.requirement),
    otpReading: step.authenticator === OTP ? reading : null,
    requirement: step.requirement,
    requirementLabel: `Requirement for ${step.authenticator}`,
    up: moveButton(steps, step.authenticator, 'up'),
    down: moveButton(steps, step.authenticator, 'down'),
  }));
}

export function offeredOptions(names: readonly string[]): { id: string; label: string }[] {
  return names.map((name) => ({ id: name, label: name }));
}
