// aiCompletionProvider.js - Main thread interface for AI operations via Web Worker
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

async function generateCompletionInWorker(prompt) {
  const w = initWorker();
  const completionId = Date.now().toString() + Math.random().toString(36);

  return new Promise((resolve, reject) => {
    pendingCompletions.set(completionId, { resolve, reject });

    w.postMessage({
      type: 'GENERATE_COMPLETION',
      payload: { prompt, completionId },
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingCompletions.has(completionId)) {
        pendingCompletions.delete(completionId);
        reject(new Error('Completion timeout'));
      }
    }, 30000);
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

      const prompt = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      if (prompt.trim().length < 20) return { items: [] };

      try {
        const continuation = await generateCompletionInWorker(prompt);

        if (!continuation) return { items: [] };

        return {
          items: [{
            insertText: continuation,
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

  console.log('AI code completion provider registered ONCE (codegen-350M-mono) - using Web Worker');
}