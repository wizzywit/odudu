import type { RegisteredTool, ToolResult } from '@odudu/mcp';
import {
  convertToModelMessages,
  stepCountIs,
  ToolLoopAgent,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
} from 'ai';
import { boundHistory } from '#/service/context';
import { maskEmailAddresses } from '#/service/mask-emails';
import type { TaskProfile } from '#/service/profile';
import { buildSystemPrompt } from '#/service/system-prompt';
import { toSdkTools } from '#/service/tool-bridge';

export interface RunTurnDeps {
  readonly model: LanguageModel;
  readonly profile: TaskProfile;
  readonly tenantText: string;
  // The tenant's `assistant_mask_emails`, read for each turn.
  readonly maskEmails?: boolean;
  readonly tools: readonly RegisteredTool[];
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

function buildAgent(deps: RunTurnDeps, tools: ToolSet) {
  const prompt = buildSystemPrompt(deps.profile, masking(deps)(deps.tenantText));
  return new ToolLoopAgent({
    model: deps.model,
    instructions: [
      { role: 'system', content: prompt.static },
      { role: 'system', content: prompt.tenant },
    ],
    tools,
    stopWhen: stepCountIs(deps.profile.maxSteps),
  });
}

export type StreamResult = Awaited<ReturnType<ReturnType<typeof buildAgent>['stream']>>;

export interface StartedTurn {
  readonly result: StreamResult;
  /** The tools the turn runs with, which turning its stream into UI chunks needs. */
  readonly tools: ToolSet;
}

/**
 * One turn of a conversation: the model answers, reading through the read
 * tools only, up to the profile's step cap. Every tool call takes its own
 * token for the conversation's instance, so none outlives the call it served.
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
  const agent = buildAgent(deps, tools);
  const earlier = boundHistory(await deps.history(input.conversationId));
  const messages = await convertToModelMessages([...earlier, input.message], {
    ignoreIncompleteToolCalls: true,
  });
  return { result: await agent.stream({ messages, abortSignal: input.signal }), tools };
}

export async function runTurn(deps: RunTurnDeps, input: TurnInput): Promise<StreamResult> {
  return (await startTurn(deps, input)).result;
}
