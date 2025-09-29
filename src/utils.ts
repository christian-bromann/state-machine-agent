import readline, { type Interface } from "node:readline/promises";

import type { ReactAgent, BaseMessage, Interrupt } from "langchain";
import type { RunnableConfig } from "@langchain/core/runnables";
import { Command } from "@langchain/langgraph";

interface InterruptRequest {
  type: string;
  label: string;
}

/**
 * Helper function that triggers the agent and handles interrupts.
 * It will loop over the interrupt requests and ask the user for input using readline.
 * It will then resume the agent with the user's input.
 *
 * @param agent - The agent to run.
 * @param messages - The messages to send to the agent.
 * @param config - The config to pass to the agent.
 * @returns The result of the agent.
 */
export async function runAgent(
  agent: ReactAgent,
  messages: BaseMessage[],
  config: RunnableConfig
) {
  let result = await agent.invoke(
    {
      messages,
    },
    config
  );

  let rl: Interface | undefined = undefined;
  while (result.__interrupt__) {
    if (!rl) {
      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }

    const interruptRequest = result
      .__interrupt__?.[0] as Interrupt<InterruptRequest>;

    let response = '';
    do {
      response = await rl.question(interruptRequest.value.label);
      if (!response.trim()) {
        if (interruptRequest.value.label.includes('y/N')) {
          response = 'N';
          break;
        }
        console.log('Please provide a value. Empty responses are not allowed.');
      }
    } while (!response.trim());

    result = await agent.invoke(
      new Command({
        resume: response,
      }),
      config
    );
  }

  rl?.close();
  return result;
}
