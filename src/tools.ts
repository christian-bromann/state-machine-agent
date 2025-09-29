import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import { glob } from "glob";

import { interrupt } from "@langchain/langgraph";
import { tool } from "langchain";

// ====== TASK MANAGEMENT TOOLS ======
// Tools for managing task lifecycle
export const newTask = tool(
  async ({ taskDescription, reasoning }) => {
    console.log(`\n📋 NEW TASK IDENTIFIED:`);
    console.log(`🎯 Task: ${taskDescription}`);
    console.log(`💭 Reasoning: ${reasoning}`);

    return interrupt({
      type: "task_confirmation",
      label: "❓ Is this task correct? (y/N): ",
    });
  },
  {
    name: "new_task",
    description: "Define a new task based on user request and get confirmation",
    schema: z.object({
      taskDescription: z
        .string()
        .describe("Clear description of what needs to be done"),
      reasoning: z
        .string()
        .describe("Why this task was identified from the user's request"),
    }),
  }
);

// ====== QUESTION TOOLS ======
// Tools that ask for clarification from the user
export const askForClarification = tool(
  async ({ question, context }) => {
    console.log(`\n🤔 QUESTION: ${question}`);
    console.log(`📝 Context: ${context}`);

    return interrupt({
      type: "clarification",
      label: "❓ Please provide clarification: ",
    });
  },
  {
    name: "ask_for_clarification",
    description:
      "Ask the user for clarification when the request is ambiguous or needs more information",
    schema: z.object({
      question: z.string().describe("The specific question to ask the user"),
      context: z.string().describe("Why this clarification is needed"),
    }),
  }
);

// ====== ACTION TOOLS ======
// Tools that gather context and perform work
export const readFile = tool(
  async ({ filepath }) => {
    console.log(`📖 READING: ${filepath}`);

    try {
      // Resolve the path relative to current working directory
      const fullPath = path.resolve(filepath);

      // Check if file exists and is readable
      await fs.access(fullPath, fs.constants.R_OK);

      const content = await fs.readFile(fullPath, "utf-8");
      const lines = content.split("\n").length;
      const size = content.length;

      // Truncate very large files for readability
      const truncatedContent =
        content.length > 5000
          ? `${content.substring(
              0,
              5000
            )}\n\n... [File truncated - showing first 5000 characters of ${size} total]`
          : content;

      return `File: ${filepath} (${lines} lines, ${size} characters)
${truncatedContent}`;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return `Error: File "${filepath}" does not exist.`;
      } else if (error.code === "EACCES") {
        return `Error: Permission denied reading "${filepath}".`;
      } else {
        return `Error reading "${filepath}": ${error.message}`;
      }
    }
  },
  {
    name: "read_file",
    description:
      "Read and examine the contents of a file to understand code structure",
    schema: z.object({
      filepath: z.string().describe("Path to the file to read"),
    }),
  }
);

export const listFiles = tool(
  async ({ directory, pattern }) => {
    console.log(
      `📁 LISTING: ${directory} (pattern: ${pattern || "all files"})`
    );

    try {
      const fullPath = path.resolve(directory);

      // Check if directory exists and is readable
      await fs.access(fullPath, fs.constants.R_OK);

      const items = await fs.readdir(fullPath, { withFileTypes: true });

      let files = items.map((item) => {
        const name = item.name;
        if (item.isDirectory()) {
          return `${name}/`;
        } else {
          return name;
        }
      });

      // Apply pattern filtering if provided
      if (pattern) {
        if (pattern.includes(".ts") || pattern.includes("typescript")) {
          files = files.filter(
            (file) => file.endsWith(".ts") || file.endsWith(".tsx")
          );
        } else if (pattern.startsWith("*")) {
          // Handle glob patterns
          const regex = new RegExp(pattern.replace(/\*/g, ".*"));
          files = files.filter((file) => regex.test(file));
        } else {
          // Simple substring matching
          files = files.filter((file) => file.includes(pattern));
        }
      }

      // Sort files: directories first, then files alphabetically
      files.sort((a, b) => {
        const aIsDir = a.endsWith("/");
        const bIsDir = b.endsWith("/");
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a.localeCompare(b);
      });

      if (files.length === 0) {
        const message = `No files found in "${directory}"${
          pattern ? ` matching pattern "${pattern}"` : ""
        }.`;
        return message;
      }

      const message = `Files in ${directory} (${files.length} items):
${files.map((file) => `  ${file}`).join("\n")}`;
      return message;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return `Error: Directory "${directory}" does not exist.`;
      } else if (error.code === "EACCES") {
        return `Error: Permission denied accessing "${directory}".`;
      } else {
        return `Error listing "${directory}": ${error.message}`;
      }
    }
  },
  {
    name: "list_files",
    description: "List files in a directory to understand project structure",
    schema: z.object({
      directory: z.string().describe("Directory path to list"),
      pattern: z
        .string()
        .optional()
        .describe("Optional file pattern to filter by"),
    }),
  }
);

export const searchFiles = tool(
  async ({ query, fileTypes }) => {
    console.log(
      `🔍 SEARCHING: "${query}" in ${fileTypes?.join(", ") || "all"} files`
    );

    try {
      // Build glob pattern based on file types
      let globPattern = "**/*";
      if (fileTypes && fileTypes.length > 0) {
        if (fileTypes.length === 1) {
          globPattern = `**/*.${fileTypes[0]}`;
        } else {
          globPattern = `**/*.{${fileTypes.join(",")}}`;
        }
      }

      // Find all matching files
      const files = await glob(globPattern, {
        ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
        nodir: true,
      });

      const matches: Array<{ file: string; line: number; content: string }> =
        [];

      // Search through each file
      for (const file of files) {
        try {
          const content = await fs.readFile(file, "utf-8");
          const lines = content.split("\n");

          lines.forEach((line, index) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
              matches.push({
                file,
                line: index + 1,
                content: line.trim(),
              });
            }
          });
        } catch (error) {
          // Skip files that can't be read (binary files, permission issues, etc.)
          continue;
        }
      }

      if (matches.length === 0) {
        const message = `No matches found for "${query}"${
          fileTypes ? ` in ${fileTypes.join(", ")} files` : ""
        }.`;
        return message;
      }

      // Group matches by file and limit results
      const maxMatches = 50;
      const limitedMatches = matches.slice(0, maxMatches);

      const groupedMatches = limitedMatches.reduce((acc, match) => {
        if (!acc[match.file]) {
          acc[match.file] = [];
        }
        acc[match.file].push(match);
        return acc;
      }, {} as Record<string, typeof matches>);

      let results = `Search results for "${query}": Found ${
        matches.length
      } matches in ${Object.keys(groupedMatches).length} files`;

      if (matches.length > maxMatches) {
        results += ` (showing first ${maxMatches})`;
      }

      results += ":\n";

      for (const [file, fileMatches] of Object.entries(groupedMatches)) {
        results += `\n📄 ${file}:\n`;
        fileMatches.forEach((match) => {
          results += `  Line ${match.line}: ${match.content}\n`;
        });
      }

      return results;
    } catch (error: any) {
      return `Error searching files: ${error.message}`;
    }
  },
  {
    name: "search_files",
    description:
      "Search for patterns, functions, or text across files in the codebase",
    schema: z.object({
      query: z.string().describe("Text or pattern to search for"),
      fileTypes: z
        .array(z.string())
        .optional()
        .describe("File extensions to search in (e.g. ['ts', 'tsx'])"),
    }),
  }
);

export const writeToFile = tool(
  async ({ filepath, content, mode = "overwrite" }) => {
    console.log(`✏️  WRITING: ${filepath} (${mode})`);
    console.log(
      `📝 Content preview: ${content.substring(0, 100)}${
        content.length > 100 ? "..." : ""
      }`
    );

    try {
      const fullPath = path.resolve(filepath);

      // Create directory if it doesn't exist
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });

      // Check if file exists for safety warning
      let fileExists = false;
      try {
        await fs.access(fullPath);
        fileExists = true;
      } catch {
        // File doesn't exist, which is fine
      }

      if (mode === "append") {
        await fs.appendFile(fullPath, content, "utf-8");
        return `Successfully appended ${content.length} characters to ${filepath}`;
      } else {
        // Overwrite mode
        if (fileExists) {
          // Create backup
          const backupPath = `${fullPath}.backup.${Date.now()}`;
          await fs.copyFile(fullPath, backupPath);
          console.log(`📋 Created backup: ${backupPath}`);
        }

        await fs.writeFile(fullPath, content, "utf-8");
        const action = fileExists ? "overwrote" : "created";
        return `Successfully ${action} ${filepath} with ${content.length} characters`;
      }
    } catch (error: any) {
      if (error.code === "EACCES") {
        return `Error: Permission denied writing to "${filepath}".`;
      } else {
        return `Error writing to "${filepath}": ${error.message}`;
      }
    }
  },
  {
    name: "write_to_file",
    description:
      "Write or modify file contents to make changes to the codebase",
    schema: z.object({
      filepath: z.string().describe("Path to the file to write"),
      content: z.string().describe("Content to write to the file"),
      mode: z
        .enum(["overwrite", "append"])
        .optional()
        .describe("Whether to overwrite or append to the file"),
    }),
  }
);

// ====== COMPLETION TOOLS ======
// Tools that present final results to the user
export const attemptCompletion = tool(
  async ({ summary, details, nextSteps }) => {
    console.log(`\n✅ ATTEMPTING COMPLETION:`);
    console.log(`📊 Summary: ${summary}`);
    console.log(`📋 Details: ${details}`);
    if (nextSteps) {
      console.log(`🚀 Next Steps: ${nextSteps}`);
    }

    console.log(`\n💭 SATISFACTION CHECK:`);
    return interrupt({
      type: "satisfaction_check",
      label: "❓ Are you satisfied with these results? (y/N): ",
    });
  },
  {
    name: "attempt_completion",
    description:
      "Present final results and check if user is satisfied with the work",
    schema: z.object({
      summary: z.string().describe("Brief summary of what was accomplished"),
      details: z.string().describe("Detailed explanation of the results"),
      nextSteps: z
        .string()
        .optional()
        .describe("Suggested next steps or follow-up actions"),
    }),
  }
);
