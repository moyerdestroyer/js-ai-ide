// aiConstants.js - Shared constants for AI operations
export const MODEL_NAME = 'onnx-community/Qwen2.5-Coder-0.5B-ONNX';

// Timeout for AI completion generation (in milliseconds)
// Increase this value if you're using larger models that take longer to generate
export const COMPLETION_TIMEOUT_MS = 60000; // 60 seconds (default was 30 seconds)

// Completion configuration
export const COMPLETION_CONFIG = {
  // Maximum number of lines to include before cursor (for context)
  MAX_CONTEXT_LINES: 50,
  // Maximum number of lines to peek after cursor (to avoid conflicts)
  MAX_LOOKAHEAD_LINES: 5,
  // Maximum tokens to generate
  MAX_NEW_TOKENS: 60,
  // Temperature for generation (lower = more deterministic)
  TEMPERATURE: 0.1,
  // Minimum prompt length to trigger completion
  MIN_PROMPT_LENGTH: 20,
};

