// aiWorker.js - Web Worker for AI model operations
import { pipeline } from '@huggingface/transformers';
import { MODEL_NAME, COMPLETION_CONFIG } from './aiConstants.js';

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

  console.log('Worker: Loading ' + MODEL_NAME + '...');

  try {
    generator = await pipeline(
      'text-generation',
      MODEL_NAME,
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

async function handleGenerateCompletion({ prompt, lookaheadText, completionId }) {
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
    // Build generation parameters
    const genParams = {
      max_new_tokens: COMPLETION_CONFIG.MAX_NEW_TOKENS,
      temperature: COMPLETION_CONFIG.TEMPERATURE,
      do_sample: true,
    };

    // Build stop sequences to prevent over-generation
    // Stop at common statement boundaries
    const stopSequences = ['\n\n\n'];
    
    // If we have lookahead text, add its first few tokens as stop sequences
    if (lookaheadText && lookaheadText.trim()) {
      const firstLine = lookaheadText.split('\n')[0].trim();
      if (firstLine.length > 0) {
        // Add first word/phrase of lookahead as a stop sequence
        const firstWords = firstLine.split(/\s+/).slice(0, 2).join(' ');
        if (firstWords.length < 20) {
          stopSequences.push(firstWords);
        }
      }
    }

    // Add stop sequences (try stop_strings, which is common in transformers.js)
    // If not supported, the generator will ignore it and post-processing will filter
    if (stopSequences.length > 0) {
      genParams.stop_strings = stopSequences;
    }

    const output = await generator(prompt, genParams);

    const fullText = output[0].generated_text;
    
    // Extract continuation more carefully
    let continuation = '';
    if (fullText.length > prompt.length) {
      continuation = fullText.slice(prompt.length);
    } else {
      // If model regenerated the prompt, try to find where new content starts
      // This handles cases where the model might slightly modify the prompt
      const promptWords = prompt.trim().split(/\s+/);
      const fullTextWords = fullText.trim().split(/\s+/);
      
      // Find where new words start
      let newContentStart = 0;
      for (let i = 0; i < Math.min(promptWords.length, fullTextWords.length); i++) {
        if (promptWords[i] === fullTextWords[i]) {
          newContentStart = i + 1;
        } else {
          break;
        }
      }
      
      if (newContentStart < fullTextWords.length) {
        continuation = fullTextWords.slice(newContentStart).join(' ');
      }
    }

    // Clean up the continuation
    continuation = continuation
      .replace(/^\n+/, '') // Remove leading newlines
      .replace(/\n{3,}/g, '\n\n') // Replace multiple newlines with double
      .trimEnd();

    // If continuation would duplicate lookahead text, trim it
    if (lookaheadText && continuation) {
      const lookaheadTrimmed = lookaheadText.trim();
      const continuationTrimmed = continuation.trim();
      
      // Check if continuation starts with lookahead content
      if (continuationTrimmed.startsWith(lookaheadTrimmed)) {
        continuation = '';
      } else if (lookaheadTrimmed.startsWith(continuationTrimmed)) {
        // If lookahead contains the continuation, it's likely already there
        continuation = '';
      }
    }

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

