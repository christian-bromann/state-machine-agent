import { createAgent, HumanMessage } from "langchain";
import { MemorySaver } from "@langchain/langgraph";

import { stateClassificationMiddleware } from "./middleware.js";
import { agentSystemPrompt } from "./prompts.js";
import { runAgent } from "./utils.js";

const checkpointer = new MemorySaver();
const agent = createAgent({
  model: "openai:gpt-4o",
  middleware: [stateClassificationMiddleware] as const,
  systemPrompt: agentSystemPrompt,
  checkpointer,
});

const config = {
  recursionLimit: 100,
  configurable: {
    thread_id: "example-thread-123",
  },
};

// ====== DEMO SCENARIOS ======
console.log("🚀 Starting Cline Agent Demo\n");

// Scenario 1: Ambiguous request (should trigger QUESTION state)
console.log("=".repeat(50));
console.log("SCENARIO 1: Ambiguous Request");
console.log("=".repeat(50));

const result1 = await runAgent(
  agent,
  [new HumanMessage("Fix the bug")],
  config
);
console.log("\n📤 Agent Response:", result1.messages.at(-1)?.content);

// Scenario 2: Clear action request (should trigger ACTION state)
console.log(`\n${"=".repeat(50)}`);
console.log("SCENARIO 2: Clear Action Request");
console.log("=".repeat(50));

const result2 = await runAgent(
  agent,
  [
    new HumanMessage(
      "Find all TypeScript files in the ./src directory and look for any TODO comments"
    ),
  ],
  config
);
console.log("\n📤 Agent Response:", result2.messages.at(-1)?.content);

// Scenario 3: Request for results (should trigger COMPLETION state)
console.log(`\n${"=".repeat(50)}`);
console.log("SCENARIO 3: Request for Summary");
console.log("=".repeat(50));

// First, let the agent build some context by finding files
const contextBuildResult = await runAgent(
  agent,
  [
    new HumanMessage(
      "Find all TypeScript files in the ./src directory"
    ),
  ],
  config
);

// Then ask for a summary (this should trigger COMPLETION state)
const result3 = await runAgent(
  agent,
  [
    ...contextBuildResult.messages,
    new HumanMessage("Now show me a summary of what you found"),
  ],
  config
);
console.log("\n📤 Agent Response:", result3.messages.at(-1)?.content);

console.log(
  "\n🎉 Demo completed! The agent successfully classified requests into the 3 states:"
);
console.log("  🤔 QUESTION: For ambiguous requests needing clarification");
console.log("  ⚡ ACTION: For gathering context and taking action");
console.log("  ✅ COMPLETION: For presenting final results");
