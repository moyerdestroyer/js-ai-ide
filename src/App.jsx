import { useState, useEffect, useRef, useCallback } from "react";
import Editor from "@monaco-editor/react";
import "./App.css";
import {
  registerAICompletionProvider,
  preloadModel,
  setProgressCallback,
  getLoadingState,
} from "./aiCompletionProvider";

function App() {
  const [files, setFiles] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [theme, setTheme] = useState("vs-dark");
  const [fontFamily, setFontFamily] = useState(
    'Consolas, "Courier New", monospace'
  );
  const [fontSize, setFontSize] = useState(14);
  const [modelLoadingProgress, setModelLoadingProgress] = useState(0);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isGeneratingCompletion, setIsGeneratingCompletion] = useState(false);
  const [outputPanelHeight, setOutputPanelHeight] = useState(200);
  const [output, setOutput] = useState([]);
  const [isResizing, setIsResizing] = useState(false);
  const editorRef = useRef(null);
  const completionTimeoutRef = useRef(null);
  const monacoRef = useRef(null);
  const providerRegisteredRef = useRef(false);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(0);

  // Load files from localStorage on mount
  useEffect(() => {
    const savedFiles = localStorage.getItem("ide-files");
    if (savedFiles) {
      const parsedFiles = JSON.parse(savedFiles);
      setFiles(parsedFiles);
      if (parsedFiles.length > 0) {
        setActiveFileId(parsedFiles[0].id);
      }
    } else {
      // Create default file if no files exist
      const defaultFile = {
        id: Date.now().toString(),
        name: "main.js",
        content:
          '// Welcome to your JavaScript IDE\nconsole.log("Hello, World!");\n',
      };
      setFiles([defaultFile]);
      setActiveFileId(defaultFile.id);
    }
  }, []);

  // Preload AI model on mount
  useEffect(() => {
    // Set up progress callback with proper React state batching
    setProgressCallback((progress, generating) => {
      // Use requestAnimationFrame to ensure state updates don't block UI
      requestAnimationFrame(() => {
        if (generating !== undefined) {
          // This is a completion generation signal
          // Clear any existing timeout
          if (completionTimeoutRef.current) {
            clearTimeout(completionTimeoutRef.current);
            completionTimeoutRef.current = null;
          }

          if (generating) {
            // Show spinner immediately - no delay needed
            setIsGeneratingCompletion(true);
          } else {
            // Hide spinner after a small delay to avoid flicker if generation is very fast
            completionTimeoutRef.current = setTimeout(() => {
              setIsGeneratingCompletion(false);
              completionTimeoutRef.current = null;
            }, 150);
          }
        } else if (progress !== null && progress !== undefined) {
          // This is model loading progress
          setModelLoadingProgress(progress);
          setIsModelLoading(progress < 100);
          setIsModelLoaded(progress === 100);
        }
      });
    });

    // Start preloading the model
    const state = getLoadingState();
    if (!state.isLoaded && !state.isLoading) {
      setIsModelLoading(true);
      // Use setTimeout to yield to browser before starting heavy operation
      setTimeout(() => {
        preloadModel().then(() => {
          const newState = getLoadingState();
          setIsModelLoading(newState.isLoading);
          setIsModelLoaded(newState.isLoaded);
          setModelLoadingProgress(newState.progress);
        });
      }, 0);
    } else {
      // Model is already loading or loaded
      setIsModelLoading(state.isLoading);
      setIsModelLoaded(state.isLoaded);
      setModelLoadingProgress(state.progress);
    }

    // Cleanup timeout on unmount
    return () => {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
      }
    };
  }, []);

  // Auto-save files to localStorage whenever they change
  useEffect(() => {
    if (files.length > 0) {
      localStorage.setItem("ide-files", JSON.stringify(files));
    }
  }, [files]);

  const activeFile = files.find((f) => f.id === activeFileId);

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    
    // Configure Monaco for JavaScript (safe to call multiple times)
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: "React",
      allowJs: true,
      typeRoots: ["node_modules/@types"],
    });
    
    // Register AI provider only once, even if editor remounts
    if (!providerRegisteredRef.current) {
      registerAICompletionProvider(monaco);
      providerRegisteredRef.current = true;
    }
  };

  const handleEditorChange = (value) => {
    if (activeFileId) {
      setFiles((prevFiles) =>
        prevFiles.map((file) =>
          file.id === activeFileId ? { ...file, content: value || "" } : file
        )
      );
    }
  };

  const createNewFile = () => {
    const newFile = {
      id: Date.now().toString(),
      name: `file${files.length + 1}.js`,
      content: "",
    };
    setFiles((prevFiles) => [...prevFiles, newFile]);
    setActiveFileId(newFile.id);
  };

  const deleteFile = (fileId) => {
    if (files.length === 1) {
      alert("Cannot delete the last file. Create a new file first.");
      return;
    }
    const newFiles = files.filter((f) => f.id !== fileId);
    setFiles(newFiles);
    if (activeFileId === fileId) {
      setActiveFileId(newFiles[0].id);
    }
  };

  const renameFile = (fileId, newName, enforceExtension = false) => {
    // Strip any existing .js extension first to avoid duplicates
    let nameWithoutExt = newName.endsWith(".js")
      ? newName.slice(0, -3)
      : newName;

    // Only enforce .js extension if requested (on blur)
    // While typing, allow the name without extension
    const name = enforceExtension ? `${nameWithoutExt}.js` : nameWithoutExt;

    setFiles((prevFiles) =>
      prevFiles.map((file) => (file.id === fileId ? { ...file, name } : file))
    );
  };

  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === "vs-dark" ? "vs" : "vs-dark"));
  };

  const downloadFile = () => {
    if (!activeFile) return;

    const content = activeFile.content;
    const fileName = activeFile.name.endsWith('.js') 
      ? activeFile.name 
      : `${activeFile.name}.js`;
    
    // Create a blob with the file content
    const blob = new Blob([content], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    
    // Create a temporary anchor element and trigger download
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const runCode = useCallback(() => {
    if (!activeFile) return;

    const code = activeFile.content;
    const outputLines = [];
    
    // Capture console methods
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;
    
    const captureOutput = (method, prefix) => {
      return (...args) => {
        const output = args.map(arg => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2);
            } catch (e) {
              return String(arg);
            }
          }
          return String(arg);
        }).join(' ');
        outputLines.push({ type: method, message: output, prefix });
        originalLog(...args); // Still log to browser console
      };
    };

    console.log = captureOutput('log', '');
    console.error = captureOutput('error', 'Error:');
    console.warn = captureOutput('warn', 'Warning:');
    console.info = captureOutput('info', 'Info:');

    try {
      // Execute the code
      const func = new Function(code);
      const result = func();
      
      // If the code returns a value, display it
      if (result !== undefined) {
        outputLines.push({ 
          type: 'result', 
          message: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result),
          prefix: 'Result:'
        });
      }
    } catch (error) {
      outputLines.push({ 
        type: 'error', 
        message: error.message,
        prefix: 'Error:'
      });
    } finally {
      // Restore original console methods
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      console.info = originalInfo;
    }

    setOutput(outputLines);
  }, [activeFile]);

  // Keyboard shortcut for Run (Ctrl+Enter)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runCode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [runCode]);

  const handleResizeStart = (e) => {
    setIsResizing(true);
    resizeStartYRef.current = e.clientY;
    resizeStartHeightRef.current = outputPanelHeight;
    e.preventDefault();
  };

  useEffect(() => {
    const handleResizeMove = (e) => {
      if (!isResizing) return;
      
      const deltaY = resizeStartYRef.current - e.clientY; // Inverted because we're resizing from bottom
      const newHeight = Math.max(100, Math.min(600, resizeStartHeightRef.current + deltaY));
      setOutputPanelHeight(newHeight);
    };

    const handleResizeEnd = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, outputPanelHeight]);

  return (
    <div className="ide-container">
      <div className="ide-header">
        <div className="ide-title-container">
          <div className="ide-title">JavaScript IDE</div>
          <a
            href="https://github.com/moyerdestroyer/js-ai-ide"
            target="_blank"
            rel="noopener noreferrer"
            className="github-link"
            title="View on GitHub"
          >
            <svg
              className="github-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
          {isModelLoading && (
            <div className="model-loading-indicator">
              <span className="loading-text">
                Loading AI model... {modelLoadingProgress}%
              </span>
            </div>
          )}
          {isModelLoaded && isGeneratingCompletion && (
            <div
              className="completion-loading-indicator"
              title="Generating code completion..."
            >
              <span className="spinner"></span>
            </div>
          )}
        </div>
        <div className="ide-controls">
          <button onClick={runCode} className="btn btn-run" title="Run code (Ctrl+Enter)">
            ▶ Run
          </button>
          <button onClick={downloadFile} className="btn btn-secondary" title="Download current file as .js">
            ⬇ Download
          </button>
          <button onClick={createNewFile} className="btn btn-primary">
            + New File
          </button>
          <div className="theme-toggle">
            <button onClick={toggleTheme} className="btn btn-secondary">
              {theme === "vs-dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
          </div>
          <div className="font-controls">
            <label>
              Font:
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="font-select"
              >
                <option value='Consolas, "Courier New", monospace'>
                  Consolas
                </option>
                <option value='Monaco, "Courier New", monospace'>Monaco</option>
                <option value='"Fira Code", "Courier New", monospace'>
                  Fira Code
                </option>
                <option value='"Source Code Pro", "Courier New", monospace'>
                  Source Code Pro
                </option>
                <option value='"Courier New", monospace'>Courier New</option>
              </select>
            </label>
            <label>
              Size:
              <input
                type="number"
                min="10"
                max="24"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="font-size-input"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="ide-body">
        <div className="file-tabs">
          {files.map((file) => (
            <div
              key={file.id}
              className={`file-tab ${activeFileId === file.id ? "active" : ""}`}
              onClick={() => setActiveFileId(file.id)}
            >
              <input
                type="text"
                value={file.name}
                onChange={(e) => renameFile(file.id, e.target.value, false)}
                onMouseDown={(e) => {
                  // If clicking on a different file, switch to it first
                  if (activeFileId !== file.id) {
                    setActiveFileId(file.id);
                    // Prevent default to avoid focusing input immediately
                    // User can click again to edit if needed
                    e.preventDefault();
                  }
                  // If clicking on the active file's input, allow normal behavior (focus for editing)
                  // Don't stop propagation - let the tab's onClick handle switching if needed
                }}
                onFocus={() => {
                  // Ensure we're on the right file when focusing to edit
                  if (activeFileId !== file.id) {
                    setActiveFileId(file.id);
                  }
                }}
                onBlur={(e) => {
                  const trimmedValue = e.target.value.trim();
                  if (!trimmedValue) {
                    // Restore original name if empty
                    renameFile(file.id, file.name, true);
                  } else {
                    // Enforce .js extension on blur
                    renameFile(file.id, trimmedValue, true);
                  }
                }}
                className="file-name-input"
              />
              {files.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteFile(file.id);
                  }}
                  className="file-close-btn"
                  title="Close file"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="editor-container" style={{ height: `calc(100% - ${outputPanelHeight}px)` }}>
          {activeFile && (
            <Editor
              height="100%"
              language="javascript"
              theme={theme}
              value={activeFile.content}
              onChange={handleEditorChange}
              onMount={handleEditorDidMount}
              options={{
                fontSize: fontSize,
                fontFamily: fontFamily,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "on",
                lineNumbers: "on",
                roundedSelection: false,
                cursorStyle: "line",
                cursorBlinking: "blink",
                folding: true,
                showFoldingControls: "always",
                matchBrackets: "always",
                autoIndent: "full",
                formatOnPaste: true,
                formatOnType: true,
                suggestOnTriggerCharacters: true,
                acceptSuggestionOnEnter: "on",
                quickSuggestions: true,
              }}
            />
          )}
        </div>

        <div className="output-panel-container" style={{ height: `${outputPanelHeight}px` }}>
          <div 
            className="output-resize-handle"
            onMouseDown={handleResizeStart}
          />
          <div className="output-panel-header">
            <span>Output</span>
            <button 
              className="output-clear-btn"
              onClick={() => setOutput([])}
              title="Clear output"
            >
              Clear
            </button>
          </div>
          <div className="output-panel-content">
            {output.length === 0 ? (
              <div className="output-empty">No output yet. Click "Run" to execute your code.</div>
            ) : (
              output.map((line, index) => (
                <div key={index} className={`output-line output-line-${line.type}`}>
                  {line.prefix && <span className="output-prefix">{line.prefix}</span>}
                  <span className="output-message">{line.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
