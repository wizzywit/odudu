import { type Flow } from '@odudu/authn-flows';
import { type FlowWire } from '@odudu/contracts/admin';

export function flowWireShape(flow: Flow): FlowWire {
  return {
    id: flow.id,
    name: flow.name,
    is_default: flow.isDefault,
    steps: flow.steps.map((step) => ({
      authenticator: step.authenticator,
      requirement: step.requirement,
      ...(step.settings === undefined ? {} : { settings: step.settings }),
    })),
  };
}
