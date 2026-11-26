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
import type { TaskProfile } from '#/service/profile';
import { runKey, RunLapsed } from '#/service/run-key';
import { assistantTools } from '#/service/tool-set';
import { buildSystemPrompt } from '#/service/system-prompt';
import { toSdkTools } from '#/service/tool-bridge';

export interface RunTurnDeps {
  readonly model: LanguageModel;
  readonly profile: TaskProfile;
  readonly tenantText: string;
  readonly tools: readonly RegisteredTool[];
  readonly history: (conversationId: string) => Promise<readonly UIMessage[]>;
  // A short admin token for one call, acting for the conversation's agent
  // instance; `key` names the run and `conversationId` the conversation whose
  // grant it acts on. Calls running at once in one step share a key, so the
  // minting must be safe under it. It throws `RunLapsed` when the instance ran
  // out from idleness.
  readonly mintToken: (
    run: { key: string; conversationId: string },
    signal?: AbortSignal,
  ) => Promise<{ accessToken: string }>;
  // Moves the conversation to the run after `observed`, once however many
  // callers saw it lapse, and answers the generation it is on. Without it a
  // lapse is the call's refusal.
  readonly advanceRun?: (observed: number) => Promise<number>;
  readonly callTool: (
    accessToken: string,
    name: string,
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
}

export interface TurnInput {
  readonly conversationId: string;
  // The run the conversation is on; 0 for one that has never lapsed.
  readonly generation?: number;
  readonly message: UIMessage;
  readonly signal: AbortSignal;
}

function buildAgent(deps: RunTurnDeps, tools: ToolSet) {
  const prompt = buildSystemPrompt(deps.profile, deps.tenantText);
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
  let generation = input.generation ?? 0;
  const mint = async (signal: AbortSignal | undefined) => {
    const { conversationId } = input;
    const seen = generation;
    try {
      return await deps.mintToken({ key: runKey(conversationId, seen), conversationId }, signal);
    } catch (error) {
      if (!(error instanceof RunLapsed) || deps.advanceRun === undefined) throw error;
      generation = Math.max(generation, await deps.advanceRun(seen));
      return deps.mintToken({ key: runKey(conversationId, generation), conversationId }, signal);
    }
  };
  const tools = toSdkTools(assistantTools(deps.tools), async (name, args, signal) => {
    const { accessToken } = await mint(signal);
    return deps.callTool(accessToken, name, args, signal);
  });
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
