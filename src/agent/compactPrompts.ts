export const NO_TOOLS_PREAMBLE =
  'CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.\n' +
  '\n' +
  '- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.\n' +
  '- You already have all the context you need in the conversation above.\n' +
  '- Tool calls will be REJECTED and will waste your only turn - you will fail the task.\n' +
  '- Your entire response must be plain text: an <analysis> block followed by a <summary> block.\n' +
  '\n';

export const NO_TOOLS_TRAILER =
  '\n' +
  'REMINDER: Do NOT call any tools. Respond with plain text only - an <analysis> block\n' +
  'followed by a <summary> block. Tool calls will be rejected and you will fail the task.\n';

export const BASE_COMPACT_PROMPT =
  'Your task is to create a detailed summary of the conversation so far, paying close\n' +
  "attention to the user's explicit requests and your previous actions.\n" +
  'This summary should be thorough in capturing technical details, code patterns, and\n' +
  'architectural decisions that would be essential for continuing development work without\n' +
  'losing context.\n' +
  '\n' +
  'Your summary should include the following sections:\n' +
  '\n' +
  "1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail\n" +
  '2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.\n' +
  '3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created.\n' +
  '   Pay special attention to the most recent messages and include full code snippets where applicable\n' +
  '   and include a summary of why this file read or edit is important.\n' +
  '4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention\n' +
  '   to specific user feedback that you received, especially if the user told you to do something differently.\n' +
  '5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.\n' +
  '6. All user messages: List ALL user messages that are not tool results. These are critical for\n' +
  "   understanding the users' feedback and changing intent.\n" +
  '7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.\n' +
  '8. Current Work: Describe in detail precisely what was being worked on immediately before this summary\n' +
  '   request, paying special attention to the most recent messages from both user and assistant.\n' +
  '   Include file names and code snippets where applicable.\n' +
  '9. Optional Next Step: List the next step that you will take that is related to the most recent work\n' +
  "   you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent\n" +
  '   explicit requests, and the task you were working on immediately before this summary request.\n' +
  '   If your last task was concluded, then only list next steps if they are explicitly in line with the\n' +
  '   users request. Do not start on tangential requests or really old requests that were already completed\n' +
  '   without confirming with the user first.\n' +
  '   If there is a next step, include direct quotes from the most recent conversation showing exactly what\n' +
  "   task you were working on and where you left off. This should be verbatim to ensure there's no drift\n" +
  '   in task interpretation.\n';

export const DETAILED_ANALYSIS_INSTRUCTION =
  '\n' +
  'Before providing your final summary, wrap your analysis in <analysis> tags to organize\n' +
  "your thoughts and ensure you've covered all necessary points. In your analysis process:\n" +
  '\n' +
  '1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:\n' +
  "   - The user's explicit requests and intents\n" +
  "   - Your approach to addressing the user's requests\n" +
  '   - Key decisions, technical concepts and code patterns\n' +
  '   - Specific details like:\n' +
  '     - file names\n' +
  '     - full code snippets\n' +
  '     - function signatures\n' +
  '     - file edits\n' +
  '   - Errors that you ran into and how you fixed them\n' +
  '   - Pay special attention to specific user feedback that you received, especially if the\n' +
  '     user told you to do something differently.\n' +
  '2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.\n';

export const COMPACT_SYSTEM_PROMPT =
  'You are a helpful AI assistant tasked with summarizing conversations.';

export function getCompactPrompt(customInstructions?: string): string {
  const additional =
    customInstructions !== undefined && customInstructions.length > 0
      ? '\n\nAdditional Instructions:\n' + customInstructions
      : '';
  return (
    NO_TOOLS_PREAMBLE +
    BASE_COMPACT_PROMPT +
    DETAILED_ANALYSIS_INSTRUCTION +
    additional +
    NO_TOOLS_TRAILER
  );
}
