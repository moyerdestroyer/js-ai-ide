// aiCompletionProvider.js - Main thread interface for AI operations via Web Worker
import { MODEL_NAME, COMPLETION_TIMEOUT_MS, COMPLETION_CONFIG } from './aiConstants.js';

let worker = null;
let isLoading = false;
let isLoaded = false;
let loadingProgress = 0;
let isGeneratingCompletion = false;
let progressCallback = null;
let providerRegistered = false;
let pendingCompletions = new Map(); // Track pending completion requests

// Initialize the worker
function initWorker() {
  if (worker) return worker;

  worker = new Worker(new URL('./aiWorker.js', import.meta.url), {
    type: 'module',
  });

  worker.onmessage = (e) => {
    const { type, payload } = e.data;

    switch (type) {
      case 'LOADING_PROGRESS':
        loadingProgress = payload.progress;
        isLoading = true;
        if (progressCallback) {
          requestAnimationFrame(() => {
            progressCallback(loadingProgress);
          });
        }
        break;

      case 'MODEL_LOADED':
        isLoaded = true;
        isLoading = false;
        loadingProgress = 100;
        if (progressCallback) {
          requestAnimationFrame(() => {
            progressCallback(100);
          });
        }
        break;

      case 'MODEL_LOAD_ERROR':
        isLoading = false;
        loadingProgress = 0;
        console.error('Model load error:', payload.error);
        break;

      case 'GENERATION_START':
        isGeneratingCompletion = true;
        if (progressCallback) {
          requestAnimationFrame(() => {
            progressCallback(null, true);
          });
        }
        break;

      case 'GENERATION_COMPLETE': {
        isGeneratingCompletion = false;
        if (progressCallback) {
          requestAnimationFrame(() => {
            progressCallback(null, false);
          });
        }
        // Resolve the pending completion promise
        const completionId = payload.completionId;
        if (pendingCompletions.has(completionId)) {
          const { resolve } = pendingCompletions.get(completionId);
          pendingCompletions.delete(completionId);
          resolve(payload.continuation);
        }
        break;
      }

      case 'COMPLETION_ERROR': {
        isGeneratingCompletion = false;
        if (progressCallback) {
          requestAnimationFrame(() => {
            progressCallback(null, false);
          });
        }
        // Reject the pending completion promise
        const errorId = payload.completionId;
        if (pendingCompletions.has(errorId)) {
          const { reject } = pendingCompletions.get(errorId);
          pendingCompletions.delete(errorId);
          reject(new Error(payload.error));
        }
        break;
      }

      case 'STATE_UPDATE':
        isLoading = payload.isLoading;
        isLoaded = payload.isLoaded;
        loadingProgress = payload.progress;
        break;
    }
  };

  worker.onerror = (error) => {
    console.error('Worker error:', error);
    isLoading = false;
  };

  return worker;
}

// Set a callback to receive progress updates
export function setProgressCallback(callback) {
  progressCallback = callback;
}

// Get current loading state
export function getLoadingState() {
  return {
    isLoading,
    isLoaded,
    progress: loadingProgress,
    isGeneratingCompletion,
  };
}

// Start loading the model (can be called early)
export async function preloadModel() {
  if (isLoaded) return true;
  if (isLoading) return null;

  const w = initWorker();
  isLoading = true;
  loadingProgress = 0;

  return new Promise((resolve) => {
    const checkLoaded = () => {
      if (isLoaded) {
        resolve(true);
      } else if (!isLoading && !isLoaded) {
        resolve(false);
      } else {
        setTimeout(checkLoaded, 100);
      }
    };

    w.postMessage({ type: 'PRELOAD_MODEL' });
    checkLoaded();
  });
}

// Filter continuation to remove parts that duplicate existing code
function filterContinuation(continuation, lookaheadText) {
  if (!continuation) return continuation;
  if (!lookaheadText) return continuation;

  // Remove leading/trailing whitespace for comparison
  const continuationTrimmed = continuation.trim();
  const lookaheadTrimmed = lookaheadText.trim();

  if (!continuationTrimmed || !lookaheadTrimmed) return continuation;

  // Check if continuation exactly matches or is contained in lookahead
  if (lookaheadTrimmed.includes(continuationTrimmed) && continuationTrimmed.length > 3) {
    return '';
  }

  // Check if continuation starts with text that exists in lookahead
  // Compare character by character for more accurate matching
  let matchingChars = 0;
  const minLen = Math.min(continuationTrimmed.length, lookaheadTrimmed.length);
  
  for (let i = 0; i < minLen; i++) {
    if (continuationTrimmed[i] === lookaheadTrimmed[i]) {
      matchingChars++;
    } else {
      break;
    }
  }

  // If more than 5 characters match at the start, likely duplicating existing code
  if (matchingChars > 5) {
    const remaining = continuationTrimmed.slice(matchingChars).trim();
    // Only return if there's substantial new content
    if (remaining.length < 3) {
      return '';
    }
    return remaining;
  }

  // Also check word-level matching for better accuracy
  const lookaheadWords = lookaheadTrimmed.split(/\s+/);
  const continuationWords = continuationTrimmed.split(/\s+/);
  
  // Remove matching prefix words
  let prefixMatchCount = 0;
  for (let i = 0; i < Math.min(continuationWords.length, lookaheadWords.length); i++) {
    if (continuationWords[i] === lookaheadWords[i]) {
      prefixMatchCount++;
    } else {
      break;
    }
  }

  // If 2+ words match, remove them
  if (prefixMatchCount >= 2) {
    const remainingWords = continuationWords.slice(prefixMatchCount);
    const result = remainingWords.join(' ').trim();
    return result.length > 0 ? result : '';
  }

  // Stop at common statement terminators if they appear early (likely end of statement)
  const stopPatterns = [
    /^[;]\s*$/,  // Just a semicolon
    /^[}]+\s*$/, // Just closing braces
    /^[)]+\s*$/, // Just closing parens
  ];

  const firstLine = continuation.split('\n')[0].trim();
  if (stopPatterns.some(pattern => pattern.test(firstLine))) {
    return '';
  }

  return continuation;
}

async function generateCompletionInWorker(prompt, lookaheadText = '') {
  const w = initWorker();
  const completionId = Date.now().toString() + Math.random().toString(36);

  return new Promise((resolve, reject) => {
    pendingCompletions.set(completionId, { resolve, reject });

    w.postMessage({
      type: 'GENERATE_COMPLETION',
      payload: { prompt, lookaheadText, completionId },
    });

    // Timeout after configured duration
    setTimeout(() => {
      if (pendingCompletions.has(completionId)) {
        pendingCompletions.delete(completionId);
        reject(new Error('Completion timeout'));
      }
    }, COMPLETION_TIMEOUT_MS);
  });
}

let loadingDecorationCleared = false;

export function registerAICompletionProvider(monaco) {
  // Prevent double registration
  if (providerRegistered) {
    console.log('AI provider already registered — skipping duplicate');
    return;
  }

  providerRegistered = true;
  initWorker(); // Initialize worker early

  monaco.languages.registerInlineCompletionsProvider('javascript', {
    debounceDelayMs: 1000,

    provideInlineCompletions: async (model, position) => {
      // Get the current editor instance from the model
      const currentEditor = monaco.editor.getEditors().find(e => e.getModel() === model);
      
      // Show loading message only once, on the first request
      if (!isLoaded && !loadingDecorationCleared && currentEditor) {
        const loadingDecoration = currentEditor.createDecorationsCollection([
          {
            range: new monaco.Range(1, 1, 1, 1),
            options: {
              after: {
                content: 'Loading reliable code model (first time only)...',
                inlineClassName: 'ai-loading-ghost',
              },
            },
          },
        ]);
        
        await preloadModel();
        loadingDecoration.clear();
        loadingDecorationCleared = true;
      } else if (!isLoaded) {
        await preloadModel();
      }

      if (!isLoaded) return { items: [] };

      // Get context before cursor (limited to MAX_CONTEXT_LINES)
      const startLine = Math.max(1, position.lineNumber - COMPLETION_CONFIG.MAX_CONTEXT_LINES);
      const prompt = model.getValueInRange({
        startLineNumber: startLine,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      if (prompt.trim().length < COMPLETION_CONFIG.MIN_PROMPT_LENGTH) return { items: [] };

      // Get lookahead context (code after cursor) to avoid conflicts
      const totalLines = model.getLineCount();
      const lookaheadEndLine = Math.min(
        totalLines,
        position.lineNumber + COMPLETION_CONFIG.MAX_LOOKAHEAD_LINES
      );
      const lookaheadText = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: lookaheadEndLine,
        endColumn: model.getLineMaxColumn(lookaheadEndLine),
      });

      try {
        const continuation = await generateCompletionInWorker(prompt, lookaheadText);

        if (!continuation) return { items: [] };

        // Filter out continuation if it would duplicate existing code
        const filteredContinuation = filterContinuation(continuation, lookaheadText);

        if (!filteredContinuation) return { items: [] };

        return {
          items: [{
            insertText: filteredContinuation,
            range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
          }],
        };
      } catch (err) {
        console.error('Generation error:', err);
        return { items: [] };
      }
    },

    freeInlineCompletions: () => {},
    disposeInlineCompletions: () => {},
  });

  console.log('AI code completion provider registered ONCE ' + MODEL_NAME + ' - using Web Worker');
}