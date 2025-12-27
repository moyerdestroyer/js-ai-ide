// aiWorker.js - Web Worker for AI model operations
import { pipeline } from '@huggingface/transformers';

let generator = null;
let isLoading = false;
let isLoaded = false;
let loadingProgress = 0;

// Handle messages from the main thread
self.onmessage = async function(e) {
  const { type, payload } = e.data;

  switch (type) {
    case 'PRELOAD_MODEL':
      await handlePreloadModel();
      break;

    case 'GENERATE_COMPLETION':
      await handleGenerateCompletion(payload);
      break;

    case 'GET_STATE':
      self.postMessage({
        type: 'STATE_UPDATE',
        payload: {
          isLoading,
          isLoaded,
          progress: loadingProgress,
        },
      });
      break;

    default:
      console.warn('Unknown message type:', type);
  }
};

async function handlePreloadModel() {
  if (isLoaded) {
    self.postMessage({
      type: 'MODEL_LOADED',
      payload: { progress: 100 },
    });
    return;
  }
  if (isLoading) {
    return;
  }

  isLoading = true;
  loadingProgress = 0;

  self.postMessage({
    type: 'LOADING_PROGRESS',
    payload: { progress: 0 },
  });

  console.log('Worker: Loading Xenova/codegen-350M-mono...');

  try {
    generator = await pipeline(
      'text-generation',
      'Xenova/codegen-350M-mono',
      {
        progress_callback: (data) => {
          loadingProgress = Math.round(data.progress);
          self.postMessage({
            type: 'LOADING_PROGRESS',
            payload: { progress: loadingProgress },
          });
        },
      }
    );

    isLoaded = true;
    isLoading = false;
    loadingProgress = 100;

    self.postMessage({
      type: 'MODEL_LOADED',
      payload: { progress: 100 },
    });

    console.log('Worker: Code completion model loaded! 🚀');
  } catch (err) {
    console.error('Worker: Model load failed:', err);
    isLoading = false;
    loadingProgress = 0;

    self.postMessage({
      type: 'MODEL_LOAD_ERROR',
      payload: { error: err.message },
    });
  }
}

async function handleGenerateCompletion({ prompt, completionId }) {
  if (!isLoaded) {
    // Try to load the model first
    await handlePreloadModel();
  }

  if (!generator) {
    self.postMessage({
      type: 'COMPLETION_ERROR',
      payload: { error: 'Model not loaded', completionId },
    });
    return;
  }

  // Notify that generation is starting
  self.postMessage({
    type: 'GENERATION_START',
  });

  try {
    const output = await generator(prompt, {
      max_new_tokens: 80,
      temperature: 0.2,
      do_sample: true,
    });

    const fullText = output[0].generated_text;
    let continuation = fullText.slice(prompt.length);

    continuation = continuation
      .replace(/^\n+/, '')
      .replace(/\n{3,}$/, '\n\n')
      .trimEnd();

    // Notify that generation is complete
    self.postMessage({
      type: 'GENERATION_COMPLETE',
      payload: { continuation, completionId },
    });
  } catch (err) {
    console.error('Worker: Generation error:', err);
    self.postMessage({
      type: 'COMPLETION_ERROR',
      payload: { error: err.message, completionId },
    });
  }
}

