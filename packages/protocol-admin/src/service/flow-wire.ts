import { type Flow } from '@odudu/authn-flows';
import { type FlowStepWire, type FlowWire } from '@odudu/contracts/admin';

// A step without its position, which is its place in the array.
export function stepWireShape(step: FlowStepWire): FlowStepWire {
  return {
    authenticator: step.authenticator,
    requirement: step.requirement,
    ...(step.settings === undefined ? {} : { settings: step.settings }),
  };
}

export function flowWireShape(flow: Flow): FlowWire {
  return {
    id: flow.id,
    name: flow.name,
    is_default: flow.isDefault,
    steps: flow.steps.map(stepWireShape),
  };
}
