import { format } from "node:util";

import { z } from "zod";
import { createMiddleware } from "langchain";

import { classificationPromptTemplate } from "./prompts.js";
import {
    newTask,
    askForClarification,
    readFile,
    listFiles,
    searchFiles,
    writeToFile,
    attemptCompletion,
  } from "./tools.js";

const stateSchema = z.object({
  contextHistory: z.array(z.string()).default([]),
  currentTask: z.string().optional(),
});

export const stateClassificationMiddleware = createMiddleware({
  name: "RecursiveLoopMiddleware",
  stateSchema,
  tools: [
    newTask,
    askForClarification,
    readFile,
    listFiles,
    searchFiles,
    writeToFile,
    attemptCompletion,
  ],
  modifyModelRequest: async (request, state, runtime) => {
    const currentHistory = state.contextHistory ?? [];
    const currentTask = state.currentTask;

    /**
     * end the loop if the user is satisfied
     */
    const lastToolCall = runtime.toolCalls.at(-1);

    /**
     * end the loop if the user is satisfied, that is:
     * - there is a history of tool calls
     * - the last tool call is an attempt_completion
     * - the result of the last tool call includes "y"
     */
    const isUserSatisfied =
      currentHistory.length > 0 &&
      lastToolCall?.name === "attempt_completion" &&
      (lastToolCall?.result as string)?.toLowerCase().includes("y");

    if (isUserSatisfied) {
      return {
        ...request,
        tools: [], // No tools available - task is done
        systemPrompt:
          "Task has been completed successfully. No further actions needed.",
        toolChoice: "none" as const,
      };
    }

    /**
     * get the system prompt
     */
    const systemPrompt = format(
      classificationPromptTemplate,
      currentTask || "No active task",
      currentHistory.join(" → "),
      currentTask
        ? `FOCUS: You are working on "${currentTask}". If it mentions a specific file, work with that file directly!`
        : "START: Define a new task first"
    );

    /**
     * return the modified request
     */
    return {
      ...request,
      systemPrompt,
      toolChoice: "required", // Force tool usage
    };
  },
  afterModel: (state, runtime) => {
    /**
     * add tool results to context and loop back
     */
    const lastToolCall = runtime.toolCalls.at(-1);
    const result = (lastToolCall?.result as string) || "";
    if (lastToolCall?.name === "new_task") {
      if (result.includes("NEW TASK CONFIRMED:")) {
        // Extract and set current task
        const taskMatch = result.match(
          /NEW TASK CONFIRMED: (task_\d+) - "([^"]+)"/
        );
        return {
          currentTask: taskMatch?.[2],
          contextHistory: [
            ...(state.contextHistory || []),
            `Started task: ${taskMatch?.[2]}`,
          ],
        };
      }

      if (result.includes("TASK FEEDBACK:")) {
        const feedbackMatch = result.match(/TASK FEEDBACK: "([^"]+)"/);
        if (feedbackMatch) {
          return {
            contextHistory: [
              ...(state.contextHistory || []),
              `Task feedback: ${feedbackMatch?.[1]}`,
            ],
          };
        }
      }
    }

    /**
     * clear context and task
     */
    if (lastToolCall?.name === "attempt_completion" && result.includes("y")) {
      return {
        contextHistory: [],
        currentTask: undefined,
      };
    }

    /**
     * For all other tools, just add a simple context note
     */
    const hasError =
      result.includes("Error:") || result.includes("does not exist");
    return {
      contextHistory: [
        ...(state.contextHistory || []),
        hasError
          ? `${lastToolCall?.name}: encountered error`
          : `${lastToolCall?.name}: completed successfully`,
      ],
    };
  },
});
