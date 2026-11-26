import type { RegisteredTool, ToolResult } from '@odudu/mcp';
import {
  convertToModelMessages,
  stepCountIs,
  ToolLoopAgent,
  wrapLanguageModel,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
} from 'ai';
import { compactHistory } from '#/service/compact';
import { boundHistory } from '#/service/context';
import { inputUpperBound } from '#/service/estimate';
import { stepLimitFor } from '#/service/limits';
import { maskEmailAddresses } from '#/service/mask-emails';
import type { TaskProfile } from '#/service/profile';
import {
  MAX_OUTPUT_TOKENS,
  MAX_REQUEST_TOKENS,
  requestParts,
  toolDefinitionsText,
} from '#/service/request-size';
import { buildSystemPrompt } from '#/service/system-prompt';
import { toSdkTools } from '#/service/tool-bridge';
import type { TurnBudgetPort } from '#/usecase/budget-hooks';

export interface RunTurnDeps {
  readonly model: LanguageModel;
  readonly profile: TaskProfile;
  readonly tenantText: string;
  // The tenant's `assistant_mask_emails`, read for each turn.
  readonly maskEmails?: boolean;
  readonly tools: readonly RegisteredTool[];
  // Reserves before each model call and settles after it; absent, the turn is unmetered.
  readonly budget?: TurnBudgetPort;
  // The tenant's most steps for one turn; the profile's own cap applies if it is lower.
  readonly maxStepsPerTurn?: number;
  readonly history: (conversationId: string) => Promise<readonly UIMessage[]>;
  // A short admin token for one call, acting for the conversation's agent
  // instance; `key` is the conversation, which names the run. Calls running
  // at once in one step share that key, so the minting must be safe under it.
  readonly mintToken: (
    run: { key: string },
    signal?: AbortSignal,
  ) => Promise<{ accessToken: string }>;
  readonly callTool: (
    accessToken: string,
    name: string,
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
}

// What the tenant chose for this turn: email addresses in the text sent to
// the provider are masked when `maskEmails` is true.
function masking(deps: RunTurnDeps): (text: string) => string {
  return deps.maskEmails === true ? maskEmailAddresses : (text) => text;
}

export interface TurnInput {
  readonly conversationId: string;
  readonly message: UIMessage;
  readonly signal: AbortSignal;
}

// Every model call goes through the budget's `markSent` first, so a call the
// process dies in the middle of is known to have reached the provider.
function metered(deps: RunTurnDeps): LanguageModel {
  const { model, budget } = deps;
  if (budget === undefined || typeof model === 'string') return model;
  return wrapLanguageModel({
    model,
    middleware: {
      wrapStream: async ({ doStream }) => {
        await budget.markSent();
        return doStream();
      },
      wrapGenerate: async ({ doGenerate }) => {
        await budget.markSent();
        return doGenerate();
      },
    },
  });
}

interface Progress {
  steps: number;
  lastFinish: string | undefined;
}

const stepLimit = (deps: RunTurnDeps): number =>
  stepLimitFor(deps.profile.maxSteps, deps.maxStepsPerTurn);

function buildAgent(
  deps: RunTurnDeps,
  tools: ToolSet,
  toolDefinitions: string,
  progress: Progress,
) {
  const prompt = buildSystemPrompt(deps.profile, masking(deps)(deps.tenantText));
  return new ToolLoopAgent({
    model: metered(deps),
    instructions: [
      { role: 'system', content: prompt.static },
      { role: 'system', content: prompt.tenant },
    ],
    tools,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    stopWhen: stepCountIs(stepLimit(deps)),
    // The compacted messages carry forward, so a long turn is trimmed once and
    // not again at every step, and what is reserved is what is sent.
    prepareStep: async ({ messages, instructions }) => {
      const fixed = inputUpperBound(requestParts(instructions, [], toolDefinitions).fixed);
      const compacted = compactHistory(messages, Math.max(0, MAX_REQUEST_TOKENS - fixed));
      await deps.budget?.beforeCall(requestParts(instructions, compacted, toolDefinitions));
      if (typeof deps.model === 'string') await deps.budget?.markSent();
      return { messages: compacted };
    },
    onStepEnd: async (step) => {
      progress.steps += 1;
      progress.lastFinish = step.finishReason;
      await deps.budget?.afterCall(step.usage);
    },
  });
}

export type StreamResult = Awaited<ReturnType<ReturnType<typeof buildAgent>['stream']>>;

export interface StartedTurn {
  readonly result: StreamResult;
  /** The tools the turn runs with, which turning its stream into UI chunks needs. */
  readonly tools: ToolSet;
  /** The steps the turn may take, and how far it has got, for the reason it ended. */
  readonly maxSteps: number;
  readonly progress: () => { steps: number; lastFinish: string | undefined };
}

/**
 * One turn of a conversation: the model answers, reading through the read
 * tools only, up to the lower of the profile's step cap and the tenant's. Every
 * tool call takes its own token for the conversation's instance, so none
 * outlives the call it served. With a budget, each model call is reserved first
 * and a refusal ends the turn.
 */
export async function startTurn(deps: RunTurnDeps, input: TurnInput): Promise<StartedTurn> {
  const reads = deps.tools.filter((entry) => entry.access === 'read');
  const tools = toSdkTools(
    reads,
    async (name, args, signal) => {
      const { accessToken } = await deps.mintToken({ key: input.conversationId }, signal);
      return deps.callTool(accessToken, name, args, signal);
    },
    masking(deps),
  );
  const progress: Progress = { steps: 0, lastFinish: undefined };
  const agent = buildAgent(deps, tools, await toolDefinitionsText(tools), progress);
  const earlier = boundHistory(await deps.history(input.conversationId));
  const messages = await convertToModelMessages([...earlier, input.message], {
    ignoreIncompleteToolCalls: true,
  });
  return {
    result: await agent.stream({ messages, abortSignal: input.signal }),
    tools,
    maxSteps: stepLimit(deps),
    progress: () => ({ ...progress }),
  };
}

export async function runTurn(deps: RunTurnDeps, input: TurnInput): Promise<StreamResult> {
  return (await startTurn(deps, input)).result;
}
