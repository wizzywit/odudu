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
import { buildSystemPrompt } from '#/service/system-prompt';
import { toSdkTools } from '#/service/tool-bridge';

export interface RunTurnDeps {
  readonly model: LanguageModel;
  readonly profile: TaskProfile;
  readonly tenantText: string;
  readonly tools: readonly RegisteredTool[];
  readonly history: (conversationId: string) => Promise<readonly UIMessage[]>;
  // A short admin token for one call, acting for the conversation's agent
  // instance; `key` is the conversation, which names the run.
  readonly mintToken: (run: { key: string }) => Promise<{ accessToken: string }>;
  readonly callTool: (accessToken: string, name: string, input: unknown) => Promise<ToolResult>;
}

export interface TurnInput {
  readonly conversationId: string;
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

/**
 * One turn of a conversation: the model answers, reading through the read
 * tools only, up to the profile's step cap. Every tool call takes its own
 * token for the conversation's instance, so none outlives the call it served.
 */
export async function runTurn(deps: RunTurnDeps, input: TurnInput): Promise<StreamResult> {
  const reads = deps.tools.filter((entry) => entry.access === 'read');
  const tools = toSdkTools(reads, async (name, args) => {
    const { accessToken } = await deps.mintToken({ key: input.conversationId });
    return deps.callTool(accessToken, name, args);
  });
  const agent = buildAgent(deps, tools);
  const earlier = boundHistory(await deps.history(input.conversationId));
  const messages = await convertToModelMessages([...earlier, input.message]);
  return agent.stream({ messages, abortSignal: input.signal });
}
