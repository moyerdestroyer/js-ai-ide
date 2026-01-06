// aiCompletionProvider.js - Main thread interface for AI operations via Web Worker
import { MODEL_NAME, COMPLETION_TIMEOUT_MS, COMPLETION_CONFIG } from './aiConstants.js';

class AICompletionManager {
  constructor() {
    this.worker = null;
    this.isLoading = false;
    this.isLoaded = false;
    this.loadingProgress = 0;
    this.isGeneratingCompletion = false;
    this.progressCallback = null;
    this.providerRegistered = false;
    this.pendingCompletions = new Map(); // Track pending completion requests
    this.loadingDecorationCleared = false;
    this.loadingDecoration = null;
    this.currentCompletionAbort = null; // Abort controller for current completion
  }

  // Initialize the worker
  initWorker() {
    if (this.worker) return this.worker;

    this.worker = new Worker(new URL('./aiWorker.js', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (e) => {
      const { type, payload } = e.data;

      switch (type) {
        case 'LOADING_PROGRESS':
          this.loadingProgress = payload.progress;
          this.isLoading = true;
          if (this.progressCallback) {
            requestAnimationFrame(() => {
              this.progressCallback(this.loadingProgress);
            });
          }
          break;

        case 'MODEL_LOADED':
          this.isLoaded = true;
          this.isLoading = false;
          this.loadingProgress = 100;
          if (this.progressCallback) {
            requestAnimationFrame(() => {
              this.progressCallback(100);
            });
          }
          break;

        case 'MODEL_LOAD_ERROR':
          this.isLoading = false;
          this.loadingProgress = 0;
          console.error('Model load error:', payload.error);
          break;

        case 'GENERATION_START':
          this.isGeneratingCompletion = true;
          if (this.progressCallback) {
            requestAnimationFrame(() => {
              this.progressCallback(null, true);
            });
          }
          break;

        case 'GENERATION_COMPLETE': {
          this.isGeneratingCompletion = false;
          if (this.progressCallback) {
            requestAnimationFrame(() => {
              this.progressCallback(null, false);
            });
          }
          // Resolve the pending completion promise
          const completionId = payload.completionId;
          if (this.pendingCompletions.has(completionId)) {
            const { resolve } = this.pendingCompletions.get(completionId);
            this.pendingCompletions.delete(completionId);
            resolve(payload.continuation);
          }
          break;
        }

        case 'COMPLETION_ERROR': {
          this.isGeneratingCompletion = false;
          if (this.progressCallback) {
            requestAnimationFrame(() => {
              this.progressCallback(null, false);
            });
          }
          // Reject the pending completion promise
          const errorId = payload.completionId;
          if (this.pendingCompletions.has(errorId)) {
            const { reject } = this.pendingCompletions.get(errorId);
            this.pendingCompletions.delete(errorId);
            reject(new Error(payload.error));
          }
          break;
        }

        case 'STATE_UPDATE':
          this.isLoading = payload.isLoading;
          this.isLoaded = payload.isLoaded;
          this.loadingProgress = payload.progress;
          break;
      }
    };

    this.worker.onerror = (error) => {
      console.error('Worker error:', error);
      this.isLoading = false;
    };

    return this.worker;
  }

  // Set a callback to receive progress updates
  setProgressCallback(callback) {
    this.progressCallback = callback;
  }

  // Get current loading state
  getLoadingState() {
    return {
      isLoading: this.isLoading,
      isLoaded: this.isLoaded,
      progress: this.loadingProgress,
      isGeneratingCompletion: this.isGeneratingCompletion,
    };
  }

  // Start loading the model (can be called early)
  async preloadModel() {
    if (this.isLoaded) return true;
    if (this.isLoading) return null;

    const w = this.initWorker();
    this.isLoading = true;
    this.loadingProgress = 0;

    return new Promise((resolve) => {
      const checkLoaded = () => {
        if (this.isLoaded) {
          resolve(true);
        } else if (!this.isLoading && !this.isLoaded) {
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
  // Improved version: simpler, faster, more predictable
  filterContinuation(continuation, lookaheadText) {
    if (!continuation || !lookaheadText) return continuation;

    const cont = continuation.trimStart(); // Allow leading whitespace in insert
    const look = lookaheadText;

    let overlap = 0;
    const minLen = Math.min(cont.length, look.length);

    for (let i = 0; i < minLen; i++) {
      if (cont[i] === look[i]) {
        overlap++;
      } else {
        break;
      }
    }

    // If significant overlap (e.g. >5 chars or full match), strip prefix
    if (overlap > 5 || (overlap === cont.length && overlap > 0)) {
      const remaining = cont.slice(overlap);
      return remaining.trimStart(); // Keep indentation if any
    }

    // Also reject trivial completions
    if (/^\s*([;})\]]|\n\s*)+$/.test(cont)) {
      return '';
    }

    return cont;
  }

  async generateCompletionInWorker(prompt, lookaheadText = '') {
    const w = this.initWorker();
    const completionId = Date.now().toString() + Math.random().toString(36);

    // Cancel previous completion request if still pending
    // Clean up any pending completions that are no longer needed
    if (this.currentCompletionAbort) {
      // Find and reject any pending completions that should be aborted
      for (const [id, { reject, controller }] of this.pendingCompletions.entries()) {
        if (controller === this.currentCompletionAbort) {
          this.pendingCompletions.delete(id);
          reject(new Error('Completion aborted'));
          break;
        }
      }
      this.currentCompletionAbort.abort();
    }

    // Create new abort controller for this request
    const controller = new AbortController();
    this.currentCompletionAbort = controller;

    return new Promise((resolve, reject) => {
      // Check if aborted before setting up
      if (controller.signal.aborted) {
        reject(new Error('Completion aborted'));
        return;
      }

      this.pendingCompletions.set(completionId, { resolve, reject, controller });

      w.postMessage({
        type: 'GENERATE_COMPLETION',
        payload: { prompt, lookaheadText, completionId },
      });

      // Timeout after configured duration
      const timeoutId = setTimeout(() => {
        if (this.pendingCompletions.has(completionId)) {
          this.pendingCompletions.delete(completionId);
          controller.abort();
          reject(new Error('Completion timeout'));
        }
      }, COMPLETION_TIMEOUT_MS);

      // Clean up timeout if aborted
      controller.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        if (this.pendingCompletions.has(completionId)) {
          const { reject: abortReject } = this.pendingCompletions.get(completionId);
          this.pendingCompletions.delete(completionId);
          abortReject(new Error('Completion aborted'));
        }
      });
    });
  }

  registerAICompletionProvider(monaco) {
    // Prevent double registration
    if (this.providerRegistered) {
      console.log('AI provider already registered — skipping duplicate');
      return;
    }

    this.providerRegistered = true;
    this.initWorker(); // Initialize worker early

    monaco.languages.registerInlineCompletionsProvider('javascript', {
      debounceDelayMs: 1000,

      provideInlineCompletions: async (model, position) => {
        // Get the current editor instance from the model
        const currentEditor = monaco.editor.getEditors().find(e => e.getModel() === model);
        
        // Show loading message only once, on the first request
        // Fix memory leak: ensure decoration is cleared even on error
        if (!this.isLoaded && !this.loadingDecorationCleared && currentEditor) {
          this.loadingDecoration = currentEditor.createDecorationsCollection([
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
          
          // Ensure decoration is cleared even if preload fails or takes too long
          this.preloadModel().finally(() => {
            if (this.loadingDecoration) {
              this.loadingDecoration.clear();
              this.loadingDecoration = null;
            }
            this.loadingDecorationCleared = true;
          });
        } else if (!this.isLoaded) {
          await this.preloadModel();
        }

        if (!this.isLoaded) return { items: [] };

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
          const continuation = await this.generateCompletionInWorker(prompt, lookaheadText);

          if (!continuation) return { items: [] };

          // Filter out continuation if it would duplicate existing code
          const filteredContinuation = this.filterContinuation(continuation, lookaheadText);

          if (!filteredContinuation) return { items: [] };

          return {
            items: [{
              insertText: filteredContinuation,
              range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
            }],
          };
        } catch (err) {
          // Ignore aborted/timeout errors silently
          if (err.message !== 'Completion aborted' && err.message !== 'Completion timeout') {
            console.error('Generation error:', err);
          }
          return { items: [] };
        }
      },

      freeInlineCompletions: () => {},
      disposeInlineCompletions: () => {},
    });

    console.log('AI code completion provider registered ONCE ' + MODEL_NAME + ' - using Web Worker');
  }
}

// Export singleton instance
const aiCompletionManager = new AICompletionManager();

// Export functions that maintain the same API for backward compatibility
export function setProgressCallback(callback) {
  aiCompletionManager.setProgressCallback(callback);
}

export function getLoadingState() {
  return aiCompletionManager.getLoadingState();
}

export async function preloadModel() {
  return aiCompletionManager.preloadModel();
}

export function registerAICompletionProvider(monaco) {
  return aiCompletionManager.registerAICompletionProvider(monaco);
}